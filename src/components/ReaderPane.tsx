import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen, ExternalLink, Loader2 } from "lucide-react";
import { stripFrontmatter, mdComponents } from "../lib/markdown";
import { useCardContent } from "../hooks/useCards";
import { useArticleContent } from "../hooks/useArticles";
import { useMarkCardReadSingle } from "../hooks/useInbox";
import { FavoriteButton } from "./FavoriteButton";
import type { InboxItem, DiscardedItem } from "../types";

function routingTag(routing: "ai_curation" | "original_push") {
  if (routing === "ai_curation") {
    return <span className="inbox-tag tag-ai" style={{ fontSize: "0.72rem" }}>AI总结</span>;
  }
  return <span className="inbox-tag tag-original" style={{ fontSize: "0.72rem" }}>原文</span>;
}

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

interface ReaderPaneProps {
  selectedItem: InboxItem | null;
  selectedDiscardedItem: DiscardedItem | null;
  isDiscardedView: boolean;
  onOpenDrawer: () => void;
  onSelectAccount?: (accountId: number) => void;
}

function SourceBar({
  meta,
  routing,
  isDiscarded,
  routingReason,
  onOpenOriginal,
  onOpenDrawer,
  cardId,
}: {
  meta: { title: string; account: string; author: string | null; publish_time: string | null; url: string };
  routing?: "ai_curation" | "original_push";
  isDiscarded: boolean;
  routingReason?: string;
  onOpenOriginal: () => void;
  onOpenDrawer?: () => void;
  cardId?: string;
}) {
  return (
    <div className="reader-source-bar">
      {/* Line 1: original title + tag */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "#e6edf3", fontWeight: 500, fontSize: "0.88rem", flex: 1 }}>
          {meta.title}
        </span>
        {routing && routingTag(routing)}
        {isDiscarded && (
          <span className="inbox-tag tag-discard" style={{ fontSize: "0.72rem" }}>丢弃</span>
        )}
      </div>
      {/* Line 2: meta left, buttons right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: "0.78rem", color: "#8b949e", display: "flex", alignItems: "center", gap: 4 }}>
          <span>{meta.account}</span>
          {meta.author && <><span>·</span><span>{meta.author}</span></>}
          {meta.publish_time && <><span>·</span><span>{formatTime(meta.publish_time)}</span></>}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {cardId && (
            <FavoriteButton itemType="card" itemId={cardId} />
          )}
          {routing === "ai_curation" && onOpenDrawer && (
            <button
              onClick={onOpenDrawer}
              style={{
                background: "none", border: "1px solid #30363d", borderRadius: 6,
                color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
              }}
            >
              查看原文
            </button>
          )}
          <button
            onClick={onOpenOriginal}
            style={{
              background: "none", border: "1px solid #30363d", borderRadius: 6,
              color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <ExternalLink size={12} /> 微信原文
          </button>
        </div>
      </div>
      {routingReason && (
        <div style={{ fontSize: "0.76rem", color: "#f0883e", marginTop: 4 }}>
          丢弃原因: {routingReason}
        </div>
      )}
    </div>
  );
}

function CardContentView({ cardId }: { cardId: string }) {
  const { data: cardData, isLoading } = useCardContent(cardId, "source");

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>
        加载中...
      </div>
    );
  }

  if (!cardData?.content) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>
        暂无内容
      </div>
    );
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
        {stripFrontmatter(cardData.content)}
      </ReactMarkdown>
    </div>
  );
}

function ArticleHtmlView({ articleId }: { articleId: string }) {
  const { data: articleData, isLoading } = useArticleContent(articleId);

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>
        加载中...
      </div>
    );
  }

  const html = articleData?.rawHtml;
  if (!html) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>
        暂无原文内容
      </div>
    );
  }

  return (
    <div
      className="rich-text-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function ReaderPane({
  selectedItem,
  selectedDiscardedItem,
  isDiscardedView,
  onOpenDrawer,
}: ReaderPaneProps) {
  const markRead = useMarkCardReadSingle();
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto mark-read after 2 seconds
  useEffect(() => {
    if (markReadTimerRef.current) {
      clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = null;
    }

    if (selectedItem && !selectedItem.read_at && selectedItem.card_id) {
      markReadTimerRef.current = setTimeout(() => {
        markRead.mutate(selectedItem.card_id!);
      }, 2000);
    }

    return () => {
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
      }
    };
  }, [selectedItem?.card_id]);

  // Empty state
  if (!selectedItem && !selectedDiscardedItem) {
    return (
      <main className="reader-pane">
        <div className="reader-empty">
          <div className="reader-empty-icon"><BookOpen size={64} /></div>
          <h3>请选择一篇内容阅读</h3>
        </div>
      </main>
    );
  }

  // Discarded view
  if (isDiscardedView && selectedDiscardedItem) {
    return (
      <main className="reader-pane">
        <SourceBar
          meta={selectedDiscardedItem.article_meta}
          isDiscarded={true}
          routingReason={selectedDiscardedItem.routing_reason}
          onOpenOriginal={() => openInAppWindow(selectedDiscardedItem.article_meta.url)}
        />
        <div className="reader-content animate-in">
          <ArticleHtmlView articleId={selectedDiscardedItem.article_id} />
        </div>
      </main>
    );
  }

  // Analyzing item — show original article with indicator
  if (selectedItem && selectedItem.queue_status) {
    return (
      <main className="reader-pane">
        <div className="reader-source-bar">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
            <span style={{ color: "#e6edf3", fontWeight: 500, fontSize: "0.88rem", flex: 1 }}>
              {selectedItem.article_meta.title}
            </span>
            <span className="inbox-tag" style={{ background: "#1a2332", color: "#58a6ff", display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.72rem" }}>
              <Loader2 size={10} className="animate-spin" />
              正在分析...
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: "0.78rem", color: "#8b949e", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{selectedItem.article_meta.account}</span>
              {selectedItem.article_meta.author && <><span>·</span><span>{selectedItem.article_meta.author}</span></>}
              {selectedItem.article_meta.publish_time && <><span>·</span><span>{formatTime(selectedItem.article_meta.publish_time)}</span></>}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => openInAppWindow(selectedItem.article_meta.url)}
                style={{
                  background: "none", border: "1px solid #30363d", borderRadius: 6,
                  color: "#8b949e", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <ExternalLink size={12} /> 微信原文
              </button>
            </div>
          </div>
        </div>
        <div className="reader-content animate-in">
          <ArticleHtmlView articleId={selectedItem.article_id} />
        </div>
      </main>
    );
  }

  // Inbox item view
  if (selectedItem) {
    return (
      <main className="reader-pane">
        <SourceBar
          meta={selectedItem.article_meta}
          routing={selectedItem.routing ?? undefined}
          isDiscarded={false}
          onOpenOriginal={() => openInAppWindow(selectedItem.article_meta.url)}
          onOpenDrawer={selectedItem.routing === "ai_curation" ? onOpenDrawer : undefined}
          cardId={selectedItem.card_id ?? undefined}
        />
        <div className="reader-content animate-in">
          {/* Card content (markdown) — shown for both ai_curation and original_push */}
          {selectedItem.card_id && <CardContentView cardId={selectedItem.card_id} />}

          {/* Original push: show original article (rich text HTML) below the guide card */}
          {selectedItem.routing === "original_push" && (
            <>
              <hr style={{ margin: "32px 0", border: "none", height: 1, background: "linear-gradient(90deg, transparent, #475569, transparent)" }} />
              <ArticleHtmlView articleId={selectedItem.article_id} />
            </>
          )}
        </div>
      </main>
    );
  }

  return null;
}
