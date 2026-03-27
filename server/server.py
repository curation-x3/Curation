#!/usr/bin/env python3
import json
import logging
import os
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

import asyncio

from auth import verify_authing_token
from cleaner import cleaner
from database import db
from agent_runner import AgentRunner
from utils import get_basic_info, get_post_history, get_article_detail
from routers.auth_router import router as auth_router
from routers.invite_router import router as invite_router
from routers.users_router import router as users_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Curation App Backend")

_UNPROTECTED_PREFIXES = ("/auth/", "/health")
_UNPROTECTED_PATHS = {"/health", "/auth/validate-invite", "/auth/register",
                      "/auth/login", "/auth/bootstrap"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS":
            return await call_next(request)
        if path in _UNPROTECTED_PATHS or path.startswith("/auth/"):
            return await call_next(request)
        # WebSocket upgrade: let through (handler validates token via query param)
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse({"detail": "Authorization header required"}, status_code=401)
        token = auth_header[7:]
        try:
            claims = await verify_authing_token(token)
            sub = claims.get("sub")
            user = db.get_user_by_sub(sub) if sub else None
            if not user or not user["is_active"]:
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
            request.state.user = user
        except HTTPException as e:
            return JSONResponse({"detail": e.detail}, status_code=e.status_code)

        return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "https://tauri.localhost",
        "http://localhost:1420",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router, prefix="/auth")
app.include_router(invite_router, prefix="/invites")
app.include_router(users_router, prefix="/users")

# ------------------------------------------------------------------
# Paths (data dir is external — configured via CURATION_DATA_DIR)
# ------------------------------------------------------------------

_data_dir = Path(os.environ.get("CURATION_DATA_DIR",
                                str(Path(__file__).parent)))
_agent_repo = Path(os.environ.get("CURATION_AGENT_REPO", ""))

SAVE_DIR = _data_dir / "received_articles"
SAVE_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(SAVE_DIR)), name="static")

# AgentRunner (None if agent repo not configured)
runner: Optional[AgentRunner] = None
if _agent_repo.exists():
    runner = AgentRunner(agent_repo=_agent_repo, data_dir=_data_dir, db=db)
else:
    logging.warning("CURATION_AGENT_REPO not set or not found — analysis features disabled")


def _require_runner() -> AgentRunner:
    if runner is None:
        raise HTTPException(503, "Agent runner not configured (set CURATION_AGENT_REPO)")
    return runner


# ==================================================================
# Existing article ingestion routes (unchanged)
# ==================================================================

class ArticlePayload(BaseModel):
    title: str
    author: str
    account: str
    date: str
    url: str
    html: str
    biz: Optional[str] = None
    avatar: Optional[str] = None
    digest: Optional[str] = None
    cover_url: Optional[str] = None
    is_original: bool = False


@app.get("/accounts")
async def get_accounts():
    accounts = db.get_accounts()
    for acc in accounts:
        acc["article_count"] = db.get_article_count_by_account(acc["id"])
    return {"status": "ok", "data": accounts}


class SubscribeRequest(BaseModel):
    name: str   # account name to search via dajiala API


@app.post("/accounts/subscribe")
async def subscribe_account(req: SubscribeRequest):
    try:
        info = await get_basic_info(req.name)
    except Exception as e:
        raise HTTPException(400, f"查询公众号失败: {e}")

    biz = info["biz"]
    existing = db.get_account_by_biz(biz)
    is_new = not existing or existing.get("subscription_type") != "subscribed"

    account_id = db.save_account(
        biz=biz,
        name=info["name"],
        avatar_url=info.get("avatar", ""),
        description=info.get("desc", ""),
        account_type=info.get("type", ""),
        subscription_type="subscribed",
    )

    if is_new:
        asyncio.create_task(
            _sync_account_articles(account_id, biz, info["name"],
                                   since_date=date.today().isoformat())
        )

    return {"status": "ok", "account_id": account_id, "data": dict(info)}


