import { useEffect, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ArrowDown, BookOpen, Copy, Image, Share2 } from "lucide-react";
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
import { AcpRunningDot } from "./AcpRunningDot";
import { TauriOnly } from "./platform/TauriOnly";
import { ShareCardPreviewModal } from "./ShareCardPreviewModal";
import { useChat, useAgentDetection } from "../hooks/useChat";
import { useCardStatusStore } from "../lib/acp/cardStatusStore";
import {
  getReaderScrollMetrics,
  getSoftChatRevealTarget,
  isNearReaderBottom,
} from "../lib/readerScrollPolicy";
import { formatReadingSummary } from "../lib/readingMetrics";
import type { ShareCardImageData } from "../lib/shareCardImage";
import type { InboxItem, DiscardedItem, Routing } from "../types";
import { ORIGINAL_ALONGSIDE_ROUTINGS } from "../types";
import { isAggregateKind, routingPresentation } from "../lib/routingPresentation";
import { useDrawerStack } from "../state/drawerStack";

/** True when the routing is one of the "show original article alongside our card" variants. */
function showsOriginalAlongside(routing: Routing): boolean {
  return routing != null && (ORIGINAL_ALONGSIDE_ROUTINGS as readonly string[]).includes(routing);
}

function sourceBarTag(routing: Routing, isDiscarded: boolean, kind?: string) {
  if (isDiscarded) {
    const v = routingPresentation("discard");
    return <span className="inbox-tag" style={{ fontSize: "0.72rem", color: v.color }}>{v.text}</span>;
  }
  if (!routing) return null;
  const v = routingPresentation(routing, { kind });
  return <span className="inbox-tag" style={{ fontSize: "0.72rem", color: v.color }}>{v.text}</span>;
}

function formatTime(t: string | null) {
  if (!t) return "";
  return t.replace("T", " ").slice(0, 16);
}

