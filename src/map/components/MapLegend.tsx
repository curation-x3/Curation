// Atlas — Legend bottom-left.

import { useMapStore } from "../state/store";

export function MapLegend() {
  const routesVisible = useMapStore((s) => s.routes_visible);
  const toggleRoutes = useMapStore((s) => s.toggleRoutes);
  return (
    <div
      data-map-fixed-ui
      style={{
        position: "absolute",
        bottom: 178,
        left: 36,
        background: "var(--map-vellum)",
        border: "1px solid var(--map-ink)",
        padding: "14px 16px",
        fontFamily: "var(--map-serif)",
        fontSize: 12,
        color: "var(--map-ink-2)",
        maxWidth: 280,
        zIndex: 5,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--map-display)",
          fontSize: 11,
          letterSpacing: "0.18em",
          color: "var(--map-ink)",
          marginBottom: 8,
          borderBottom: "1px solid var(--map-ink-2)",
          paddingBottom: 4,
          textTransform: "uppercase",
        }}
      >
        舆图图例
      </div>
      <Row
        glyph={
          <svg width={22} height={14}>
            <circle
              cx={11}
              cy={7}
              r={5}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={1.2}
            />
          </svg>
        }
        text="AI 梳理"
      />
      <Row
        glyph={
          <svg width={22} height={14}>
            <circle
              cx={11}
              cy={7}
              r={5}
              fill="var(--map-vellum)"
              stroke="var(--map-ink)"
              strokeWidth={1.2}
            />
          </svg>
        }
        text="原文推送"
      />
      <Row
        glyph={
          <svg width={22} height={14}>
            <circle
              cx={11}
              cy={7}
              r={9}
              fill="none"
              stroke="var(--map-ink-2)"
              strokeWidth={0.9}
            />
            <circle
              cx={11}
              cy={7}
              r={6.5}
              fill="none"
              stroke="var(--map-ink-2)"
              strokeWidth={0.9}
            />
            <circle
              cx={11}
              cy={7}
              r={3.8}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={1}
            />
          </svg>
        }
        text="聚合卡片"
      />
      <Row
        glyph={
          <svg width={22} height={14}>
            <circle
              cx={11}
              cy={7}
              r={5}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={0.8}
              opacity={0.35}
            />
          </svg>
        }
        text="已读卡片"
      />
      <Row
        glyph={
          <svg width={28} height={14} viewBox="0 0 28 14">
            <circle
              cx={7}
              cy={7}
              r={3.2}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={0.9}
            />
            <circle
              cx={20}
              cy={7}
              r={6.2}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={0.9}
            />
          </svg>
        }
        text="圆点大小 = 阅读时长"
      />
      <Row
        glyph={
          <svg width={22} height={14} viewBox="0 0 22 14">
            <path
              d="M11 1.3 12.6 5.1 16.7 5.4 13.6 8 14.6 12 11 9.9 7.4 12 8.4 8 5.3 5.4 9.4 5.1Z"
              fill="var(--map-gold)"
              stroke="var(--map-gold)"
              strokeWidth={0.7}
            />
          </svg>
        }
        text="收藏卡片"
      />
      {/* Clickable row — toggles shared-entity links. */}
      <div
        onClick={toggleRoutes}
        title={routesVisible ? "点击隐藏共享实体连线" : "点击显示共享实体连线"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "4px 0",
          cursor: "pointer",
          opacity: routesVisible ? 1 : 0.55,
          textDecoration: routesVisible ? "none" : "line-through",
          userSelect: "none",
          padding: "2px 4px",
          marginLeft: -4,
          marginRight: -4,
          borderRadius: 2,
          transition: "background 120ms",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--map-paper)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <span style={{ flexShrink: 0 }}>
          <svg width={32} height={6}>
            <line
              x1={0}
              y1={3}
              x2={32}
              y2={3}
              stroke="var(--map-crimson)"
              strokeWidth={0.8}
              strokeDasharray="1 4"
            />
          </svg>
        </span>
        <span>共享实体连线 {routesVisible ? "▼" : "▷"}</span>
      </div>
    </div>
  );
}

function Row({ glyph, text }: { glyph: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
      <span style={{ flexShrink: 0 }}>{glyph}</span>
      <span>{text}</span>
    </div>
  );
}
