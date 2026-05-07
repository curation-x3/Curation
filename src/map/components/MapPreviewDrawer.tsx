import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { openExternal } from "../../lib/platform/url-opener";
import { mdComponents, stripFrontmatter } from "../../lib/markdown";
import type { ArticleContent, MapCard } from "../types";

type Props = {
  open: boolean;
  card: MapCard | null;
  articleContent: ArticleContent | null;
  onClose: () => void;
};

function EntityChips({ entities }: { entities: string[] }) {
  if (!entities || entities.length === 0) return null;
  return (
    <div className="map-drawer-entities" aria-label="entities">
      {entities.map((e) => (
        <span key={e} className="map-drawer-entity-chip">{e}</span>
      ))}
    </div>
  );
}

export function MapPreviewDrawer({ open, card, articleContent, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !card) return null;

  const articleUrl = card.article_meta?.url ?? null;
  const html = articleContent?.rawHtml;
  const markdown = articleContent?.rawMarkdown ?? articleContent?.content_md;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer-panel map-reader-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="map-reader-drawer-title">
            <button className="btn-icon" onClick={onClose} style={{ padding: 4, flexShrink: 0 }}>
              <X size={18} />
            </button>
            <span>{card.title}</span>
          </div>
          <div className="map-reader-drawer-actions">
            {articleUrl && (
              <button className="secondary-btn map-reader-original-btn" onClick={() => openExternal(articleUrl)} title="阅读原文">
                <ExternalLink size={14} />
                阅读原文
              </button>
            )}
          </div>
        </div>

        <div className="drawer-content map-reader-drawer-content">
          <div className="card-frame map-reader-card-frame">
            <div className="card-frame-label">卡片</div>
            <div className="map-reader-card-meta">
              <span>{card.article_meta?.account ?? "—"}</span>
              <span>{card.card_date ?? "—"}</span>
              {card.topic && <span>{card.topic.domain_label} / {card.topic.label}</span>}
            </div>
            <h1 className="map-reader-card-title">{card.title}</h1>
            {card.description && <p className="map-reader-card-desc">{card.description}</p>}
            <EntityChips entities={card.entities ?? []} />
          </div>

          <div className="card-frame map-reader-card-frame">
            <div className="card-frame-label">原文</div>
            {!articleContent ? (
              <div className="map-reader-empty">正在加载原文…</div>
            ) : html ? (
              <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />
            ) : markdown ? (
              <div className="markdown-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {stripFrontmatter(markdown)}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="map-reader-empty">暂无原文内容</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
