#!/usr/bin/env python3
"""
Seed script: fetch 腾讯研究院 articles and create fake analysis runs.
Usage: DAJIALA_API_KEY=xxx python seed_tencent.py
"""
import asyncio
import os
import sys
import json
import shutil
from datetime import datetime
from pathlib import Path

# ── Path setup ──────────────────────────────────────────────────────────────
SERVER_DIR = Path(__file__).parent
sys.path.insert(0, str(SERVER_DIR))

os.environ.setdefault("DAJIALA_API_KEY", "JZL457fbb6f5fa6c1b8")
os.environ.setdefault("CURATION_DATA_DIR",
                       "/Volumes/Extreme/Efficiency/curation-data")

from utils import get_basic_info, get_post_history, get_article_html
from cleaner import cleaner
from database import ArticleDB

DATA_DIR  = Path(os.environ["CURATION_DATA_DIR"])
RECV_DIR  = DATA_DIR / "received_articles"
ANAL_DIR  = DATA_DIR / "analyses"
RECV_DIR.mkdir(parents=True, exist_ok=True)
ANAL_DIR.mkdir(parents=True, exist_ok=True)

db = ArticleDB(DATA_DIR / "articles.db")

# ── Fake final_output template ───────────────────────────────────────────────

def make_fake_final_output(title: str, account: str, author: str,
                            date: str, url: str, markdown_body: str) -> str:
    """Generate a plausible fake final_output.md for demo purposes."""
    # Extract first 300 chars as excerpt
    excerpt = markdown_body[:300].strip().replace("\n", " ")
    return f"""# {title}

> 原文标题：{title}
> 来源：{account} · {date}
> 作者：{author or account}
> 原文链接：{url}

[阅读提示：本文由腾讯研究院发布，核心交付为行业观察与政策分析框架。内容具有较高认知增量，建议完整阅读。风险提示：部分数据引用需关注时效性。]

---

{markdown_body[:2000]}

---

## 来源与未推送

**来源**：{account}（{date}）
**未推送内容**：文章中的引用数据表格、外部链接列表已过滤，保留核心论述。
"""


def make_fake_delivery_plan(title: str) -> str:
    return f"""# Delivery Plan

## 全局裁断摘要
- 整体价值判断：本文具有中等偏高知识增量，以政策解读与行业趋势分析为主。
- 交付策略：全文推送核心论述，过滤冗余数据引用。
- 联合判读结论：信息密度适中，适合推送。

## IOG 裁决列表

### iog_01：{title} — 核心论点
- 交付形态：全文推送
- 裁决理由：核心观点具有较高认知价值，目标用户匹配度高。
- 编辑批注：保留原文主要论述结构，补充背景说明。
"""


def make_fake_tone_field(title: str, account: str) -> str:
    return f"""# 调性场

- core_objective: 向读者传递{account}对相关领域的研究观点与政策解读
- target_audience: 科技行业从业者、政策研究者、互联网领域关注者
- attitude_direction: 理性分析，客观呈现，略带倡导性
- genre: 研究报告摘要 / 行业观察
- title: {title}
"""


