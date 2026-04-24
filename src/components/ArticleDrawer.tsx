import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { useArticleContent } from "../hooks/useArticles";
import { FavoriteButton } from "./FavoriteButton";
import { AdminAnnotationFlag } from "./AdminAnnotationFlag";
import { useAuth } from "../lib/authStore";
import { openExternal } from "../lib/platform/url-opener";
import type { InboxItem } from "../types";

interface ArticleDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  item: InboxItem | null;
  /** Other cards from the same article */
  siblingCards: InboxItem[];
  onSelectCard: (cardId: string) => void;
}

export function ArticleDrawer({
  isOpen,
  onClose,
  item,
  siblingCards,
  onSelectCard,
}: ArticleDrawerProps) {
  const articleId = item?.article_id ?? null;
  const { data: articleData, isLoading } = useArticleContent(articleId);
  const { state: authState } = useAuth();
  const isAdmin = authState.status === "authenticated" && authState.user.role === "admin";

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const html = articleData?.rawHtml;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, overflow: "hidden" }}>
            <button className="btn-icon" onClick={onClose} style={{ padding: 4, flexShrink: 0 }}>
              <X size={18} />
            </button>
            <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              原文
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {articleId && (
              <FavoriteButton itemType="article" itemId={articleId} />
            )}
            {isAdmin && (item.card_id || item.article_id) && (
              <AdminAnnotationFlag cardId={item.card_id} articleId={item.article_id} />
            )}
            {siblingCards.length > 1 && (
              <div style={{ position: "relative" }}>
                <select
                  value={item.card_id ?? ""}
                  onChange={(e) => onSelectCard(e.target.value)}
                  style={{
                    background: "var(--bg-panel)", color: "var(--text-muted)", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "3px 8px", fontSize: "0.76rem", cursor: "pointer",
                    appearance: "auto",
                  }}
                >
                  {siblingCards.map((c) => (
                    <option key={c.card_id ?? c.article_id} value={c.card_id ?? ""}>
                      {c.title.slice(0, 30)}{c.title.length > 30 ? "..." : ""}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: 4 }}>
                  同文章卡片 ({siblingCards.length})
                </span>
              </div>
            )}
            <button
              className="btn-icon"
              onClick={() => openExternal(item.article_meta.url)}
              title="在浏览器打开"
              style={{ padding: 4 }}
            >
              <ExternalLink size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="drawer-content">
          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              加载中...
            </div>
          ) : html ? (
            <div
              className="rich-text-content"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              暂无原文内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
