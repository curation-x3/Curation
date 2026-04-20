import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen, ExternalLink, X } from "lucide-react";
import { stripFrontmatter, mdComponents } from "../lib/markdown";
import { useCardContent } from "../hooks/useCards";
import { useArticleContent } from "../hooks/useArticles";
import { FavoriteButton } from "./FavoriteButton";
import type { FavoriteItem } from "../types";
import { apiFetch } from "../lib/api";

function formatTime(t: string | null) {
  if (!t) return "";
  return t.replace("T", " ").slice(0, 16);
}

async function openInAppWindow(url: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url_window", { url });
  } catch {
    window.open(url, "_blank");
  }
}

function routingTag(routing: string | null) {
  if (routing === "ai_curation") {
    return <span className="inbox-tag tag-ai" style={{ fontSize: "var(--fs-xs)" }}>AI总结</span>;
  }
  if (routing === "original_push") {
    return <span className="inbox-tag tag-original" style={{ fontSize: "var(--fs-xs)" }}>原文</span>;
  }
  return null;
}

/** Drawer for viewing article's cards when a favorited article is selected */
function CardsDrawer({
  isOpen,
  onClose,
  articleId,
}: {
  isOpen: boolean;
  onClose: () => void;
  articleId: string;
}) {
  const [cards, setCards] = useState<{ card_id: string; title: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !articleId) return;
    setLoading(true);
    apiFetch(`/articles/${articleId}/content`)
      .then((r) => r.json())
      .then((data) => {
        setCards(data.cards ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen, articleId]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <button className="btn-icon" onClick={onClose} style={{ padding: 4 }}>
              <X size={18} />
            </button>
            <span style={{ fontWeight: 600, fontSize: "var(--fs-base)", color: "#e6edf3" }}>
              AI 卡片
            </span>
          </div>
        </div>
        <div className="drawer-content">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>加载中...</div>
          ) : cards.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>暂无卡片</div>
          ) : (
            cards.map((card, idx) => (
              <div key={card.card_id}>
                {cards.length > 1 && (
                  <div style={{
                    padding: "8px 0", fontSize: "var(--fs-sm)", color: "#8b949e", fontWeight: 600,
                    borderBottom: "1px solid #30363d", marginBottom: 12,
                  }}>
                    卡片 {idx + 1}/{cards.length}
                    {card.title && <span style={{ marginLeft: 8, fontWeight: 400 }}>{card.title}</span>}
                  </div>
                )}
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>
                    {stripFrontmatter(card.content)}
                  </ReactMarkdown>
                </div>
                {idx < cards.length - 1 && (
                  <hr style={{ margin: "24px 0", border: "none", height: 2, background: "linear-gradient(90deg, transparent, #475569, transparent)" }} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Drawer for viewing article original HTML when a favorited card is selected */
function OriginalDrawer({
  isOpen,
  onClose,
  articleId,
  articleUrl,
}: {
  isOpen: boolean;
  onClose: () => void;
  articleId: string;
  articleUrl: string | null;
}) {
  const { data: articleData, isLoading } = useArticleContent(isOpen ? articleId : null);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const html = articleData?.rawHtml;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <button className="btn-icon" onClick={onClose} style={{ padding: 4 }}>
              <X size={18} />
            </button>
            <span style={{ fontWeight: 600, fontSize: "var(--fs-base)", color: "#e6edf3" }}>
              原文
            </span>
          </div>
          {articleUrl && (
            <button
              className="btn-icon"
              onClick={() => openInAppWindow(articleUrl)}
              title="在浏览器打开"
              style={{ padding: 4 }}
            >
              <ExternalLink size={16} />
            </button>
          )}
        </div>
        <div className="drawer-content">
          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>加载中...</div>
          ) : html ? (
            <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>暂无原文内容</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FavoritesReaderProps {
  selectedFavorite: FavoriteItem | null;
}

export function FavoritesReader({ selectedFavorite }: FavoritesReaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reset drawer when selection changes
  useEffect(() => { setDrawerOpen(false); }, [selectedFavorite?.item_id]);

  if (!selectedFavorite) {
    return (
      <main className="reader-pane">
        <div className="reader-empty">
          <div className="reader-empty-icon"><BookOpen size={64} /></div>
          <h3>请选择一项收藏</h3>
        </div>
      </main>
    );
  }

  const meta = selectedFavorite.article_meta;

  if (selectedFavorite.item_type === "card") {
    return (
      <main className="reader-pane">
        {meta && (
          <div className="reader-source-bar">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#e6edf3", fontWeight: 500, fontSize: "var(--fs-base)", flex: 1 }}>
                {meta.title}
              </span>
              {routingTag(selectedFavorite.routing)}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: "var(--fs-sm)", color: "#8b949e", display: "flex", alignItems: "center", gap: 4 }}>
                <span>{meta.account}</span>
                {meta.author && <><span>·</span><span>{meta.author}</span></>}
                {meta.publish_time && <><span>·</span><span>{formatTime(meta.publish_time)}</span></>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <FavoriteButton itemType="card" itemId={selectedFavorite.item_id} />
                {selectedFavorite.article_id && (
                  <button
                    onClick={() => setDrawerOpen(true)}
                    style={{
                      background: "none", border: "1px solid #30363d", borderRadius: 6,
                      color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "var(--fs-sm)",
                    }}
                  >
                    查看原文
                  </button>
                )}
                {meta.url && (
                  <button
                    onClick={() => openInAppWindow(meta.url)}
                    style={{
                      background: "none", border: "1px solid #30363d", borderRadius: 6,
                      color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "var(--fs-sm)",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    <ExternalLink size={12} /> 微信原文
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="reader-content animate-in">
          <CardContentRenderer cardId={selectedFavorite.item_id} />
        </div>
        {selectedFavorite.article_id && (
          <OriginalDrawer
            isOpen={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            articleId={selectedFavorite.article_id}
            articleUrl={meta?.url ?? null}
          />
        )}
      </main>
    );
  }

  // Article favorite
  return (
    <main className="reader-pane">
      {meta && (
        <div className="reader-source-bar">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
            <span style={{ color: "#e6edf3", fontWeight: 500, fontSize: "var(--fs-base)", flex: 1 }}>
              {selectedFavorite.title}
            </span>
            <span className="inbox-tag" style={{ background: "#21262d", color: "#8b949e", fontSize: "var(--fs-xs)" }}>原文</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: "var(--fs-sm)", color: "#8b949e", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{meta.account}</span>
              {meta.author && <><span>·</span><span>{meta.author}</span></>}
              {meta.publish_time && <><span>·</span><span>{formatTime(meta.publish_time)}</span></>}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <FavoriteButton itemType="article" itemId={selectedFavorite.item_id} />
              <button
                onClick={() => setDrawerOpen(true)}
                style={{
                  background: "none", border: "1px solid #30363d", borderRadius: 6,
                  color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "var(--fs-sm)",
                }}
              >
                查看卡片
              </button>
              {meta.url && (
                <button
                  onClick={() => openInAppWindow(meta.url)}
                  style={{
                    background: "none", border: "1px solid #30363d", borderRadius: 6,
                    color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "var(--fs-sm)",
                    display: "flex", alignItems: "center", gap: 4,
                  }}
                >
                  <ExternalLink size={12} /> 微信原文
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="reader-content animate-in">
        <ArticleHtmlRenderer articleId={selectedFavorite.item_id} />
      </div>
      <CardsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        articleId={selectedFavorite.item_id}
      />
    </main>
  );
}

/** Renders card markdown content */
function CardContentRenderer({ cardId }: { cardId: string }) {
  const { data: cardData, isLoading } = useCardContent(cardId, "source");
  if (isLoading) return <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>加载中...</div>;
  if (!cardData?.content) return <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>暂无内容</div>;
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>
        {stripFrontmatter(cardData.content)}
      </ReactMarkdown>
    </div>
  );
}

/** Renders article HTML content */
function ArticleHtmlRenderer({ articleId }: { articleId: string }) {
  const { data: articleData, isLoading } = useArticleContent(articleId);
  if (isLoading) return <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>加载中...</div>;
  const html = articleData?.rawHtml;
  if (!html) return <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>暂无原文内容</div>;
  return <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
