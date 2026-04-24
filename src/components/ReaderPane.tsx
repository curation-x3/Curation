import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen } from "lucide-react";
import { stripFrontmatter, mdComponents } from "../lib/markdown";
import { useCardContent } from "../hooks/useCards";
import { useArticleContent } from "../hooks/useArticles";
import { useMarkCardReadSingle } from "../hooks/useInbox";
import { useAuth } from "../lib/authStore";
import { FavoriteButton } from "./FavoriteButton";
import { CardVoteBar } from "./CardVoteBar";
import { AdminAnnotationFlag } from "./AdminAnnotationFlag";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { CardFrame } from "./CardFrame";
import { TauriOnly } from "./platform/TauriOnly";
import { useChat, useAgentDetection } from "../hooks/useChat";
import type { InboxItem, DiscardedItem } from "../types";

function sourceBarTag(routing: "ai_curation" | "original_push" | null, isDiscarded: boolean) {
  if (isDiscarded) {
    return <span className="inbox-tag" style={{ fontSize: "0.72rem", color: "var(--accent-red)" }}>丢弃</span>;
  }
  if (routing === "ai_curation") {
    return <span className="inbox-tag" style={{ fontSize: "0.72rem", color: "var(--accent-blue)" }}>AI总结</span>;
  }
  if (routing === "original_push") {
    return <span className="inbox-tag" style={{ fontSize: "0.72rem", color: "var(--accent-green)" }}>原文</span>;
  }
  return null;
}

function formatTime(t: string | null) {
  if (!t) return "";
  return t.replace("T", " ").slice(0, 16);
}

interface ReaderPaneProps {
  selectedItem: InboxItem | null;
  selectedDiscardedItem: DiscardedItem | null;
  isDiscardedView: boolean;
  isHomeView?: boolean;
  cacheReady?: boolean;
  onOpenDrawer: () => void;
}

