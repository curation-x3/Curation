#!/usr/bin/env python3
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import json
from typing import Optional, List, Dict
from datetime import datetime
from pathlib import Path
from cleaner import cleaner
from database import db

app = FastAPI(title="WeChat Reader Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use absolute path for saving articles
BASE_DIR = Path(__file__).parent.absolute()
SAVE_DIR = BASE_DIR / "received_articles"
SAVE_DIR.mkdir(exist_ok=True)

# Mount the static directory to serve saved HTML files
app.mount("/static", StaticFiles(directory=str(SAVE_DIR)), name="static")


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
    return {"status": "ok", "data": db.get_accounts()}


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


@app.post("/sync")
async def sync_articles():
    """Scan received_articles directory and sync with database."""
    count = 0
    for json_file in SAVE_DIR.glob("*.json"):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if not db.get_article(data["url"]):
                # Ensure account exists
                account_id = None
                if data.get("biz"):
                    account_id = db.save_account(
                        biz=data["biz"],
                        name=data["account"],
                        avatar_url=data.get("avatar")
                    )
                
                # Find corresponding markdown
                md_path = json_file.with_suffix(".md")
                html_path = json_file.with_suffix(".html")
                
                db.save_article(
                    url=data["url"],
                    title=data["title"],
                    author=data["author"],
                    account=data["account"],
                    publish_time=data["date"],
                    html_path=str(html_path) if html_path.exists() else None,
                    markdown_path=str(md_path) if md_path.exists() else None,
                    account_id=account_id,
                    digest=data.get("digest"),
                    cover_url=data.get("cover_url"),
                    is_original=data.get("is_original", False)
                )
                count += 1
        except Exception as e:
            print(f"Error syncing {json_file.name}: {e}")
            
    return {"status": "ok", "message": f"Synced {count} new articles"}


@app.get("/check")
async def check_article(url: str):
    record = db.get_article(url)
    if record:
        markdown_content = ""
        md_path_str = record.get("markdown_path") or record.get("markdown_file") # Support old/new naming
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
            "data": {
                **dict(record),
                "markdown": markdown_content,
                "html_filename": html_filename
            }
        }
    return {"status": "not_found"}


@app.post("/process")
async def process_article(article: ArticlePayload):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    clean_title = "".join(x for x in article.title if x.isalnum() or x in " -_").strip()[:50]
    filename_base = f"{ts}_{clean_title}"

    print(f"\n[{ts}] Processing: {article.title}")

    # 1. Save full HTML with no-referrer meta to bypass image hotlinking in Source view
    # Add no-referrer to bypass anti-scraping
    clean_html = article.html
    if "<head>" in clean_html:
        clean_html = clean_html.replace("<head>", '<head><meta name="referrer" content="no-referrer">', 1)
    else:
        # Fallback if no head tag, create a basic HTML structure
        clean_html = f'<html><head><meta name="referrer" content="no-referrer"></head><body>{clean_html}</body></html>'

    # Fix image lazy loading (data-src -> src)
    clean_html = clean_html.replace('data-src="', 'src="')
    
    # Add some basic styling to make it look premium
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
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
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
    else:
        # If no </head> (unlikely with previous check), try to inject at start of body or just prepend
        if "<body>" in clean_html:
            clean_html = clean_html.replace("<body>", f"<body>{style_injection}", 1)
        else:
            clean_html = f"{style_injection}{clean_html}" # Last resort, might not be valid HTML

    if "<body>" in clean_html:
        clean_html = clean_html.replace("<body>", '<body><div class="article-container">', 1)
        clean_html = clean_html.replace("</body>", '</div></body>', 1)
    else:
        # Fallback if no body tag, wrap the entire content
        clean_html = f'<div class="article-container">{clean_html}</div>'

    html_file = SAVE_DIR / f"{filename_base}.html"
    html_file.write_text(clean_html, encoding="utf-8")
    
    msg = ""
    markdown_content = ""
    md_file = None

    # 2. Clean HTML to Markdown and Prepend Metadata
    try:
        markdown_body = cleaner.clean(article.html)
        
        # Construct header
        header = f"# {article.title}\n\n"
        if article.account:
            header += f"**公众号**: {article.account}\n"
        if article.author:
            header += f"**作者**: {article.author}\n"
        if article.date:
            header += f"**日期**: {article.date}\n"
        header += f"**原文**: {article.url}\n\n"
        header += "---\n\n"
        
        markdown_content = header + markdown_body
        
        md_file = SAVE_DIR / f"{filename_base}.md"
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(markdown_content)
        msg = f"Successfully processed and cleaned: {article.title}"
        print(f"  ✅ Saved Markdown: {md_file.name}")
        
        # 3. Save to Database
        account_id = None
        if article.biz:
            account_id = db.save_account(
                biz=article.biz,
                name=article.account,
                avatar_url=article.avatar
            )
        
        db.save_article(
            url=article.url,
            title=article.title,
            author=article.author,
            account=article.account,
            publish_time=article.date,
            html_path=str(html_file),
            markdown_path=str(md_file),
            account_id=account_id,
            digest=article.digest,
            cover_url=article.cover_url,
            is_original=article.is_original
        )
    except Exception as e:
        markdown_content = f"Error during cleaning: {e}"
        md_file = None
        msg = f"Processed article but cleaning failed: {e}"
        print(f"  ⚠️ Cleaning failed: {e}")

    # 4. Save Metadata JSON (Legacy, but keeping for compatibility)
    meta_file = SAVE_DIR / f"{filename_base}.json"
    meta = {
        "title": article.title,
        "author": article.author,
        "account": article.account,
        "date": article.date,
        "url": article.url,
        "html_file": str(html_file),
        "markdown_file": str(md_file) if md_file else None,
        "html_length": len(article.html),
        "markdown_length": len(markdown_content),
        "received_at": ts,
    }
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return {
        "status": "ok",
        "message": msg,
        "url": article.url,
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


if __name__ == "__main__":
    print(f"Backend started. Saving to: {SAVE_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=8889)
