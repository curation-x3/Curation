import asyncio
import os
import json
from unittest.mock import Mock, patch
import httpx
import pytest
from utils import (
    get_basic_info, 
    get_article_html, 
    get_article_detail, 
    get_post_history,
    get_remain_money,
    WeChatAPIError
)

# Set a dummy API key for testing
os.environ["DAJIALA_API_KEY"] = "test_key"

async def test_get_basic_info_success():
    mock_response = {
        "code": 0,
        "msg": "成功",
        "data": {
            "name": "Test Account",
            "biz": "MjM5MjAxNDM4MA==",
            "wxid": "test_wxid",
            "type": "订阅号",
            "avatar": "http://example.com/avatar.png",
            "desc": "Test Description"
        }
    }
    
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.return_value = Mock(status_code=200)
        mock_post.return_value.json.return_value = mock_response
        
        result = await get_basic_info("test_wxid")
        # Now returns res["data"] directly
        assert result["name"] == "Test Account"
        assert result["biz"] == "MjM5MjAxNDM4MA=="
        mock_post.assert_called_once()

async def test_get_article_html_error():
    mock_response = {
        "code": 101,
        "msg": "文章被删除或违规或公众号已迁移"
    }
    
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.return_value = Mock(status_code=200)
        mock_post.return_value.json.return_value = mock_response
        
        with pytest.raises(WeChatAPIError) as excinfo:
            await get_article_html("http://mp.weixin.qq.com/s/test")
        assert excinfo.value.code == 101
        assert "文章被删除" in excinfo.value.message

async def test_get_post_history():
    mock_response = {
        "code": 0,
        "data": [{"title": "Article 1"}, {"title": "Article 2"}]
    }
    
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.return_value = Mock(status_code=200)
        mock_post.return_value.json.return_value = mock_response
        
        result = await get_post_history(name="test_account", page=1)
        assert len(result["data"]) == 2
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["name"] == "test_account"
        assert kwargs["json"]["page"] == 1
        assert kwargs["json"]["key"] == "test_key"

async def test_get_remain_money():
    mock_response = {
        "code": "0",
        "remain_money": "100.50",
        "yesterday_money": "105.00",
        "request_time": "2026-03-27 09:20:00"
    }
    
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.return_value = Mock(status_code=200)
        mock_post.return_value.json.return_value = mock_response
        
        result = await get_remain_money()
        assert result["code"] == "0"
        assert result["remain_money"] == "100.50"
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        # Should be in 'data' for form-data
        assert kwargs["data"]["key"] == "test_key"

if __name__ == "__main__":
    # Simple manual run if pytest is not used
    print("Running manual tests...")
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(test_get_basic_info_success())
        print("✅ get_basic_info success test passed")
        loop.run_until_complete(test_get_article_html_error())
        print("✅ get_article_html error test passed")
        loop.run_until_complete(test_get_post_history())
        print("✅ get_post_history test passed")
        loop.run_until_complete(test_get_remain_money())
        print("✅ get_remain_money test passed")
        print("\nAll manual tests passed!")
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