function SourceBar({
  meta,
  routing,
  isDiscarded,
  onOpenDrawer,
  cardId,
}: {
  meta: { title: string; account: string; author: string | null; publish_time: string | null; url: string };
  routing: "ai_curation" | "original_push" | null;
  isDiscarded: boolean;
  onOpenDrawer?: () => void;
  cardId?: string;
}) {
  return (
    <div className="reader-source-bar">
      {/* Line 1: original title + tag */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.88rem", flex: 1 }}>
          <span style={{ color: "var(--text-muted)" }}>原文标题：</span>
          {meta.title}
        </span>
        {sourceBarTag(routing, isDiscarded)}
      </div>
      {/* Line 2: meta left, buttons right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
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
                background: "none", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-muted)", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
              }}
            >
              查看原文
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CardContentView({ cardId }: { cardId: string }) {
  const { data: cardData, isLoading } = useCardContent(cardId, "source");

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        加载中...
      </div>
    );
  }

  if (!cardData?.content) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
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
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        加载中...
      </div>
    );
  }

  const html = articleData?.rawHtml;
  if (!html) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
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
  isHomeView,
  cacheReady,
  onOpenDrawer,
}: ReaderPaneProps) {
  const { state: authState } = useAuth();
  const isAdmin = authState.status === "authenticated" && authState.user.role === "admin";
  const markRead = useMarkCardReadSingle();
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load card content for system prompt
  const { data: cardContentData } = useCardContent(selectedItem?.card_id ?? null, "source");

  // Chat hooks (must be called before any early returns)
  const { agents, selectedAgentId, setSelectedAgentId } = useAgentDetection();
  const selectedAgentName = agents.find((a) => a.id === selectedAgentId)?.name ?? "AI";
  const chatCardId = isHomeView ? null : (selectedItem?.card_id ?? null);
  const chat = useChat(chatCardId, cacheReady);
  const chatActive = chat.messages.length > 0 || chat.isStreaming;

  // Auto-scroll when new messages arrive (after AI finishes or user sends)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages.length, chat.isStreaming]);

  // Smooth scroll during streaming — throttled via rAF
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chat.isStreaming || !chat.streamingContent) return;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      rafRef.current = null;
    });
  }, [chat.streamingContent, chat.isStreaming]);

  const buildSystemPrompt = useCallback(() => {
    const notesPath = localStorage.getItem("notesPath") ?? "";
    let prompt = `你正在通过 Curation 应用与用户对话。用户正在阅读一张卡片，卡片正文已附在下方。

Curation 是个人 AI 资讯助理，自动抓取微信公众号文章并生成卡片摘要。

## 可用工具（curation CLI）
你可以通过终端执行 \`curation\` 命令来查询和操作用户的卡片库。所有命令默认输出 JSON。
使用前先运行 \`curation help\` 和 \`curation card list --help\` 等了解完整参数，不要猜测用法。
常用示例：
- \`curation card list --range today\` — 今天的卡片
- \`curation card show <card_id>\` — 查看卡片详情
${notesPath ? `\n用户的笔记路径：${notesPath}` : ""}
请简练回复，使用中文和 markdown。

## 当前上下文

用户正在阅读「${selectedItem?.article_meta.title ?? ""}」（${selectedItem?.article_meta.account ?? ""}）：

${cardContentData?.content ?? "（正文加载中）"}`;

    return prompt;
  }, [selectedItem, cardContentData]);

  const handleSend = useCallback(
    (text: string) => {
      if (!selectedAgentId) return;
      chat.sendMessage(text, selectedAgentId, buildSystemPrompt());
    },
    [selectedAgentId, chat.sendMessage, buildSystemPrompt],
  );

  const handleSaveToNotes = useCallback(() => {
    if (!selectedAgentId) return;
    const notePrompt = selectedItem
      ? `请将当前卡片内容保存到我的笔记中。卡片内容已在上下文中，直接使用即可。`
      : `请将我们刚才的对话要点保存到我的笔记中。`;
    chat.sendMessage(notePrompt, selectedAgentId, buildSystemPrompt());
  }, [selectedAgentId, selectedItem, chat.sendMessage, buildSystemPrompt]);

  const handleClear = useCallback(() => {
    if (!selectedAgentId) return;
    chat.clearSession(selectedAgentId);
  }, [selectedAgentId, chat.clearSession]);

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

  // Resolve the active item — inbox, favorites, or discarded all go through here
  const item = isDiscardedView
    ? (selectedDiscardedItem ? {
        card_id: null,
        article_id: selectedDiscardedItem.article_id,
        title: selectedDiscardedItem.title,
        description: null,
        routing: null as "ai_curation" | "original_push" | null,
        article_date: selectedDiscardedItem.article_date,
        read_at: null,
        queue_status: null as "pending" | "running" | null,
        article_meta: selectedDiscardedItem.article_meta,
      } : null)
    : selectedItem;

  // Empty state
  if (!item) {
    return (
      <main className="reader-pane">
        <div className="reader-empty">
          <div className="reader-empty-icon"><BookOpen size={64} /></div>
          <h3>请选择一篇内容阅读</h3>
        </div>
      </main>
    );
  }

  // Unified view — one design for all items
  return (
    <main className="reader-pane" style={{ position: "relative", overflow: "hidden" }}>
      <SourceBar
        meta={item.article_meta}
        routing={item.routing}
        isDiscarded={isDiscardedView}
        onOpenDrawer={item.routing === "ai_curation" ? onOpenDrawer : undefined}
        cardId={item.card_id ?? undefined}
      />
      <div ref={scrollRef} style={{ overflowY: "auto", flex: 1 }}>
        <div className="reader-content animate-in" style={{ paddingBottom: 140 }}>
          {/* Card content (markdown) */}
          {item.card_id && (
            <CardFrame
              chatActive={chatActive}
              label={item.routing === "original_push" ? "AI 卡片" : undefined}
              force={item.routing === "original_push"}
            >
              <CardContentView cardId={item.card_id} />
            </CardFrame>
          )}

          {/* Original article HTML — for original_push or discarded or analyzing (no card) */}
          {(item.routing === "original_push" || !item.card_id) && (
            <CardFrame
              chatActive={chatActive}
              label={item.routing === "original_push" ? "原文" : undefined}
              force={item.routing === "original_push"}
            >
              <ArticleHtmlView articleId={item.article_id} />
            </CardFrame>
          )}

          <ChatMessages
            messages={chat.messages}
            streamingContent={chat.streamingContent}
            isStreaming={chat.isStreaming}
            agentName={selectedAgentName}
            userName="你"
          />
        </div>
      </div>
      <TauriOnly>
        <ChatInput
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
          connectionStatus={chat.connectionStatus}
          isStreaming={chat.isStreaming}
          onSend={handleSend}
          onCancel={chat.cancel}
          onClear={handleClear}
          onSaveToNotes={handleSaveToNotes}
          hasMessages={chat.messages.length > 0}
        />
      </TauriOnly>
      {(item.card_id || item.article_id) && (
        <div
          style={{
            position: "absolute",
            right: 16,
            // ChatInput is ~80px tall with its own 12px top padding; leave an
            // extra 8px gap so the vote pill never overlaps it.
            bottom: "calc(var(--sp-3, 12px) + 80px + 8px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {isAdmin && (
            <div style={{ pointerEvents: "auto" }}>
              <AdminAnnotationFlag cardId={item.card_id} articleId={item.article_id} />
            </div>
          )}
          <div style={{ pointerEvents: "auto" }}>
            <CardVoteBar cardId={item.card_id} articleId={item.article_id} />
          </div>
        </div>
      )}
    </main>
  );
}
