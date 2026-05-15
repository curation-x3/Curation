// Atlas — hovering settlement label.
// Sized for typical card metadata; tries to avoid going off-canvas via
// `placeFloatingCard` from lib/geometry.ts.

import type { MapCard, MapDSL } from "../types";
import { sourceCount } from "../lib/settlement-style";
import { formatReadingSummary } from "../../lib/readingMetrics";

type Props = {
  card: MapCard;
  dsl: MapDSL;
  position: { x: number; y: number; anchor: "left" | "right" };
  onMarkRead: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Optional: clicking the card body opens the drawer with full content. */
  onOpenDrawer?: () => void;
  /** Route-hover previews should not steal hover from the route beneath them. */
  interactive?: boolean;
  /** Display label for the left footer; aggregate cards can override inherited account meta. */
  sourceLabel?: string;
};

export function MapFloatingCard({
  card,
  dsl,
  position,
  onMarkRead,
  onMouseEnter,
  onMouseLeave,
  onOpenDrawer,
  interactive = true,
  sourceLabel,
}: Props) {
  const topic = dsl.topics.find((s) => s.id === card.topic?.id);
  const domain = dsl.domains.find((b) => b.id === topic?.domain_id);
  const sources = sourceCount(card);
  const account = card.article_meta?.account ?? "";
  const defaultSourceLabel = sources > 1
    ? `来源汇总 · ${sources} 张`
    : `— ${account || "—"}`;
  const readingSummary = formatReadingSummary(card.word_count, card.reading_minutes);

  return (
    <div
      data-map-fixed-ui
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => {
        // Click anywhere on the card body (except the Mark-Read button which
        // stops propagation) → open drawer with full content.
        if (onOpenDrawer) {
          e.stopPropagation();
          onOpenDrawer();
        }
      }}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: "var(--map-popover-width)",
        background: "var(--map-vellum)",
        border: "1.5px solid var(--map-ink)",
        padding: "14px 16px 12px",
        boxShadow: "var(--map-shadow-pinned)",
        fontFamily: "var(--map-serif)",
        zIndex: 30,
        pointerEvents: interactive ? "auto" : "none",
        cursor: interactive && onOpenDrawer ? "pointer" : "default",
        animation: "map-fade-in 180ms cubic-bezier(.16,1,.3,1) both",
      }}
    >
      {/* Arrow tail pointing back at the settlement */}
      <ArrowTail anchor={position.anchor} />

      <div
        style={{
          fontFamily: "var(--map-mono)",
          fontSize: 9,
          letterSpacing: "0.22em",
          color: "var(--map-rust)",
          textTransform: "uppercase",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {domain?.label ?? "—"} · {topic?.label ?? "—"}
        </span>
        {(card.routing === "original_content_with_pre_card" ||
          card.routing === "original_content_with_post_card") && (
          <span
            style={{
              flexShrink: 0,
              padding: "1px 7px",
              border: "1px solid var(--map-ink)",
              background: "var(--map-gold)",
              color: "var(--map-ink)",
              letterSpacing: "0.14em",
              fontWeight: 600,
            }}
          >
            原文推送
          </span>
        )}
      </div>
      <h3
        style={{
          fontFamily: "var(--map-display)",
          fontSize: 16,
          fontWeight: 400,
          margin: "0 0 6px",
          lineHeight: 1.25,
          color: "var(--map-ink)",
        }}
      >
        {card.title}
      </h3>
      <p
        style={{
          fontFamily: "var(--map-serif)",
          fontSize: 12.5,
          color: "var(--map-ink-2)",
          lineHeight: 1.55,
          margin: "0 0 10px",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {card.description ?? ""}
      </p>
      <div
        style={{
          fontFamily: "var(--map-serif)",
          fontStyle: "italic",
          fontSize: 11,
          color: "var(--map-ink-2)",
          borderTop: "1px dotted var(--map-ink-2)",
          paddingTop: 8,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{sourceLabel ?? defaultSourceLabel}</span>
        <span>
          {readingSummary || (sources > 1 ? `多源汇聚 · ${sources} 张` : "· 单源")}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMarkRead();
        }}
        style={{
          marginTop: 10,
          width: "100%",
          fontFamily: "var(--map-mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          background: "var(--map-ink)",
          color: "var(--map-vellum)",
          border: "none",
          padding: "8px 10px",
          cursor: interactive ? "pointer" : "default",
          transition: "background .15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--map-rust)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "var(--map-ink)";
        }}
      >
        ✦ Marked As Read
      </button>
    </div>
  );
}

function ArrowTail({ anchor }: { anchor: "left" | "right" }) {
  const common: React.CSSProperties = {
    position: "absolute",
    width: 14,
    height: 14,
    background: "var(--map-vellum)",
    top: 22,
  };
  if (anchor === "left") {
    return (
      <span
        style={{
          ...common,
          left: -8,
          borderLeft: "1.5px solid var(--map-ink)",
          borderBottom: "1.5px solid var(--map-ink)",
          transform: "rotate(45deg)",
        }}
      />
    );
  }
  return (
    <span
      style={{
        ...common,
        right: -8,
        borderTop: "1.5px solid var(--map-ink)",
        borderRight: "1.5px solid var(--map-ink)",
        transform: "rotate(45deg)",
      }}
    />
  );
}