# ── Main ─────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("Step 1: 获取腾讯研究院基础信息")
    print("=" * 60)

    info = await get_basic_info("腾讯研究院")
    print(f"  名称: {info['name']}")
    print(f"  biz:  {info['biz']}")
    print(f"  类型: {info.get('type', 'N/A')}")
    print(f"  简介: {info.get('desc', '')[:60]}")

    biz = info["biz"]
    account_name = info["name"]
    avatar_url = info.get("avatar", "")

    # Save account
    account_id = db.save_account(
        biz=biz,
        name=account_name,
        avatar_url=avatar_url,
        description=info.get("desc", ""),
        account_type=info.get("type", ""),
    )
    print(f"\n  ✓ 账号已写入 DB (account_id={account_id})")

    print("\n" + "=" * 60)
    print("Step 2: 获取历史发文列表（取前 5 篇）")
    print("=" * 60)

    history = await get_post_history(biz=biz, page=1)
    articles_raw = history["data"][:5]
    print(f"  共获取 {len(articles_raw)} 篇文章")
    for i, a in enumerate(articles_raw):
        print(f"  [{i+1}] {a['title'][:50]}  ({a['post_time_str']})")

    print("\n" + "=" * 60)
    print("Step 3: 逐篇抓取 HTML + 转 Markdown + 写库")
    print("=" * 60)

    saved_ids = []

    for idx, art_meta in enumerate(articles_raw):
        url   = art_meta["url"]
        title = art_meta["title"]
        date  = art_meta["post_time_str"]
        print(f"\n  [{idx+1}/5] {title[:50]}")

        # Skip if already in DB
        existing = db.get_article(url)
        if existing:
            print(f"    → 已在 DB，跳过抓取 (id={existing['id']})")
            saved_ids.append(existing["id"])
            continue

        # Fetch HTML
        try:
            html_data = await get_article_html(url)
        except Exception as e:
            print(f"    ✗ 抓取失败: {e}")
            continue

        html      = html_data.get("html", "")
        author    = html_data.get("author", "")
        cover_url = art_meta.get("cover_url", "")
        digest    = art_meta.get("digest", "")
        is_orig   = art_meta.get("original", 0) == 1

        # Convert to Markdown
        try:
            md_body = cleaner.clean(html)
        except Exception as e:
            print(f"    ✗ Markdown 转换失败: {e}")
            md_body = ""

        header = (
            f"# {title}\n\n"
            f"**公众号**: {account_name}\n"
            f"**作者**: {author or account_name}\n"
            f"**日期**: {date}\n"
            f"**原文**: {url}\n\n---\n\n"
        )
        markdown = header + md_body

        # File names
        ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
        clean = "".join(x for x in title if x.isalnum() or x in " -_").strip()[:50]
        base  = f"{ts}_{clean}"

        html_path = RECV_DIR / f"{base}.html"
        md_path   = RECV_DIR / f"{base}.md"
        json_path = RECV_DIR / f"{base}.json"

        # Fix lazy-loaded images
        html_fixed = html.replace('data-src="', 'src="')
        html_path.write_text(
            f'<html><head><meta name="referrer" content="no-referrer"></head>'
            f'<body>{html_fixed}</body></html>',
            encoding="utf-8"
        )
        md_path.write_text(markdown, encoding="utf-8")
        json_path.write_text(json.dumps({
            "title": title, "author": author, "account": account_name,
            "date": date, "url": url, "biz": biz,
            "html_file": str(html_path), "markdown_file": str(md_path),
            "received_at": ts,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        db.save_article(
            url=url, title=title, author=author, account=account_name,
            publish_time=date,
            html_path=str(html_path), markdown_path=str(md_path),
            account_id=account_id, digest=digest,
            cover_url=cover_url, is_original=is_orig,
        )
        art = db.get_article(url)
        art_id = art["id"]
        saved_ids.append(art_id)
        print(f"    ✓ 已保存 (id={art_id})  MD={len(markdown)} chars")

        await asyncio.sleep(0.5)   # gentle rate limit

    print("\n" + "=" * 60)
    print("Step 4: 创建 fake analysis runs（模拟 AI 处理结果）")
    print("=" * 60)

    for art_id in saved_ids:
        art = db.get_article_by_id(art_id)
        if not art:
            continue

        # Check if already has a run
        existing_runs = db.get_runs_for_article(art_id)
        if existing_runs:
            run = existing_runs[0]
            print(f"  article {art_id}: 已有 run #{run['id']}，跳过")
            continue

        workspace = ANAL_DIR / str(0)  # placeholder
        run_id = db.create_run(
            article_id=art_id,
            agent_commit_hash="demo0000000000000000000000000000000000000000",
            agent_commit_message="demo: fake analysis for UI preview",
            backend="claude",
            workspace_path="",
        )
        workspace = ANAL_DIR / str(run_id)
        workspace.mkdir(parents=True, exist_ok=True)

        # Update workspace_path
        db.conn.execute(
            "UPDATE analysis_runs SET workspace_path=? WHERE id=?",
            (str(workspace), run_id)
        )
        db.conn.commit()

        # Copy source.md
        if art.get("markdown_path") and Path(art["markdown_path"]).exists():
            shutil.copy(art["markdown_path"], workspace / "source.md")

        md_path = art.get("markdown_path", "")
        md_body = Path(md_path).read_text(encoding="utf-8") if md_path and Path(md_path).exists() else ""

        # Write fake pipeline outputs
        (workspace / "tone_field.md").write_text(
            make_fake_tone_field(art["title"], art["account"] or "腾讯研究院"),
            encoding="utf-8"
        )
        iogs_dir = workspace / "iogs"
        iogs_dir.mkdir(exist_ok=True)
        (iogs_dir / "iog_01_knowledge.md").write_text(
            f"---\niog_id: \"iog_01\"\nclassification: \"Knowledge - Analytical Framework\"\n---\n\n"
            f"## 1. 认知分类判定理由\n本 IOG 以分析框架为主，提供行业观察视角。\n\n"
            f"## 2. 信息对象列表 (IOs)\n### IO_01\n- 原文锚点：{art['title'][:40]}...\n"
            f"- 核心内容压缩：{md_body[:200].strip()}\n\n## 3. 关联上下文线索\n无强依赖。\n",
            encoding="utf-8"
        )
        evals_dir = workspace / "evaluations"
        evals_dir.mkdir(exist_ok=True)
        (evals_dir / "eval_iog_01_knowledge.md").write_text(
            f"# [iog_01] 综合量化评估报告\n- 核心分类认定：Knowledge - Analytical Framework\n"
            f"- 主旨一句话：{art['title'][:60]}\n\n"
            f"## 1. 自身价值\n内容质量：2分。理由：专业性适中，论据充分。\n\n"
            f"## 2. 自身成本\n内容脱水质量：良好 / 认知路径效率：中等 / 语言编码效率：良好\n\n"
            f"## 3. 社会价值\n总体认知价值天花板：Level 2\n边际增量定位：为行业分析提供参考框架\n\n"
            f"## 4. 社会成本风险\n知识网络连接度：高 / 共识战区定位：低争议 / 排雷纪要：数据时效需关注\n\n"
            f"## 5. 用户匹配度\n知识状态匹配：良好 / 话题演进状态：活跃 / 认知偏好适配：高\n",
            encoding="utf-8"
        )
        (workspace / "delivery_plan.md").write_text(
            make_fake_delivery_plan(art["title"]), encoding="utf-8"
        )
        final_output = make_fake_final_output(
            art["title"], art["account"] or "腾讯研究院",
            art.get("author", ""), art.get("publish_time", ""), art["url"], md_body
        )
        (workspace / "final_output.md").write_text(final_output, encoding="utf-8")

        # Mark all stages done with fake elapsed times
        import random
        for stage, elapsed in [
            ("deconstruct", round(random.uniform(90, 150), 1)),
            ("evaluate",    round(random.uniform(240, 360), 1)),
            ("synthesize",  round(random.uniform(60, 120), 1)),
            ("write",       round(random.uniform(50, 90), 1)),
        ]:
            db.conn.execute(
                f"UPDATE analysis_runs SET {stage}_status='done', {stage}_elapsed_s=? WHERE id=?",
                (elapsed, run_id)
            )
        db.conn.execute(
            "UPDATE analysis_runs SET overall_status='done' WHERE id=?", (run_id,)
        )
        db.conn.commit()

        # Set as serving run
        db.set_serving_run(art_id, run_id)

        print(f"  article {art_id} «{art['title'][:40]}» → run #{run_id} ✓ (serving)")

    print("\n✅ Done! 数据库已就绪，启动 server 后刷新前端即可看到效果。")
    print(f"   articles.db: {DATA_DIR / 'articles.db'}")
    print(f"   analyses/:   {ANAL_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