function formatDate(t: string | null) {
  if (!t) return "";
  return t.replace("T", " ").slice(0, 10);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function ShareButton({
  markdown,
  shareData,
}: {
  markdown?: string | null;
  shareData: ShareCardImageData | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canCopy = !!markdown?.trim();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleCopy() {
    if (!canCopy) return;
    await copyText(markdown!);
    setCopied(true);
    setOpen(false);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div ref={rootRef} className="reader-share">
      <button
        type="button"
        className="reader-action-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="分享"
      >
        <Share2 size={12} />
        {copied ? "已复制" : "分享"}
      </button>
      {open && (
        <div className="reader-share-menu">
          <button
            type="button"
            className="reader-share-menu-item"
            disabled={!shareData}
            onClick={() => {
              setOpen(false);
              setPreviewOpen(true);
            }}
          >
            <Image size={13} />
            生成分享长图
          </button>
          <button
            type="button"
            className="reader-share-menu-item"
            disabled={!canCopy}
            onClick={handleCopy}
          >
            <Copy size={13} />
            复制卡片 Markdown
          </button>
        </div>
      )}
      {previewOpen && shareData && (
        <ShareCardPreviewModal
          data={shareData}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

interface ReaderPaneProps {
  selectedItem: InboxItem | null;
  selectedDiscardedItem: DiscardedItem | null;
  isDiscardedView: boolean;
  isHomeView?: boolean;
  cacheReady?: boolean;
  onOpenSubs?: () => void;
}

function SourceBar({
  title,
  meta,
  routing,
  isDiscarded,
  cardId,
  articleId,
  kind,
  sourceCount,
  cardDate,
  cardMarkdown,
  entities,
  contextEntities,
  wordCount,
  readingMinutes,
}: {
  title: string;
  meta: { title: string; account: string; author: string | null; publish_time: string | null; url: string };
  routing: Routing;
  isDiscarded: boolean;
  cardId?: string;
  articleId?: string;
  kind?: string;
  sourceCount?: number;
  cardDate?: string | null;
  cardMarkdown?: string | null;
  entities?: string[];
  contextEntities?: string[];
  wordCount?: number | null;
  readingMinutes?: number | null;
}) {
  const push = useDrawerStack((s) => s.push);
  const isAggregated = isAggregateKind(kind);
  const aggregateMeta = sourceCount && sourceCount > 0
    ? `聚合 ${sourceCount} 张相似卡片${formatDate(cardDate ?? null) ? ` · ${formatDate(cardDate ?? null)}` : ""}`
    : `聚合相似卡片${formatDate(cardDate ?? null) ? ` · ${formatDate(cardDate ?? null)}` : ""}`;
  const shareData: ShareCardImageData | null = cardMarkdown?.trim()
    ? {
        title,
        source: isAggregated ? aggregateMeta : [meta.account, meta.author, formatTime(meta.publish_time)].filter(Boolean).join(" · "),
        date: formatDate(cardDate ?? meta.publish_time ?? null),
        routingLabel: routingPresentation(routing ?? "discard", { kind }).text,
        markdown: cardMarkdown,
        entities: entities ?? [],
        contextEntities: contextEntities ?? [],
        aggregateCount: isAggregated ? sourceCount : undefined,
      }
    : null;
  const readingSummary = formatReadingSummary(wordCount, readingMinutes);
  return (
    <div className="reader-source-bar">
      {/* Line 1: original title + tag */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.88rem", flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <AcpRunningDot cardId={cardId ?? null} />
          {isAggregated ? title : (
            <>
              <span style={{ color: "var(--text-muted)" }}>原文标题：</span>
              {meta.title}
            </>
          )}
        </span>
        {sourceBarTag(routing, isDiscarded, kind)}
      </div>
      {/* Line 2: meta left, buttons right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          {isAggregated ? (
            <span>{aggregateMeta}</span>
          ) : (
            <>
              <span>{meta.account}</span>
              {meta.author && <><span>·</span><span>{meta.author}</span></>}
              {meta.publish_time && <><span>·</span><span>{formatTime(meta.publish_time)}</span></>}
            </>
          )}
          {readingSummary && <><span>·</span><span>{readingSummary}</span></>}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {cardId && (
            <>
              <ShareButton markdown={cardMarkdown} shareData={shareData} />
              <FavoriteButton itemType="card" itemId={cardId} />
            </>
          )}
          {routing === "ai_curation" && (
            isAggregated ? (
              <button
                onClick={() => cardId && push({ kind: "sourceCards", cardId })}
                style={{
                  background: "none", border: "1px solid var(--border)", borderRadius: 6,
                  color: "var(--text-muted)", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
                }}
              >
                查看原卡片
              </button>
            ) : (
              <button
                onClick={() => push({ kind: "article", articleId: articleId ?? "" })}
                style={{
                  background: "none", border: "1px solid var(--border)", borderRadius: 6,
                  color: "var(--text-muted)", padding: "3px 10px", cursor: "pointer", fontSize: "0.76rem",
                }}
              >
                查看原文
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline strip of entity chips, rendered above the card body.
 *
 * Sourced from `InboxItem.entities` / `context_entities`.
 * Renders nothing when the list is empty so legacy / queued items stay clean.
 */
function EntityChips({
  entities,
  contextEntities,
}: {
  entities: string[];
  contextEntities?: string[];
}) {
  const core = entities ?? [];
  const context = contextEntities ?? [];
  if (core.length === 0 && context.length === 0) return null;
  const renderChip = (e: string, variant: "core" | "context") => (
    <span
      key={`${variant}:${e}`}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: "0.74rem",
        lineHeight: 1.4,
        color: variant === "core" ? "var(--accent-gold)" : "var(--text-secondary)",
        background: variant === "core" ? "rgba(201, 162, 92, 0.13)" : "transparent",
        border: variant === "core" ? "1px solid rgba(201, 162, 92, 0.44)" : "1px solid var(--border)",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      {e}
    </span>
  );
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        margin: "0 0 16px 0",
        padding: "0",
        alignItems: "center",
      }}
      aria-label="entities"
    >
      {core.map((e) => renderChip(e, "core"))}
      {context.map((e) => renderChip(e, "context"))}
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

function ArticleHtmlView({
  additionalContent,
  rawHtml,
  rawMarkdown,
  isLoading,
}: {
  additionalContent?: string | null;
  rawHtml?: string;
  rawMarkdown?: string;
  isLoading?: boolean;
}) {
  const html = additionalContent || rawHtml;
  if (html) {
    return (
      <div
        className="rich-text-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (rawMarkdown) {
    return (
      <div className="markdown-body" style={{ padding: "18px 24px" }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {stripFrontmatter(rawMarkdown)}
        </ReactMarkdown>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        正在加载原文…
      </div>
    );
  }

  if (!additionalContent) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        暂无原文内容
      </div>
    );
  }
}

export function ReaderPane({
  selectedItem,
  selectedDiscardedItem,
  isDiscardedView,
  isHomeView,
  cacheReady,
  onOpenSubs,
}: ReaderPaneProps) {
  const { state: authState } = useAuth();
  const isAdmin = authState.status === "authenticated" && authState.user.role === "admin";
  const markRead = useMarkCardReadSingle();
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatStartRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const pendingSoftRevealRef = useRef(false);
  const shouldFollowStreamRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  // Tracks ChatInput container height so floating UI (vote pill, admin
  // annotation flag) can sit just above it as the textarea grows.
  const [chatInputHeight, setChatInputHeight] = useState(80);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  // Load card content + original article for system prompt.
  // ArticleId can come from either the inbox-selected card or a discarded item
  // (discarded items have no card; the prompt then includes only the article).
  const promptArticleId =
    selectedItem?.article_id ?? selectedDiscardedItem?.article_id ?? null;
  const { data: cardContentData } = useCardContent(selectedItem?.card_id ?? null, "source");
  const { data: promptArticleData, isLoading: isPromptArticleLoading } = useArticleContent(promptArticleId);

  // Chat hooks (must be called before any early returns)
  const { agents, selectedAgentId, setSelectedAgentId } = useAgentDetection();
  const selectedAgentName = agents.find((a) => a.id === selectedAgentId)?.name ?? "AI";
  const chatCardId = isHomeView ? null : (selectedItem?.card_id ?? null);
  const chat = useChat(chatCardId, cacheReady);
  const chatActive = chat.messages.length > 0 || chat.isStreaming;

  const scheduleScrollTo = useCallback((top: number, behavior: ScrollBehavior = "smooth") => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      programmaticScrollUntilRef.current = Date.now() + 420;
      el.scrollTo({ top, behavior });
      scrollRafRef.current = null;
    });
  }, []);

  const scrollToLatest = useCallback((follow: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    shouldFollowStreamRef.current = follow;
    setShowJumpLatest(false);
    scheduleScrollTo(Math.max(0, el.scrollHeight - el.clientHeight), "smooth");
  }, [scheduleScrollTo]);

  const markManualScrollIntent = useCallback(() => {
    if (Date.now() < programmaticScrollUntilRef.current) return;
    shouldFollowStreamRef.current = false;
    if (chat.isStreaming || chat.streamingContent) setShowJumpLatest(true);
  }, [chat.isStreaming, chat.streamingContent]);

  useEffect(() => {
    lastMessageCountRef.current = 0;
    pendingSoftRevealRef.current = false;
    shouldFollowStreamRef.current = false;
    setShowJumpLatest(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [chatCardId]);

  useEffect(() => {
    const previousCount = lastMessageCountRef.current;
    lastMessageCountRef.current = chat.messages.length;
    const lastMessage = chat.messages[chat.messages.length - 1];
    if (!pendingSoftRevealRef.current || chat.messages.length <= previousCount || lastMessage?.role !== "user") {
      return;
    }
    pendingSoftRevealRef.current = false;
    const el = scrollRef.current;
    const chatStart = chatStartRef.current;
    if (!el || !chatStart) return;
    const metrics = getReaderScrollMetrics(el);
    const chatTop = chatStart.offsetTop;
    const target = getSoftChatRevealTarget(metrics, chatTop, chatInputHeight);
    if (Math.abs(target - metrics.scrollTop) > 4) {
      scheduleScrollTo(target, "smooth");
    }
  }, [chat.messages, chatInputHeight, scheduleScrollTo]);

  useEffect(() => {
    if (!chat.isStreaming || !chat.streamingContent) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!shouldFollowStreamRef.current) {
      setShowJumpLatest(true);
      return;
    }
    const metrics = getReaderScrollMetrics(el);
    if (!isNearReaderBottom(metrics, 340)) {
      shouldFollowStreamRef.current = false;
      setShowJumpLatest(true);
      return;
    }
    setShowJumpLatest(false);
    scheduleScrollTo(Math.max(0, el.scrollHeight - el.clientHeight), "smooth");
  }, [chat.streamingContent, chat.isStreaming, scheduleScrollTo]);

  useEffect(() => {
    if (!chat.isStreaming) {
      shouldFollowStreamRef.current = false;
      setShowJumpLatest(false);
    }
  }, [chat.isStreaming]);

  const buildSystemPrompt = useCallback(() => {
    const notesPath = localStorage.getItem("notesPath") ?? "";

    // Routing: cards come from selectedItem; discarded items have no card.
    const isDiscardedItem = !selectedItem && !!selectedDiscardedItem;
    const routing: Routing | "discard" =
      isDiscardedItem ? "discard" : (selectedItem?.routing ?? null);
    const template = selectedItem?.template ?? null;

    const routingLabel =
      routing === "ai_curation" ? "AI梳理"
        : routing === "original_content_with_pre_card" ? "原文推送"
        : routing === "original_content_with_post_card" ? "原文推送"
        : routing === "discard" ? "丢弃"
        : "未知";

    // 阅读焦点：AI梳理 → 卡片；原文推送（pre/post）→ 原文
    const focus = routing === "ai_curation" ? "卡片" : "原文";

    // Per-card template label (article_cards.template column).
    let cardKindLabel = "—";
    if (routing === "ai_curation") {
      cardKindLabel = template ? `AI梳理（${template}）` : "AI梳理";
    } else if (routing === "original_content_with_pre_card") {
      cardKindLabel = "原文推送卡";
    } else if (routing === "original_content_with_post_card") {
      cardKindLabel = "原文推送卡";
    }

    // Article markdown — soft cap at 40k chars. Sized off the prod dataset:
    // longest original_push article is 34.8k, p99 across everything is ~19k,
    // so 40k covers 100% of original_push (where the reader actually reads
    // the original) and >99.9% of ai_curation. ~60-70k tokens worst case,
    // comfortable for Claude/Codex/Gemini long-context agents.
    const ARTICLE_CHAR_LIMIT = 40000;
    const articleRaw = promptArticleData?.rawMarkdown ?? "";
    const articleTruncated = articleRaw.length > ARTICLE_CHAR_LIMIT;
    const articleBody = articleTruncated
      ? articleRaw.slice(0, ARTICLE_CHAR_LIMIT) +
        `\n\n…（原文已截断，剩余约 ${articleRaw.length - ARTICLE_CHAR_LIMIT} 字。需要完整内容请用 curation 工具查询。）`
      : articleRaw || "（暂无原文）";

    const articleTitle =
      selectedItem?.article_meta.title ??
      selectedDiscardedItem?.article_meta?.title ??
      "";
    const accountName =
      selectedItem?.article_meta.account ??
      selectedDiscardedItem?.article_meta?.account ??
      "";

    const cardSection =
      routing === "discard" || !selectedItem
        ? "" // 丢弃：读者看不到卡片，prompt 也不放卡片段
        : `\n### 当前卡片\n\n\`\`\`markdown\n${cardContentData?.content ?? "（卡片正文加载中）"}\n\`\`\`\n`;

    const notesSection = notesPath
      ? `用户的本地笔记路径：${notesPath}\n仅在用户明确要求"保存到笔记 / 写入笔记"时才往这个路径写文件；日常对话不要主动写盘。`
      : `（用户未配置笔记路径，本节忽略）`;

    return `你正在通过 Curation 桌面/网页应用与用户对话。Curation 是个人 AI 资讯助理，自动抓取微信公众号文章并生成卡片摘要。

## 路由分流背景

每篇抓取到的原文都会被 AI 分析并路由到四条路径之一，读者在不同路由下的注意力分配不一样：

- **AI梳理**（ai_curation）：原文信息密度高但读起来累，AI 提炼出一张主卡片代替原文阅读。
  → 读者主要读卡片，原文是补充资料，遇到细节存疑时回查。
- **原文推送**（original_content_with_pre_card）：原文本身值得逐字读（叙事/思想/一手材料），AI 卡片辅助进入原文。
  → 读者主要读原文，卡片是进入原文前的准备。
- **原文推送**（original_content_with_post_card）：原文值得读但行文冗余，AI 卡片辅助回顾、延伸或串联。
  → 读者主要读原文，卡片是读完后的收尾。
- **丢弃**（discard）：AI 判断信息密度低或与读者主题无关，不生成卡片；只有当读者主动展开"已丢弃"列表时才会看到这里的原文。

## 当前阅读上下文

- 路由：${routingLabel}
- 阅读焦点：${focus}
- 卡片类型：${cardKindLabel}
- 标题：「${articleTitle}」
- 公众号：${accountName}
${cardSection}
### 原文

\`\`\`markdown
${articleBody}
\`\`\`

> 提示：上面 \`原文\` 是这张卡片对应的源文章，已附在此供你随时检索引用。
> ${routing === "ai_curation"
        ? "读者此刻视线在 `卡片` 上；原文用于查证和扩展。"
        : (routing === "original_content_with_pre_card" || routing === "original_content_with_post_card")
          ? "读者此刻视线在 `原文` 上，卡片只是辅助导读/回顾。"
          : "读者只看到原文（这篇被路由到丢弃，没有卡片）。"}

## 可用工具（curation CLI）

你可以通过终端执行 \`curation\` 命令查询和操作用户的卡片库，所有命令默认输出 JSON。
使用前先运行 \`curation help\`、\`curation card list --help\` 了解完整参数，不要猜测用法。
常用示例：
- \`curation card list --range today\`  — 今天的卡片
- \`curation card show <card_id>\`      — 查看卡片详情

## 可选参考（非强制）

${notesSection}

## 回复规范

请简练回复，使用中文和 markdown。`;
  }, [selectedItem, selectedDiscardedItem, cardContentData, promptArticleData]);

  const beginChatTurn = useCallback(() => {
    const el = scrollRef.current;
    shouldFollowStreamRef.current = el ? isNearReaderBottom(getReaderScrollMetrics(el), 260) : false;
    pendingSoftRevealRef.current = true;
    setShowJumpLatest(false);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      if (!selectedAgentId) return;
      beginChatTurn();
      chat.sendMessage(text, selectedAgentId, buildSystemPrompt());
    },
    [selectedAgentId, beginChatTurn, chat.sendMessage, buildSystemPrompt],
  );

  const handleSaveToNotes = useCallback(() => {
    if (!selectedAgentId) return;
    beginChatTurn();
    const notePrompt = selectedItem
      ? `请将当前卡片内容保存到我的笔记中。卡片内容已在上下文中，直接使用即可。`
      : `请将我们刚才的对话要点保存到我的笔记中。`;
    chat.sendMessage(notePrompt, selectedAgentId, buildSystemPrompt());
  }, [selectedAgentId, selectedItem, beginChatTurn, chat.sendMessage, buildSystemPrompt]);

  const handleClear = useCallback(() => {
    if (!selectedAgentId) return;
    chat.clearSession(selectedAgentId);
  }, [selectedAgentId, chat.clearSession]);

  // While viewing a card, downgrade ACP "unread" → "read" immediately,
  // and keep doing so if a new reply arrives during this visit.
  useEffect(() => {
    const cid = selectedItem?.card_id;
    if (!cid) return;
    const downgrade = () => {
      const cur = useCardStatusStore.getState().byCard[cid];
      if (cur === "unread") {
        useCardStatusStore.getState().setStatus(cid, "read");
      }
    };
    downgrade();
    const unsub = useCardStatusStore.subscribe(downgrade);
    return unsub;
  }, [selectedItem?.card_id]);

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
        entities: [] as string[],
        routing: null as Routing,
        template: null as string | null,
        template_reason: null as string | null,
        card_date: selectedDiscardedItem.card_date,
        read_at: null,
        queue_status: null as "pending" | "running" | null,
        article_meta: selectedDiscardedItem.article_meta,
        additional_content: selectedDiscardedItem.additional_content,
      } : null)
    : selectedItem;

  // Empty state
  if (!item) {
    return (
      <main className="reader-pane">
        <div className="reader-empty">
          <div className="reader-empty-icon"><BookOpen size={64} /></div>
          <h3>请选择一篇内容阅读</h3>
          {onOpenSubs && (
            <button className="reader-empty-cta" onClick={onOpenSubs}>
              + 添加订阅 / 文章
            </button>
          )}
        </div>
      </main>
    );
  }

  // Unified view — one design for all items
  return (
    <main className="reader-pane" style={{ position: "relative", overflow: "hidden" }}>
      <SourceBar
        meta={item.article_meta}
        title={item.title}
        routing={item.routing}
        isDiscarded={isDiscardedView}
        cardId={item.card_id ?? undefined}
        articleId={item.article_id ?? undefined}
        kind={(item as InboxItem).kind}
        sourceCount={(item as InboxItem).source_card_ids?.length ?? 0}
        cardDate={item.card_date}
        cardMarkdown={cardContentData?.content ?? null}
        entities={item.entities ?? []}
        contextEntities={(item as InboxItem).context_entities ?? []}
        wordCount={(item as InboxItem).word_count}
        readingMinutes={(item as InboxItem).reading_minutes}
      />
      <div
        ref={scrollRef}
        className="reader-scroll"
        onWheelCapture={markManualScrollIntent}
        onTouchMoveCapture={markManualScrollIntent}
        onPointerDownCapture={markManualScrollIntent}
      >
        <div className="reader-content animate-in" style={{ paddingBottom: 140 }}>
          {/* Card content (markdown). For "show original alongside" routings
              (reading_guide / post_read / legacy original_push), label as
              "AI 卡片" so the user can distinguish the two panes. */}
          {item.card_id && (
            <CardFrame
              chatActive={chatActive}
              label={showsOriginalAlongside(item.routing) ? "AI 卡片" : undefined}
              force={showsOriginalAlongside(item.routing)}
            >
              <EntityChips
                entities={item.entities ?? []}
                contextEntities={(item as InboxItem).context_entities ?? []}
              />
              <CardContentView cardId={item.card_id} />
            </CardFrame>
          )}

          {/* Original article HTML — show alongside for reading_guide /
              post_read / legacy original_push, or as the only content when
              there's no card (discarded / analyzing). */}
          {(showsOriginalAlongside(item.routing) || !item.card_id) && (
            <CardFrame
              chatActive={chatActive}
              label={showsOriginalAlongside(item.routing) ? "原文" : undefined}
              force={showsOriginalAlongside(item.routing)}
            >
              <ArticleHtmlView
                additionalContent={item.additional_content}
                rawHtml={promptArticleData?.rawHtml}
                rawMarkdown={promptArticleData?.rawMarkdown}
                isLoading={isPromptArticleLoading}
              />
            </CardFrame>
          )}

          <div ref={chatStartRef} className="reader-chat-anchor" />
          <ChatMessages
            messages={chat.messages}
            streamingContent={chat.streamingContent}
            isStreaming={chat.isStreaming}
            agentName={selectedAgentName}
            userName="你"
          />
        </div>
      </div>
      {showJumpLatest && (
        <button
          type="button"
          className="reader-jump-latest"
          style={{ bottom: chatInputHeight + 12 }}
          onClick={() => scrollToLatest(true)}
        >
          <ArrowDown size={14} />
          跳到最新回复
        </button>
      )}
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
          onHeightChange={setChatInputHeight}
        />
      </TauriOnly>
      {(item.card_id || item.article_id) && (
        <div
          style={{
            position: "absolute",
            right: 16,
            // Sit just above the ChatInput container, regardless of how
            // tall it grows when the textarea expands.
            bottom: chatInputHeight + 8,
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
