import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { fetchCardSources, fetchClusterSources } from "../lib/api";
import { mdComponents, stripFrontmatter } from "../lib/markdown";
import type { CardSource } from "../types";
import { formatReadingSummary } from "../lib/readingMetrics";

interface SourceCardsDrawerProps {
  /** Aggregated card mode (inbox): drawer fetches sources via /cards/{id}/sources */
  cardId?: string | null;
  /** Cluster mode (admin queue, pre-dispatch): drawer fetches via /dedup/clusters/{sig}/sources */
  clusterSignature?: string | null;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Called when user clicks "查看原文" on a source frame.
   *  articleTitle / articleUrl come from WechatArticle (title may be null). */
  onOpenArticle: (
    articleId: string,
    articleTitle?: string | null,
    articleUrl?: string | null,
  ) => void;
}

export function SourceCardsDrawer({
  cardId,
  clusterSignature,
  isOpen,
  onClose,
  title,
  subtitle,
  onOpenArticle,
}: SourceCardsDrawerProps) {
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

  const queryKey = cardId
    ? ["cardSources", cardId]
    : ["clusterSources", clusterSignature];

  const { data: sources = [], isLoading } = useQuery<CardSource[]>({
    queryKey,
    queryFn: () => {
      if (cardId) return fetchCardSources(cardId);
      if (clusterSignature) return fetchClusterSources(clusterSignature);
      return Promise.resolve([]);
    },
    enabled: isOpen && (!!cardId || !!clusterSignature),
    staleTime: 60_000,
  });

  if (!isOpen || (!cardId && !clusterSignature)) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()} style={{ overflow: "hidden" }}>
        <header style={{
          position: "sticky", top: 0, zIndex: 1,
          background: "var(--bg-base)",
          borderBottom: "1px solid var(--bg-panel)",
          padding: "12px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{title ?? `原卡片（${sources.length}）`}</div>
            {subtitle && (
              <div style={{ marginTop: 2, color: "var(--text-muted)", fontSize: "var(--fs-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {subtitle}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </header>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0, overflowY: "auto" }}>
          {isLoading && (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>加载中…</div>
          )}
          {sources.map((s) => (
            <article key={s.card_id} style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 16,
              background: "var(--bg-base)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
                <h3 style={{ fontSize: "var(--fs-md)", fontWeight: 500, margin: 0, flex: 1, minWidth: 0 }}>
                  {s.title}
                </h3>
                {s.article && (
                  <button
                    onClick={() => onOpenArticle(s.article!.short_id, s.article!.title, s.article!.url)}
                    style={{
                      padding: "3px 9px",
                      fontSize: "var(--fs-xs)",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-primary)",
                      borderRadius: 4,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    查看原文
                  </button>
                )}
              </div>
              {s.article && (
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
                  {s.article.account ?? ""}{s.article.publish_time ? ` · ${s.article.publish_time.slice(0, 10)}` : ""}
                  {formatReadingSummary(s.word_count, s.reading_minutes) ? ` · ${formatReadingSummary(s.word_count, s.reading_minutes)}` : ""}
                </div>
              )}
              <div className="markdown-body" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {stripFrontmatter(s.content ?? s.description ?? "")}
                </ReactMarkdown>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
