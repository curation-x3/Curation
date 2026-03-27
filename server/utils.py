import os
import time
import logging
import httpx
from typing import Optional, Dict, Any, List, TypedDict, Union
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

logger = logging.getLogger(__name__)

# Constants
API_BASE_URL = "https://www.dajiala.com"

# --- TypedDict Definitions for API Responses ---

class AccountInfo(TypedDict):
    """公众号基础信息"""
    name: str
    biz: str
    type: str  # 公众号类型
    avatar: str
    desc: str

class ArticleHTMLContent(TypedDict):
    """文章 HTML 详情"""
    title: str
    biz: str
    article_url: str
    mp_head_img: str
    cover_url: str
    nickname: str
    post_time: int
    post_time_str: str
    gh_id: str
    wxid: str
    signature: str
    author: str
    desc: str
    copyright: int
    html: str
    ip_wording: str

class ArticleDetail(TypedDict):
    """文章详细内容 (纯文本/富文本)"""
    title: str
    content: str  # 纯文本格式正文
    content_multi_text: str  # 富文本格式
    url: str
    hashid: str
    mp_head_img: str
    nick_name: str
    user_name: str
    idx: str
    pubtime: str
    create_time: str
    biz: str
    alias: str
    source_url: str
    signature: str
    author: str
    desc: str
    copyright_stat: int
    ip_wording: str
    item_show_type: int
    real_item_show_type: int
    video_page_infos: List[Any]
    picture_page_info_list: List[Any]

class HistoryArticleItem(TypedDict):
    """历史发文列表中的单篇文章"""
    position: int # 发文位置
    url: str
    post_time: int
    post_time_str: str
    cover_url: str
    original: int # 1:原创 0:未声明原创 2:转载
    item_show_type: int
    digest: str
    title: str
    pre_post_time: int
    msg_status: int # 2:正常; 7:已被删除; 6:违规; 104:审核中; 105:发送中
    msg_fail_reason: str
    send_to_fans_num: int
    is_deleted: int # 0:正常; 1:已被删除
    types: int # 9:群发(有通知); 1:发布(无通知)

class PostHistoryResponse(TypedDict):
    """公众号发文历史响应全字段"""
    data: List[HistoryArticleItem]
    total_num: int
    total_page: int
    publish_count: int
    masssend_count: int
    now_page: int
    now_page_articles_num: int
    cost_money: float
    remain_money: float
    mp_nickname: str
    mp_wxid: str
    mp_ghid: str
    head_img: str

class BalanceInfo(TypedDict):
    """API 余额信息"""
    code: Union[str, int]
    remain_money: str
    yesterday_money: str
    request_time: str

class WeChatAPIError(Exception):
    """Custom exception for WeChat API errors."""
    def __init__(self, code: int, message: str, data: Any = None):
        self.code = int(code) if isinstance(code, str) and code.isdigit() else (0 if code == "0" else code)
        self.message = message
        self.data = data
        super().__init__(f"API Error {code}: {message}")

