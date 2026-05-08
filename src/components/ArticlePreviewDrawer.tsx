import { useState } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { stripFrontmatter, mdComponents } from "../lib/markdown";
import { useArticleContent } from "../hooks/useArticles";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { routingPresentation } from "../lib/routingPresentation";

function RoutingPill({ routing }: { routing: string | null }) {
  const v = routingPresentation(routing);
  return <span style={{ background: v.bg, color: v.color, padding: "1px 8px", borderRadius: 10, fontSize: "0.68rem" }}>{v.text}</span>;
}

function EntityChips({ core, context }: { core?: string[]; context?: string[] }) {
  const c = core ?? [];
  const ctx = context ?? [];
  if (c.length === 0 && ctx.length === 0) return null;
  const chip = (e: string, kind: "core" | "context") => (
    <span
      key={`${kind}:${e}`}
      style={{
        display: "inline-block", padding: "2px 8px", fontSize: "0.72rem", lineHeight: 1.4,
        color: kind === "core" ? "var(--accent-gold)" : "var(--text-secondary)",
        background: kind === "core" ? "rgba(201, 162, 92, 0.13)" : "transparent",
        border: kind === "core" ? "1px solid rgba(201, 162, 92, 0.44)" : "1px solid var(--border)",
        borderRadius: 4, whiteSpace: "nowrap",
      }}
    >
      {e}
    </span>
  );
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{c.map((e) => chip(e, "core"))}{ctx.map((e) => chip(e, "context"))}</div>;
}

function CardMarkdownView({ articleId }: { articleId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["articleServingCard", articleId],
    queryFn: async () => {
      const res = await apiFetch(`/articles/${articleId}/content`);
      return res.json();
    },
    enabled: !!articleId,
  });

  if (isLoading) return <div style={{ padding: 20, color: "var(--text-muted)" }}>加载中...</div>;

  // /articles/{id}/content returns { cards: [{card_id, title, content}, ...] }
  const cards = data?.cards;
  if (!cards || cards.length === 0) return <div style={{ padding: 20, color: "var(--text-muted)" }}>暂无卡片内容</div>;

  return (
    <div className="markdown-body">
      {cards.map((card: { card_id: string; title: string; description?: string | null; entities?: string[]; context_entities?: string[]; content: string }, i: number) => (
        <div key={card.card_id}>
          {i > 0 && <hr style={{ margin: "24px 0", border: "none", height: 2, background: "linear-gradient(90deg, transparent, var(--border-strong), transparent)" }} />}
          {cards.length > 1 && (
            <div style={{
              padding: "8px 0", fontSize: "0.76rem", color: "var(--text-muted)", fontWeight: 600,
              borderBottom: "1px solid var(--border)", marginBottom: 12,
            }}>
              卡片 {i + 1}/{cards.length}
              {card.title && <span style={{ marginLeft: 8, fontWeight: 400 }}>{card.title}</span>}
            </div>
          )}
          {(card.description || (card.entities && card.entities.length > 0) || (card.context_entities && card.context_entities.length > 0)) && (
            <div style={{ marginBottom: 14 }}>
              {card.description && (
                <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: ((card.entities?.length ?? 0) + (card.context_entities?.length ?? 0)) ? 8 : 0 }}>
                  {card.description}
                </div>
              )}
              <EntityChips core={card.entities} context={card.context_entities} />
            </div>
          )}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>
            {stripFrontmatter(card.content)}
          </ReactMarkdown>
        </div>
      ))}
    </div>
  );
}

function ArticleHtmlView({ articleId }: { articleId: string }) {
  const { data, isLoading } = useArticleContent(articleId);

  if (isLoading) return <div style={{ padding: 20, color: "var(--text-muted)" }}>加载中...</div>;

  const html = data?.rawHtml;
  if (!html) return <div style={{ padding: 20, color: "var(--text-muted)" }}>暂无原文内容</div>;

  return <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface ArticlePreviewDrawerProps {
  articleId: string | null;
  routing: string | null;
  onClose: () => void;
}

export function ArticlePreviewDrawer({ articleId, routing, onClose }: ArticlePreviewDrawerProps) {
  const [tab, setTab] = useState<"user" | "original">("user");

  if (!articleId) return null;

  const isNotPushed = !routing || routing === "discard";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "65%",
        background: "var(--bg-base)", borderLeft: "1px solid var(--border)", zIndex: 101,
        display: "flex", flexDirection: "column",
        animation: "slideInRight 0.2s ease-out",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--bg-panel)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: "0.88rem" }}>内容预览</span>
            <RoutingPill routing={routing} />
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--bg-panel)", padding: "0 16px" }}>
          <button onClick={() => setTab("user")}
            style={{ background: "none", border: "none", color: tab === "user" ? "var(--text-primary)" : "var(--text-muted)", padding: "8px 12px", cursor: "pointer", fontSize: "0.82rem", borderBottom: tab === "user" ? "2px solid var(--accent-blue)" : "2px solid transparent" }}>
            用户视角
          </button>
          <button onClick={() => setTab("original")}
            style={{ background: "none", border: "none", color: tab === "original" ? "var(--text-primary)" : "var(--text-muted)", padding: "8px 12px", cursor: "pointer", fontSize: "0.82rem", borderBottom: tab === "original" ? "2px solid var(--accent-blue)" : "2px solid transparent" }}>
            文章原文
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {tab === "user" ? (
            isNotPushed ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>该文章未推送给用户</div>
            ) : (
              <CardMarkdownView articleId={articleId} />
            )
          ) : (
            <ArticleHtmlView articleId={articleId} />
          )}
        </div>
      </div>
    </>
  );
}
