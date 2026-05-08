import { useState } from "react";
import { useAdminCards } from "../hooks/useFeedback";
import { ArticlePreviewDrawer } from "./ArticlePreviewDrawer";
import { routingPill } from "../lib/tableHelpers";
import { formatReadingMinutes } from "../lib/readingMetrics";

type Order = "recent" | "downvotes" | "annotations";

const GRID_COLS = "minmax(280px,1fr) 110px 84px 100px 70px 70px 70px";

export function AdminAnnotationTab() {
  // Default: hide cards with no feedback (annotation).
  const [hasAnnotation, setHasAnnotation] = useState<boolean>(true);
  const [hasDownvote, setHasDownvote] = useState<boolean>(false);
  const [routing, setRouting] = useState<string | undefined>(undefined);
  const [order, setOrder] = useState<Order>("recent");

  const [previewArticleId, setPreviewArticleId] = useState<string | null>(null);
  const [previewRouting, setPreviewRouting] = useState<string | null>(null);

  const { data = [], isLoading } = useAdminCards(
    {
      has_annotation: hasAnnotation ? true : undefined,
      has_downvote: hasDownvote ? true : undefined,
      routing,
      order,
      limit: 100,
    },
    true,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Controls bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          borderBottom: "1px solid var(--bg-panel)",
          background: "var(--bg-panel)",
          flexWrap: "wrap",
          fontSize: "var(--fs-sm)",
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={hasAnnotation}
            onChange={(e) => setHasAnnotation(e.target.checked)}
          />
          只看已标注
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={hasDownvote}
            onChange={(e) => setHasDownvote(e.target.checked)}
          />
          只看有点踩
        </label>

        <span style={{ color: "var(--border)" }}>|</span>
        <span style={{ color: "var(--text-muted)" }}>路由</span>
        <select
          value={routing ?? ""}
          onChange={(e) => setRouting(e.target.value || undefined)}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}
        >
          <option value="">全部</option>
          <option value="ai_curation">AI梳理</option>
          <option value="original_content_with_pre_card">原文推送</option>
          <option value="original_content_with_post_card">原文推送</option>
          <option value="discarded">丢弃</option>
        </select>

        <span style={{ color: "var(--border)" }}>|</span>
        <span style={{ color: "var(--text-muted)" }}>排序</span>
        <select
          value={order}
          onChange={(e) => setOrder(e.target.value as Order)}
          style={{ background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 8px", fontSize: "var(--fs-xs)" }}
        >
          <option value="recent">最近</option>
          <option value="annotations">标注多</option>
          <option value="downvotes">点踩多</option>
        </select>

        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>共 {data.length}</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Sticky header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLS,
            padding: "6px 16px",
            borderBottom: "1px solid var(--bg-panel)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: "var(--fs-xs)",
            fontWeight: 500,
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <span>卡片标题</span>
          <span style={{ textAlign: "center" }}>文章日期</span>
          <span style={{ textAlign: "center" }}>阅读</span>
          <span style={{ textAlign: "center" }}>推送</span>
          <span style={{ textAlign: "center" }}>标注</span>
          <span style={{ textAlign: "center" }}>赞</span>
          <span style={{ textAlign: "center" }}>踩</span>
        </div>

        {isLoading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>加载中...</div>
        ) : data.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-sm)" }}>
            {hasAnnotation ? "没有已标注的卡片" : "无结果"}
          </div>
        ) : (
          data.map((c) => (
            <div
              key={`${c.item_type}:${c.card_id ?? c.article_id}`}
              onClick={() => {
                setPreviewArticleId(c.article_id);
                setPreviewRouting(c.routing);
              }}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLS,
                padding: "8px 16px",
                alignItems: "center",
                borderBottom: "1px solid var(--bg-panel)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  color: "var(--accent-blue)",
                  fontSize: "var(--fs-sm)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.title || "(无标题)"}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--fs-sm)",
                  textAlign: "center",
                }}
              >
                {c.card_date ? c.card_date.slice(0, 10) : "—"}
              </span>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--fs-sm)",
                  textAlign: "center",
                }}
              >
                {formatReadingMinutes(c.reading_minutes) || "—"}
              </span>
              <span style={{ textAlign: "center" }}>{routingPill(c.routing)}</span>
              <span
                style={{
                  textAlign: "center",
                  color: c.annotation_count > 0 ? "var(--accent-gold)" : "var(--text-faint)",
                  fontSize: "var(--fs-sm)",
                  fontWeight: c.annotation_count > 0 ? 600 : 400,
                }}
              >
                {c.annotation_count}
              </span>
              <span
                style={{
                  textAlign: "center",
                  color: c.upvote_count > 0 ? "var(--accent-green)" : "var(--text-faint)",
                  fontSize: "var(--fs-sm)",
                }}
              >
                {c.upvote_count}
              </span>
              <span
                style={{
                  textAlign: "center",
                  color: c.downvote_count > 0 ? "var(--accent-red)" : "var(--text-faint)",
                  fontSize: "var(--fs-sm)",
                  fontWeight: c.downvote_count > 0 ? 600 : 400,
                }}
              >
                {c.downvote_count}
              </span>
            </div>
          ))
        )}
      </div>

      <ArticlePreviewDrawer
        articleId={previewArticleId}
        routing={previewRouting}
        onClose={() => setPreviewArticleId(null)}
      />
    </div>
  );
}