async def _request(method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
    """Internal helper for making API requests with retry logic."""
    url = f"{API_BASE_URL}{endpoint}"
    
    # Ensure API key is present
    api_key = os.environ.get("DAJIALA_API_KEY", "")
    if not api_key:
        raise ValueError("DAJIALA_API_KEY must be set in environment.")

    # Standard body params for most dajiala endpoints
    if "json" in kwargs:
        kwargs["json"].setdefault("key", api_key)
        kwargs["json"].setdefault("verifycode", "")
    elif "params" in kwargs:
         kwargs["params"].setdefault("key", api_key)
         kwargs["params"].setdefault("verifycode", "")
    elif "data" in kwargs:
         # For multipart/form-data
         kwargs["data"].setdefault("key", api_key)
         kwargs["data"].setdefault("verifycode", "")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                if method.upper() == "POST":
                    # httpx uses 'data' for form-data
                    response = await client.post(url, **kwargs)
                else:
                    response = await client.get(url, **kwargs)
                
                # Check for HTTP errors
                if response.status_code == 500:
                    if attempt < max_retries - 1:
                         logger.warning(f"Internal Server Error (500) at {endpoint}, retrying... ({attempt + 1})")
                         time.sleep(1)
                         continue
                    raise WeChatAPIError(50000, "Internal Server Error")

                data = response.json()
                
                # Check for "Internal Server Error" message in JSON
                if isinstance(data, dict) and data.get("message") == "Internal Server Error":
                    if attempt < max_retries - 1:
                        logger.warning(f"Internal Server Error message at {endpoint}, retrying... ({attempt + 1})")
                        time.sleep(1)
                        continue
                    raise WeChatAPIError(50000, "Internal Server Error")

                # The balance API might return code as string
                raw_code = data.get("code", 0)
                code = int(raw_code) if isinstance(raw_code, str) and raw_code.isdigit() else (0 if raw_code == "0" else raw_code)
                
                # Success
                if code == 0:
                    return data

                # Specific error handling
                msg = data.get("msg") or data.get("msk") or "Unknown error"
                
                # Retryable errors from documentation (107: parse failed, 2005: system error)
                if code in (107, 2005) and attempt < max_retries - 1:
                    logger.warning(f"Error {code} at {endpoint}, retrying... ({attempt + 1})")
                    time.sleep(2)
                    continue

                # QPS limit
                if code == -1:
                    logger.warning(f"QPS limit reached for {endpoint}. Sleeping 5s.")
                    time.sleep(5)
                    # We might want to retry here too, but let's just raise for now
                    raise WeChatAPIError(code, "QPS limit exceeded (max 5/s)")

                raise WeChatAPIError(code, msg, data)

        except (httpx.RequestError, ValueError) as e:
            if attempt < max_retries - 1:
                logger.warning(f"Request failed: {e}, retrying... ({attempt + 1})")
                time.sleep(1)
                continue
            raise WeChatAPIError(50001, f"Request failed: {str(e)}")

    raise WeChatAPIError(50002, "Max retries exceeded")

async def get_basic_info(name_or_id: str) -> AccountInfo:
    """
    获取公众号头像、账号类型、公众号简介等基础信息
    Endpoint: /fbmain/monitor/v3/avatar_type (POST)
    """
    payload = {"name": name_or_id}
    res = await _request("POST", "/fbmain/monitor/v3/avatar_type", json=payload)
    return res["data"]

async def get_article_html(article_url: str) -> ArticleHTMLContent:
    """
    获取文章正文 HTML
    Endpoint: /fbmain/monitor/v3/article_html (POST)
    """
    payload = {"url": article_url}
    res = await _request("POST", "/fbmain/monitor/v3/article_html", json=payload)
    return res["data"]

async def get_article_detail(article_url: str, mode: str = "2") -> ArticleDetail:
    """
    获取文章详情(纯文本,富文本,不带html文章格式)
    Endpoint: /fbmain/monitor/v3/article_detail (GET)
    mode: 1.带图片标签纯文本 2.纯文字+富文本格式
    返回的内容直接在根目录
    """
    params = {"url": article_url, "mode": mode}
    res = await _request("GET", "/fbmain/monitor/v3/article_detail", params=params)
    return res # type: ignore

async def get_post_history(biz: str = "", url: str = "", name: str = "", page: int = 1) -> PostHistoryResponse:
    """
    通过公众号名称/微信Id/链接获取公众号历史发文列表
    Endpoint: /fbmain/monitor/v3/post_history (POST)
    Note: biz, url, name 至少提供一个。优先级: biz > url > name.
    """
    if not any([biz, url, name]):
        raise ValueError("At least one of biz, url, or name must be provided.")
    
    payload = {
        "biz": biz,
        "url": url,
        "name": name,
        "page": page
    }
    res = await _request("POST", "/fbmain/monitor/v3/post_history", json=payload)
    return res # type: ignore

async def get_remain_money() -> BalanceInfo:
    """
    获取 API 余额
    Endpoint: /fbmain/monitor/v3/get_remain_money (POST, multipart/form-data)
    """
    return await _request("POST", "/fbmain/monitor/v3/get_remain_money", data={}) # type: ignore