@app.delete("/accounts/{account_id}")
async def delete_account(account_id: int):
    acc = next((a for a in db.get_accounts() if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(404, "Account not found")
    db.delete_account(account_id)
    return {"status": "ok"}


async def _sync_account_articles(account_id: int, biz: str, account_name: str,
                                  since_date: str = None) -> int:
    """Fetch and store article metadata for an account since a given date.
    Content is NOT fetched — lazy-loaded when user opens the article.
    Returns count of new articles added."""
    if since_date is None:
        since_date = date.today().isoformat()

    try:
        history = await get_post_history(biz=biz, page=1)
    except Exception as e:
        logging.warning(f"获取文章列表失败 ({account_name}): {e}")
        return 0

    articles_raw = history.get("data", [])
    new_count = 0

    for art_meta in articles_raw:
        url = art_meta.get("url", "")
        if not url or db.get_article(url):
            continue

        post_time_str = art_meta.get("post_time_str", "")
        # No date filter — save everything from the fetched history
        title = art_meta.get("title", "")
        cover_url = art_meta.get("cover_url", "")
        digest = art_meta.get("digest", "")
        is_orig = art_meta.get("original", 0) == 1

        db.save_article(
            url=url, title=title, author="", account=account_name,
            publish_time=post_time_str, markdown_path=None,
            account_id=account_id, digest=digest,
            cover_url=cover_url, is_original=is_orig,
        )
        new_count += 1

    db.update_account_last_monitored(account_id)
    return new_count


@app.post("/accounts/{account_id}/sync")
async def sync_account(account_id: int):
    accounts = db.get_accounts()
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(404, "Account not found")
    new_count = await _sync_account_articles(account_id, acc["biz"], acc["name"])
    return {"status": "ok", "new_count": new_count}


@app.post("/accounts/sync-all")
async def sync_all_accounts():
    accounts = db.get_accounts()
    total = 0
    for acc in accounts:
        try:
            total += await _sync_account_articles(acc["id"], acc["biz"], acc["name"])
        except Exception:
            pass
    return {"status": "ok", "new_count": total}


@app.get("/articles")
async def get_articles(account_id: Optional[int] = None):
    if account_id:
        articles = db.get_articles_by_account(account_id)
    else:
        articles = db.get_all_articles()
    return {"status": "ok", "data": articles}


@app.delete("/articles/{article_id}")
async def delete_article(article_id: int):
    db.delete_article(article_id)
    return {"status": "ok", "message": "Article deleted"}


@app.post("/articles/{article_id}/read")
async def update_read_status(article_id: int, status: int = 1):
    db.update_read_status(article_id, status)
    return {"status": "ok"}


class AddArticleRequest(BaseModel):
    url: str
    subscribe: bool = False


@app.post("/articles/add")
async def add_article(req: AddArticleRequest):
    """Add a single article by URL, auto-detecting or creating the account."""
    if db.get_article(req.url):
        return {"status": "ok", "new": False}

    try:
        detail = await get_article_detail(req.url, mode="1")
    except Exception as e:
        raise HTTPException(400, f"获取文章失败: {e}")

    biz = detail.get("biz", "")
    if not biz:
        raise HTTPException(400, "无法获取公众号 biz，链接可能无效")

    title = detail.get("title", "")
    author = detail.get("author", "")
    content = detail.get("content", "")
    cover_url = detail.get("mp_head_img", "")
    publish_time = detail.get("pubtime", "")
    account_name = detail.get("nick_name", "")

    existing_acc = db.get_account_by_biz(biz)
    is_new_account = not existing_acc

    if is_new_account:
        # First time tracking this account — fetch full info from API
        try:
            acc_info = await get_basic_info(account_name)
            save_kwargs = dict(
                biz=biz, name=acc_info["name"],
                avatar_url=acc_info.get("avatar", "") or cover_url,
                description=acc_info.get("desc", ""),
                account_type=acc_info.get("type", ""),
            )
        except Exception:
            save_kwargs = dict(biz=biz, name=account_name, avatar_url=cover_url)
    else:
        save_kwargs = dict(biz=biz, name=account_name, avatar_url=cover_url)

    if existing_acc and existing_acc["subscription_type"] == "subscribed":
        sub_type = "subscribed"
    else:
        sub_type = "subscribed" if req.subscribe else "temporary"

    account_id = db.save_account(**save_kwargs, subscription_type=sub_type)

    if is_new_account and req.subscribe:
        asyncio.create_task(
            _sync_account_articles(account_id, biz, account_name,
                                   since_date=date.today().isoformat())
        )

    short_id = _extract_short_id(req.url)
    art_dir = SAVE_DIR / short_id
    art_dir.mkdir(parents=True, exist_ok=True)
    header = (f"# {title}\n\n**公众号**: {account_name}\n"
              f"**作者**: {author or account_name}\n"
              f"**原文**: {req.url}\n\n---\n\n")
    md_file = art_dir / "article.md"
    md_file.write_text(header + content, encoding="utf-8")
    (art_dir / "meta.json").write_text(json.dumps({
        "title": title, "author": author, "account": account_name,
        "url": req.url, "biz": biz, "short_id": short_id,
        "markdown_file": str(md_file),
        "received_at": datetime.now().strftime("%Y%m%d_%H%M%S"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    db.save_article(
        url=req.url, title=title, author=author, account=account_name,
        publish_time=publish_time, markdown_path=str(md_file),
        account_id=account_id, cover_url=cover_url,
    )
    return {"status": "ok", "new": True}


@app.get("/check")
async def check_article(url: str):
    record = db.get_article(url)
    if record:
        markdown_content = ""
        md_path_str = record.get("markdown_path") or record.get("markdown_file")
        if md_path_str:
            md_path = Path(md_path_str)
            if md_path.exists():
                markdown_content = md_path.read_text(encoding="utf-8")
        html_filename = ""
        html_path_str = record.get("html_path") or record.get("html_file")
        if html_path_str:
            html_filename = Path(html_path_str).name
        return {
            "status": "cached",
            "message": f"Article found in cache: {record['title']}",
            "data": {**dict(record), "markdown": markdown_content,
                     "html_filename": html_filename}
        }
    return {"status": "not_found"}


def _extract_short_id(url: str) -> str:
    """Extract the short ID from a WeChat article URL like /s/{id}."""
    import re
    m = re.search(r"/s/([A-Za-z0-9_\-]+)", url)
    if m:
        return m.group(1)
    # fallback: timestamp-based
    return datetime.now().strftime("%Y%m%d_%H%M%S")


@app.post("/process")
async def process_article(article: ArticlePayload):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    short_id = _extract_short_id(article.url)

    print(f"\n[{ts}] Processing: {article.title} (short_id={short_id})")

    clean_html = article.html
    if "<head>" in clean_html:
        clean_html = clean_html.replace(
            "<head>", '<head><meta name="referrer" content="no-referrer">', 1)
    else:
        clean_html = (f'<html><head><meta name="referrer" content="no-referrer">'
                      f'</head><body>{clean_html}</body></html>')

    clean_html = clean_html.replace('data-src="', 'src="')

    style_injection = """
    <style>
        body {
            background: #f8fafc;
            display: flex;
            justify-content: center;
            padding: 40px 20px;
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .article-container {
            background: white;
            max-width: 720px;
            width: 100%;
            padding: 40px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1);
            border-radius: 12px;
            line-height: 1.8;
            color: #1e293b;
        }
        img { max-width: 100% !important; height: auto !important; border-radius: 8px; margin: 16px 0; }
        iframe { max-width: 100% !important; }
    </style>
    """
    if "</head>" in clean_html:
        clean_html = clean_html.replace("</head>", f"{style_injection}</head>", 1)
    elif "<body>" in clean_html:
        clean_html = clean_html.replace("<body>", f"<body>{style_injection}", 1)
    else:
        clean_html = f"{style_injection}{clean_html}"

    if "<body>" in clean_html:
        clean_html = clean_html.replace(
            "<body>", '<body><div class="article-container">', 1)
        clean_html = clean_html.replace("</body>", '</div></body>', 1)
    else:
        clean_html = f'<div class="article-container">{clean_html}</div>'

    art_dir = SAVE_DIR / short_id
    art_dir.mkdir(parents=True, exist_ok=True)

    html_file = art_dir / "article.html"
    html_file.write_text(clean_html, encoding="utf-8")

    msg = ""
    markdown_content = ""
    md_file = None

    try:
        markdown_body = cleaner.clean(article.html)
        header = f"# {article.title}\n\n"
        if article.account:
            header += f"**公众号**: {article.account}\n"
        if article.author:
            header += f"**作者**: {article.author}\n"
        if article.date:
            header += f"**日期**: {article.date}\n"
        header += f"**原文**: {article.url}\n\n---\n\n"
        markdown_content = header + markdown_body

        md_file = art_dir / "article.md"
        md_file.write_text(markdown_content, encoding="utf-8")
        msg = f"Successfully processed and cleaned: {article.title}"
        print(f"  ✅ Saved Markdown: {md_file}")

        account_id = None
        if article.biz:
            account_id = db.save_account(
                biz=article.biz, name=article.account,
                avatar_url=article.avatar)

        db.save_article(
            url=article.url, title=article.title, author=article.author,
            account=article.account, publish_time=article.date,
            html_path=str(html_file),
            markdown_path=str(md_file),
            account_id=account_id, digest=article.digest,
            cover_url=article.cover_url, is_original=article.is_original)
    except Exception as e:
        markdown_content = f"Error during cleaning: {e}"
        md_file = None
        msg = f"Processed article but cleaning failed: {e}"
        print(f"  ⚠️ Cleaning failed: {e}")

    meta_file = art_dir / "meta.json"
    meta = {
        "title": article.title, "author": article.author,
        "account": article.account, "date": article.date,
        "url": article.url,
        "short_id": short_id,
        "html_file": str(html_file),
        "markdown_file": str(md_file) if md_file else None,
        "html_length": len(article.html),
        "markdown_length": len(markdown_content),
        "received_at": ts,
    }
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                         encoding="utf-8")

    return {
        "status": "ok", "message": msg, "url": article.url,
        "html_filename": html_file.name,
        "markdown_preview": markdown_content[:500] + "...",
        "files": {
            "html": str(html_file),
            "markdown": str(md_file) if md_file else None,
            "meta": str(meta_file),
        },
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


async def _scheduled_sync_loop():
    """Every 12 hours, pull today's article metadata for all subscribed accounts."""
    while True:
        await asyncio.sleep(12 * 60 * 60)
        today = date.today().isoformat()
        accounts = db.get_accounts()
        for acc in accounts:
            if acc.get("subscription_type") == "subscribed":
                try:
                    await _sync_account_articles(acc["id"], acc["biz"], acc["name"],
                                                 since_date=today)
                except Exception as e:
                    logging.warning(f"Scheduled sync failed for {acc['name']}: {e}")


@app.on_event("startup")
async def startup():
    asyncio.create_task(_scheduled_sync_loop())
    asyncio.create_task(_queue_monitor_loop())
    asyncio.create_task(_try_process_queue())


# ==================================================================
# Analysis management routes (new)
# ==================================================================

class AnalyzeRequest(BaseModel):
    agent_commit_hash: Optional[str] = None   # None = HEAD
    backend: str = "claude"


class ServingRunRequest(BaseModel):
    run_id: Optional[int] = None   # None = clear serving run


@app.patch("/articles/{article_id}/serving-run")
async def set_serving_run(article_id: int, req: ServingRunRequest):
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")
    db.set_serving_run(article_id, req.run_id)
    return {"status": "ok"}


@app.get("/articles/{article_id}/raw")
async def get_article_raw(article_id: int):
    """Returns the raw markdown, lazy-fetching from API if not cached."""
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")
    md_path = article.get("markdown_path")
    if md_path and Path(md_path).exists():
        return {"content": Path(md_path).read_text(encoding="utf-8")}
    try:
        content = await _fetch_and_cache_content(article)
    except Exception as e:
        raise HTTPException(500, f"拉取文章内容失败: {e}")
    return {"content": content}


async def _fetch_and_cache_content(article: dict) -> str:
    """Lazy-fetch article content from API and cache to disk. Returns full markdown."""
    url = article.get("url", "")
    detail = await get_article_detail(url, mode="1")
    title = article.get("title", "") or detail.get("title", "")
    author = detail.get("author", "") or article.get("author", "")
    account_name = article.get("account", "") or detail.get("nick_name", "")
    content = detail.get("content", "")

    short_id = _extract_short_id(url)
    art_dir = SAVE_DIR / short_id
    art_dir.mkdir(parents=True, exist_ok=True)
    header = (f"# {title}\n\n**公众号**: {account_name}\n"
              f"**作者**: {author or account_name}\n"
              f"**原文**: {url}\n\n---\n\n")
    md_file = art_dir / "article.md"
    md_file.write_text(header + content, encoding="utf-8")
    db.update_markdown_path(article["id"], str(md_file))
    return header + content


@app.get("/articles/{article_id}/content")
async def get_article_content(article_id: int):
    """Returns content to display. Lazy-fetches from API if not cached."""
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")

    serving_run_id = article.get("serving_run_id")

    if serving_run_id:
        try:
            r = _require_runner()
            content = r.read_workspace_file(serving_run_id, "final_output.md")
            if content:
                return {"serving_run_id": serving_run_id, "source": "analysis",
                        "content": content}
        except HTTPException:
            pass

    md_path = article.get("markdown_path")
    if md_path and Path(md_path).exists():
        return {"serving_run_id": None, "source": "raw",
                "content": Path(md_path).read_text(encoding="utf-8")}

    # No cache — fetch from API
    try:
        content = await _fetch_and_cache_content(article)
    except Exception as e:
        raise HTTPException(500, f"拉取文章内容失败: {e}")
    return {"serving_run_id": None, "source": "raw", "content": content}


async def _start_analysis_run(article_id: int, backend: str = "claude") -> int:
    """Create a DB run record, set workspace, launch pipeline. Returns run_id."""
    r = _require_runner()
    article = db.get_article_by_id(article_id)
    info = r.get_current_commit()
    commit_hash = info.get("hash", "HEAD")
    commit_msg = info.get("message", "")
    short_id = _extract_short_id(article.get("url", ""))
    run_id = db.create_run(
        article_id=article_id,
        agent_commit_hash=commit_hash,
        agent_commit_message=commit_msg,
        backend=backend,
        workspace_path="",
    )
    workspace_name = f"{short_id}-{run_id}" if short_id else str(run_id)
    workspace = r.analyses_dir / workspace_name
    db.conn.execute("UPDATE analysis_runs SET workspace_path = ? WHERE id = ?",
                    (str(workspace), run_id))
    db.conn.commit()
    r.trigger_pipeline(run_id)
    return run_id


async def _try_process_queue():
    """Start pending queue items if auto_launch and concurrency allow."""
    if runner is None:
        return
    if db.get_setting("auto_launch", "true") != "true":
        return
    max_concurrency = int(db.get_setting("max_concurrency", "2"))
    all_entries = db.get_queue_all()
    running_count = sum(1 for e in all_entries if e["status"] == "running")
    slots = max_concurrency - running_count
    if slots <= 0:
        return
    pending = db.get_pending_queue(limit=slots)
    for entry in pending:
        article = db.get_article_by_id(entry["article_id"])
        if not article:
            continue
        # Ensure content is cached before analysis
        md_path = article.get("markdown_path")
        if not md_path or not Path(md_path).exists():
            try:
                await _fetch_and_cache_content(article)
                article = db.get_article_by_id(entry["article_id"])
            except Exception as e:
                logging.warning(f"Failed to cache content for article {entry['article_id']}: {e}")
                db.update_queue_entry(entry["article_id"], "failed")
                continue
        try:
            run_id = await _start_analysis_run(entry["article_id"])
            db.update_queue_entry(entry["article_id"], "running", run_id=run_id)
        except Exception as e:
            logging.warning(f"Failed to start analysis run for article {entry['article_id']}: {e}")
            db.update_queue_entry(entry["article_id"], "failed")


async def _queue_monitor_loop():
    """Check running queue entries for completion every 10s, then try to process more."""
    while True:
        await asyncio.sleep(10)
        all_entries = db.get_queue_all()
        for entry in all_entries:
            if entry["status"] != "running" or not entry.get("run_id"):
                continue
            run = db.get_run(entry["run_id"])
            if not run:
                continue
            if run["overall_status"] == "done":
                db.set_serving_run(entry["article_id"], entry["run_id"])
                db.update_queue_entry(entry["article_id"], "done")
                await _try_process_queue()
            elif run["overall_status"] == "failed":
                db.update_queue_entry(entry["article_id"], "failed")
                await _try_process_queue()


@app.post("/articles/{article_id}/request-analysis")
async def request_analysis(article_id: int):
    """Enqueue article for AI analysis (or increment request count). Returns current status."""
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")

    entry = db.get_queue_entry(article_id)
    # Already done or running — just return current status
    if entry and entry["status"] in ("done", "running"):
        return {"analysis_status": entry["status"], "run_id": entry.get("run_id")}

    entry = db.enqueue_analysis(article_id)
    asyncio.create_task(_try_process_queue())
    return {"analysis_status": entry["status"], "run_id": entry.get("run_id")}


@app.get("/articles/{article_id}/analysis-status")
async def get_analysis_status(article_id: int):
    entry = db.get_queue_entry(article_id)
    if not entry:
        return {"analysis_status": "none"}
    return {"analysis_status": entry["status"], "run_id": entry.get("run_id")}


@app.get("/queue")
async def get_queue():
    return {"status": "ok", "data": db.get_queue_all()}


class StrategyUpdate(BaseModel):
    auto_launch: Optional[bool] = None
    max_concurrency: Optional[int] = None


@app.get("/strategy")
async def get_strategy():
    return {
        "status": "ok",
        "data": {
            "auto_launch": db.get_setting("auto_launch", "true") == "true",
            "max_concurrency": int(db.get_setting("max_concurrency", "2")),
        }
    }


@app.patch("/strategy")
async def update_strategy(req: StrategyUpdate):
    if req.auto_launch is not None:
        db.set_setting("auto_launch", "true" if req.auto_launch else "false")
        if req.auto_launch:
            asyncio.create_task(_try_process_queue())
    if req.max_concurrency is not None:
        db.set_setting("max_concurrency", str(max(1, req.max_concurrency)))
        asyncio.create_task(_try_process_queue())
    return {
        "status": "ok",
        "data": {
            "auto_launch": db.get_setting("auto_launch", "true") == "true",
            "max_concurrency": int(db.get_setting("max_concurrency", "2")),
        }
    }


@app.post("/articles/{article_id}/analyze")
async def trigger_analysis(article_id: int, req: AnalyzeRequest):
    r = _require_runner()
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")

    # Resolve commit hash
    commit_hash = req.agent_commit_hash
    commit_msg = ""
    if not commit_hash:
        info = r.get_current_commit()
        commit_hash = info.get("hash", "HEAD")
        commit_msg = info.get("message", "")
    else:
        # Find commit message from version list
        for v in r.get_agent_versions(100):
            if v["hash"].startswith(commit_hash) or v["short_hash"] == commit_hash:
                commit_hash = v["hash"]
                commit_msg = v["message"]
                break

    # Derive short_id for workspace naming
    short_id = _extract_short_id(article.get("url", "") if article else "")

    run_id = db.create_run(
        article_id=article_id,
        agent_commit_hash=commit_hash,
        agent_commit_message=commit_msg,
        backend=req.backend,
        workspace_path="",   # set after we have the id
    )
    workspace_name = f"{short_id}-{run_id}" if short_id else str(run_id)
    workspace = r.analyses_dir / workspace_name
    db.update_stage(run_id, "deconstruct", "pending")
    db.conn.execute("UPDATE analysis_runs SET workspace_path = ? WHERE id = ?",
                    (str(workspace), run_id))
    db.conn.commit()

    r.trigger_pipeline(run_id)
    return {"status": "ok", "run_id": run_id}


@app.post("/runs/{run_id}/stage/{stage}")
async def retrigger_stage(run_id: int, stage: str):
    r = _require_runner()
    valid = {"deconstruct", "evaluate", "synthesize", "write"}
    if stage not in valid:
        raise HTTPException(400, f"stage must be one of: {sorted(valid)}")
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    r.trigger_stage(run_id, stage)
    return {"status": "ok", "run_id": run_id, "stage": stage}


@app.get("/articles/{article_id}/runs")
async def get_article_runs(article_id: int):
    article = db.get_article_by_id(article_id)
    if not article:
        raise HTTPException(404, "Article not found")
    runs = db.get_runs_for_article(article_id)
    return {"status": "ok", "data": runs}


@app.get("/runs/{run_id}")
async def get_run(run_id: int):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return {"status": "ok", "data": run}


@app.get("/runs/{run_id}/files")
async def list_run_files(run_id: int):
    r = _require_runner()
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return {"status": "ok", "data": r.list_workspace_files(run_id)}


@app.get("/runs/{run_id}/files/{filepath:path}")
async def get_run_file(run_id: int, filepath: str):
    r = _require_runner()
    content = r.read_workspace_file(run_id, filepath)
    if content is None:
        raise HTTPException(404, f"File '{filepath}' not found in run {run_id}")
    return {"status": "ok", "filepath": filepath, "content": content}


@app.websocket("/runs/{run_id}/progress")
async def run_progress_ws(websocket: WebSocket, run_id: int, token: Optional[str] = None):
    # Validate token before accepting
    if token:
        try:
            claims = await verify_authing_token(token)
            sub = claims.get("sub")
            user = db.get_user_by_sub(sub) if sub else None
            if not user or not user["is_active"]:
                await websocket.close(code=4001)
                return
        except Exception:
            await websocket.close(code=4001)
            return
    r = _require_runner()
    await websocket.accept()
    # Send current state immediately
    run = db.get_run(run_id)
    if run:
        await websocket.send_json({"type": "snapshot", "run_id": run_id, "data": run})
    try:
        async for event in r.subscribe_progress(run_id):
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass


# ==================================================================
# Agent version routes
# ==================================================================

@app.get("/agent/versions")
async def get_agent_versions(n: int = 20):
    r = _require_runner()
    return {"status": "ok", "data": r.get_agent_versions(n)}


@app.get("/agent/versions/current")
async def get_current_version():
    r = _require_runner()
    return {"status": "ok", "data": r.get_current_commit()}


if __name__ == "__main__":
    print(f"Backend started.")
    print(f"  Data dir:   {_data_dir}")
    print(f"  Agent repo: {_agent_repo}")
    uvicorn.run(app, host="0.0.0.0", port=8889)
