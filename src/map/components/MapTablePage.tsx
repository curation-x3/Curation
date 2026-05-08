// Atlas — full data table view.
//
// Shows all backend fields for every card the radar consumes (43 = 40
// singletons + 3 merged aggregates). 13 columns, grouped left-to-right so
// related fields stay contiguous (no atlas/meta interleaving):
//   #                                    — row index
//   atlas    大领域 · 赛道                — taxonomy (big_domain · small_domain)
//   display  标题 · 描述                  — what the card says
//   atlas    src_cnt · 共享实体           — aggregation + entity links
//   meta     公众号 · card_date · created_at  — provenance
//   state    已读                        — read state
//   access   link · 正文                 — open external / expand md
//
// Aggregate detail (source_card_ids) is a tooltip on src_cnt rather than a
// dedicated column — it's only meaningful for the 3 aggregate rows.

import { Fragment, useMemo, useState } from "react";
import {
  clearOverrides,
  serializeForExport,
  slugify,
  type MapOverrides,
} from "../state/overrides";
import type { ArticleContent, MapCard, MapDSL } from "../types";
import { formatReadingMinutes } from "../../lib/readingMetrics";

type Props = {
  dsl: MapDSL;
  cards: MapCard[];
  cardContent: Record<string, ArticleContent>;
  /** Current overrides (for export + status display). */
  overrides: MapOverrides;
  /** Functional update for overrides (persisted by the caller). */
  onUpdateOverrides: (
    updater: (prev: MapOverrides) => MapOverrides,
  ) => void;
};

export function MapTablePage({
  dsl,
  cards,
  cardContent,
  overrides,
  onUpdateOverrides,
}: Props) {
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [exportToast, setExportToast] = useState<string | null>(null);

  // Index topic → domain for display
  const sd2bd = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of dsl.topics) {
      m.set(t.id, t.domain_id);
    }
    return m;
  }, [dsl]);

  // ───── Edit handlers ─────

  /** Reassign card to a topic (cascading: also locks domain). */
  const reassignCard = (card_id: string, topic_id: string) => {
    onUpdateOverrides((prev) => ({
      ...prev,
      cardAssignments: { ...prev.cardAssignments, [card_id]: topic_id },
    }));
  };

  /**
   * When user changes 大领域 from row dropdown: pick the first topic
   * under the new domain (or — if none exist — surface a hint).
   */
  const reassignCardToBigDomain = (card_id: string, domain_id: string) => {
    const bd = dsl.domains.find((b) => b.id === domain_id);
    if (!bd) return;
    const firstTopic = dsl.topics.find((t) => t.domain_id === domain_id);
    if (!firstTopic) {
      window.alert(
        `「${bd.label}」下还没有赛道，请先在工具栏新增一个赛道。`,
      );
      return;
    }
    reassignCard(card_id, firstTopic.id);
  };

  /** Add a new domain via toolbar. */
  const addBigDomain = () => {
    const label = window.prompt("新大领域中文 label（如 学术）")?.trim();
    if (!label) return;
    const idGuess = slugify(label);
    const id =
      window.prompt("id（英文短语，下划线分隔）", idGuess)?.trim() || idGuess;
    if (dsl.domains.some((b) => b.id === id)) {
      window.alert(`id「${id}」已存在`);
      return;
    }
    const latin =
      window.prompt("latin label（拉丁标签，可空）", label.toUpperCase())?.trim() ||
      label.toUpperCase();
    onUpdateOverrides((prev) => ({
      ...prev,
      newBigDomains: [
        ...prev.newBigDomains,
        { id, label, latin_label: latin, display_order: dsl.domains.length + prev.newBigDomains.length },
      ],
    }));
  };

  /** Add a new topic under a domain via toolbar. */
  const addSmallDomain = () => {
    const bdOptions = dsl.domains.map((b) => `${b.id}: ${b.label}`).join("\n");
    const bdId = window
      .prompt(
        `新赛道挂在哪个大领域下（输入 id）？\n\n可选：\n${bdOptions}`,
      )
      ?.trim();
    if (!bdId) return;
    if (!dsl.domains.some((b) => b.id === bdId)) {
      window.alert(`未找到大领域 id「${bdId}」`);
      return;
    }
    const label = window.prompt("新赛道中文 label（如 自动驾驶）")?.trim();
    if (!label) return;
    const idGuess = slugify(label);
    const id =
      window.prompt("id（英文短语，下划线分隔）", idGuess)?.trim() || idGuess;
    if (dsl.topics.some((s) => s.id === id)) {
      window.alert(`id「${id}」已存在`);
      return;
    }
    const topicOrder = dsl.topics.filter((t) => t.domain_id === bdId).length;
    onUpdateOverrides((prev) => ({
      ...prev,
      newSmallDomains: [
        ...prev.newSmallDomains,
        { id, label, domain_id: bdId, display_order: topicOrder, big_domain_id: bdId },
      ],
    }));
  };

  /** Copy overrides JSON to clipboard. */
  const exportOverrides = async () => {
    const json = serializeForExport(overrides);
    try {
      await navigator.clipboard.writeText(json);
      setExportToast("已复制到剪贴板");
      setTimeout(() => setExportToast(null), 2000);
    } catch {
      // Fallback: open in a new window for manual copy.
      const w = window.open("", "_blank");
      if (w) {
        w.document.title = "Atlas overrides";
        w.document.body.innerText = json;
      }
      setExportToast("剪贴板被拒，已开新窗口");
      setTimeout(() => setExportToast(null), 3000);
    }
  };

  /** Reset all overrides (with confirmation). */
  const resetOverrides = () => {
    if (
      !window.confirm(
        "重置所有本地修改（卡片归类、新增大领域/赛道）。此操作不可撤销。继续？",
      )
    ) {
      return;
    }
    clearOverrides();
    onUpdateOverrides(() => ({
      newBigDomains: [],
      newSmallDomains: [],
      cardAssignments: {},
    }));
  };

  const editCount =
    Object.keys(overrides.cardAssignments).length +
    overrides.newBigDomains.length +
    overrides.newSmallDomains.length;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        background: "var(--map-paper)",
        padding: "100px 32px 32px",
        fontFamily: "var(--map-mono)",
      }}
    >
      <Cartouche cardCount={cards.length} dsl={dsl} cards={cards} />

      {/* ───── Edit toolbar ───── */}
      <div
        style={{
          marginTop: 22,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          border: "1.5px dashed var(--map-ink-2)",
          background: "var(--map-paper-2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--map-mono)",
            fontSize: 9,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--map-ink-2)",
            marginRight: 4,
          }}
        >
          Editor
        </span>
        <ToolbarButton onClick={addBigDomain}>+ 新增大领域</ToolbarButton>
        <ToolbarButton onClick={addSmallDomain}>+ 新增赛道</ToolbarButton>
        <ToolbarButton onClick={exportOverrides} accent>
          导出 JSON
        </ToolbarButton>
        <ToolbarButton onClick={resetOverrides} danger>
          重置
        </ToolbarButton>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--map-mono)",
            fontSize: 10,
            color:
              editCount > 0 ? "var(--map-rust)" : "var(--map-ink-faint)",
          }}
        >
          {editCount > 0
            ? `${editCount} 处本地修改 · 自动持久化在 localStorage`
            : "无本地修改"}
          {exportToast ? (
            <span style={{ marginLeft: 12, color: "var(--map-rust)" }}>
              · {exportToast}
            </span>
          ) : null}
        </span>
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1.5px solid var(--map-ink)",
          background: "var(--map-vellum)",
          boxShadow: "var(--map-shadow-pinned)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              tableLayout: "fixed",
              width: "100%",
              minWidth: 1978,
              fontSize: 11,
              color: "var(--map-ink-2)",
            }}
          >
            <thead>
              <Tr header>
                <Th width={44}>#</Th>
                <Th width={120} group="atlas">大领域</Th>
                <Th width={108} group="atlas">赛道</Th>
                <Th width={300} group="display">标题</Th>
                <Th width={380} group="display">描述</Th>
                <Th width={90} group="atlas">src_cnt</Th>
                <Th width={160} group="atlas">共享实体</Th>
                <Th width={110} group="meta">公众号</Th>
                <Th width={92} group="meta">字数</Th>
                <Th width={82} group="meta">阅读</Th>
                <Th width={102} group="meta">card_date</Th>
                <Th width={140} group="meta">created_at</Th>
                <Th width={88} group="meta">已读</Th>
                <Th width={66} group="meta">link</Th>
                <Th width={96} group="content">正文</Th>
              </Tr>
            </thead>
            <tbody>
              {cards.map((c, i) => {
                // source_count is always 1 in v1 — no aggregate rows.
                const isAggregate = false;
                const isRead = !!c.read_at;
                const cardKey = c.card_id ?? `idx-${i}`;
                const bd = c.topic?.id ? sd2bd.get(c.topic.id) : null;
                const content = c.card_id ? cardContent[c.card_id] : null;
                const expanded = expandedCardId === c.card_id;
                return (
                  <Fragment key={cardKey}>
                    <Tr read={isRead} aggregate={isAggregate}>
                      {/* 1. # */}
                      <Td muted>{i + 1}</Td>
                      {/* 2. 大领域 — editable dropdown */}
                      <Td>
                        <CellSelect
                          value={bd ?? ""}
                          options={dsl.domains.map((b) => ({
                            value: b.id,
                            label: b.label,
                          }))}
                          variant={bd ?? undefined}
                          onChange={(next) => {
                            if (!c.card_id) return;
                            if (next === bd) return;
                            reassignCardToBigDomain(c.card_id, next);
                          }}
                        />
                      </Td>
                      {/* 3. 赛道 — editable dropdown (filtered to current domain) */}
                      <Td>
                        {bd ? (
                          <CellSelect
                            value={c.topic?.id ?? ""}
                            italic
                            options={dsl.topics
                              .filter((t) => t.domain_id === bd)
                              .map((t) => ({ value: t.id, label: t.label }))}
                            onChange={(next) => {
                              if (!c.card_id) return;
                              if (next === c.topic?.id) return;
                              reassignCard(c.card_id, next);
                            }}
                          />
                        ) : (
                          <span style={{ color: "var(--map-ink-faint)" }}>—</span>
                        )}
                      </Td>
                      {/* 4. 标题 */}
                      <Td bold clamp={2}>
                        {c.title}
                      </Td>
                      {/* 5. 描述 */}
                      <Td clamp={3} faint>
                        {c.description ?? "—"}
                      </Td>
                      {/* 6. src_cnt — always 1 in v1 (aggregate cards removed) */}
                      <Td>
                        <span
                          style={{
                            fontFamily: "var(--map-mono)",
                            color: "var(--map-ink-faint)",
                          }}
                        >
                          1
                        </span>
                      </Td>
                      {/* 7. 实体 (formerly 共享实体; now sourced from InboxItem.entities) */}
                      <Td>
                        {(c.entities ?? []).length === 0 ? (
                          <span style={{ color: "var(--map-ink-faint)" }}>—</span>
                        ) : (
                          <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {c.entities.map((e) => (
                              <Badge key={e} variant="entity">
                                {e}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </Td>
                      {/* 8. 公众号 */}
                      <Td>{c.article_meta?.account ?? "—"}</Td>
                      {/* 9. 字数 */}
                      <Td mono muted>
                        {typeof c.word_count === "number" && c.word_count > 0
                          ? c.word_count
                          : "—"}
                      </Td>
                      {/* 10. 阅读 */}
                      <Td muted>{formatReadingMinutes(c.reading_minutes) || "—"}</Td>
                      {/* 11. card_date */}
                      <Td mono muted>{c.card_date}</Td>
                      {/* 12. created_at */}
                      <Td mono muted>
                        {c.article_meta?.publish_time?.slice(0, 19).replace("T", " ") ?? "—"}
                      </Td>
                      {/* 13. 已读 */}
                      <Td muted>
                        {c.read_at ? (
                          <span style={{ color: "var(--map-ink-faint)" }}>
                            {c.read_at.slice(0, 10)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--map-rust)" }}>· 未读</span>
                        )}
                      </Td>
                      {/* 14. link */}
                      <Td>
                        {c.article_meta?.url ? (
                          <a
                            href={c.article_meta.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: "var(--map-rust)",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                            }}
                          >
                            ↗ link
                          </a>
                        ) : (
                          "—"
                        )}
                      </Td>
                      {/* 15. 正文 */}
                      <Td>
                        {content ? (
                          <button
                            style={{
                              fontFamily: "var(--map-mono)",
                              fontSize: 10,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              background: expanded
                                ? "var(--map-ink)"
                                : "transparent",
                              color: expanded
                                ? "var(--map-vellum)"
                                : "var(--map-rust)",
                              border: "1px solid var(--map-ink-2)",
                              padding: "3px 6px",
                              cursor: "pointer",
                            }}
                            onClick={() =>
                              setExpandedCardId(expanded ? null : (c.card_id ?? null))
                            }
                          >
                            {content.content_md.length} ch{" "}
                            {expanded ? "▾" : "▸"}
                          </button>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </Tr>
                    {expanded && content && (
                      <tr key={cardKey + "-md"}>
                        <td
                          colSpan={15}
                          style={{
                            padding: "16px 24px 22px",
                            background: "var(--map-paper)",
                            borderTop: "1px solid var(--map-ink-2)",
                            borderBottom: "1px solid var(--map-ink-2)",
                            fontFamily: "var(--map-serif)",
                            fontSize: 13,
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                            color: "var(--map-ink)",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "var(--map-mono)",
                              fontSize: 9,
                              letterSpacing: "0.2em",
                              color: "var(--map-rust)",
                              textTransform: "uppercase",
                              marginBottom: 10,
                            }}
                          >
                            content_md / {c.card_id} / {content.content_md.length} chars
                          </div>
                          {content.content_md}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: "var(--map-serif)",
          fontStyle: "italic",
          fontSize: 12,
          color: "var(--map-ink-faint)",
          textAlign: "center",
        }}
      >
        — 表中所有字段均为雷达层消费的真实数据；点击 content_md 展开正文。聚合卡（aggregate）的 source_card_ids 列出原始卡片。 —
      </div>
    </div>
  );
}

function Cartouche({
  cardCount,
  dsl,
  cards,
}: {
  cardCount: number;
  dsl: MapDSL;
  cards: MapCard[];
}) {
  // source_count always 1 in v1 — no aggregates.
  const aggCount = 0;
  const readCount = cards.filter((c) => c.read_at).length;
  const distinctEntities = new Set(cards.flatMap((c) => c.entities ?? [])).size;
  return (
    <div
      style={{
        position: "absolute",
        top: 28,
        left: 28,
        right: 32,
        zIndex: 1,
      }}
    >
      <div
        style={{
          fontFamily: "var(--map-mono)",
          fontSize: 10,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: "var(--map-ink-2)",
          marginBottom: 4,
        }}
      >
        Curation · Daily Cartographer · Manifest
      </div>
      <h1
        style={{
          fontFamily: "var(--map-display)",
          fontWeight: 400,
          fontSize: 26,
          letterSpacing: "0.04em",
          margin: "0 0 8px",
        }}
      >
        Cargo &amp; Provenance{" "}
        <span style={{ fontStyle: "italic", color: "var(--map-rust)" }}>·</span>{" "}
        <span style={{ fontStyle: "italic", color: "var(--map-rust)" }}>
          2026 · IV · 26
        </span>
      </h1>
      <div
        style={{
          fontFamily: "var(--map-mono)",
          fontSize: 11,
          letterSpacing: "0.16em",
          color: "var(--map-ink-2)",
          textTransform: "uppercase",
          display: "flex",
          gap: 32,
          flexWrap: "wrap",
          paddingTop: 8,
          borderTop: "1px solid var(--map-ink-2)",
        }}
      >
        <span>{cardCount} cards on radar</span>
        <span>· {dsl.domains.length} continents</span>
        <span>· {dsl.topics.length} regions</span>
        <span>· {aggCount} aggregates</span>
        <span>· {readCount} read</span>
        <span>· {distinctEntities} distinct entities</span>
      </div>
    </div>
  );
}

// ───────── Table primitives ─────────

function Tr({
  children,
  header,
  read,
  aggregate,
}: {
  children: React.ReactNode;
  header?: boolean;
  read?: boolean;
  aggregate?: boolean;
}) {
  return (
    <tr
      style={{
        background: header
          ? "var(--map-paper-2)"
          : aggregate
            ? "rgba(163,113,26,.06)"
            : "transparent",
        opacity: read ? 0.55 : 1,
        borderBottom: "1px solid rgba(90,66,34,.16)",
      }}
    >
      {children}
    </tr>
  );
}

function Th({
  children,
  width,
  group,
}: {
  children: React.ReactNode;
  width: number;
  group?: string;
}) {
  const groupColor: Record<string, string> = {
    id: "var(--map-ink-2)",
    display: "var(--map-ink)",
    routing: "var(--map-ink-2)",
    meta: "var(--map-ink-2)",
    atlas: "var(--map-rust)",
    content: "var(--map-ink-2)",
  };
  return (
    <th
      style={{
        width,
        minWidth: width,
        textAlign: "left",
        padding: "10px 12px 8px",
        fontFamily: "var(--map-mono)",
        fontSize: 9,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: group ? groupColor[group] : "var(--map-ink)",
        fontWeight: 400,
        borderRight: "1px solid rgba(90,66,34,.18)",
        borderBottom: "2px solid var(--map-ink-2)",
        position: "sticky",
        top: 0,
        background: "var(--map-paper-2)",
        zIndex: 2,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  muted,
  faint,
  bold,
  clamp,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
  faint?: boolean;
  bold?: boolean;
  clamp?: number;
}) {
  // CRITICAL: text styles (font, color, clamp) live on an inner <div>, NOT on
  // the <td> itself. Putting `display: -webkit-box` on the <td> overrides
  // `display: table-cell` and collapses the cell out of the table grid,
  // dragging following columns out of alignment.
  const textStyle: React.CSSProperties = {
    fontFamily: mono ? "var(--map-mono)" : "var(--map-serif)",
    fontSize: mono ? 10.5 : 12,
    color: faint
      ? "var(--map-ink-faint)"
      : muted
        ? "var(--map-ink-2)"
        : "var(--map-ink)",
    fontWeight: bold ? 600 : 400,
  };
  if (clamp) {
    Object.assign(textStyle, {
      display: "-webkit-box",
      WebkitLineClamp: clamp,
      WebkitBoxOrient: "vertical",
      overflow: "hidden",
      lineHeight: 1.45,
      wordBreak: "break-word",
    });
  }
  return (
    <td
      style={{
        padding: "8px 12px",
        verticalAlign: "top",
        borderRight: "1px solid rgba(90,66,34,.10)",
        overflow: "hidden",
      }}
    >
      <div style={textStyle}>{children}</div>
    </td>
  );
}

function Badge({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: string;
}) {
  const palette: Record<string, { bg: string; fg: string; border?: string }> = {
    aggregate: { bg: "var(--map-rust)", fg: "var(--map-vellum)" },
    single: { bg: "var(--map-vellum)", fg: "var(--map-ink-2)", border: "var(--map-ink-2)" },
    ai_curation: { bg: "rgba(163,113,26,.18)", fg: "var(--map-rust)" },
    original_push: { bg: "rgba(122,42,24,.18)", fg: "var(--map-crimson)" },
    none: { bg: "var(--map-paper-2)", fg: "var(--map-ink-faint)" },
    entity: { bg: "var(--map-paper-2)", fg: "var(--map-ink-2)", border: "var(--map-ink-2)" },
    aimodel: { bg: "rgba(60,90,160,.16)", fg: "#3c5aa0" },
    aiproduct: { bg: "rgba(120,80,170,.16)", fg: "#785aaa" },
    academic: { bg: "rgba(60,130,80,.16)", fg: "#3a7a4a" },
    industry: { bg: "rgba(160,120,40,.18)", fg: "var(--map-rust)" },
    industry_news: { bg: "rgba(160,120,40,.18)", fg: "var(--map-rust)" },
    security_alert: { bg: "rgba(170,50,40,.16)", fg: "var(--map-crimson)", border: "var(--map-crimson)" },
    infra: { bg: "rgba(90,90,90,.16)", fg: "#5a5a5a" },
    other: { bg: "rgba(90,66,34,.10)", fg: "var(--map-ink-faint)", border: "var(--map-ink-faint)" },
    misc: { bg: "rgba(90,66,34,.10)", fg: "var(--map-ink-faint)" },
  };
  const p = palette[variant] ?? palette.none;
  return (
    <span
      style={{
        display: "inline-block",
        background: p.bg,
        color: p.fg,
        border: p.border ? `1px solid ${p.border}` : "none",
        padding: "1px 7px",
        fontFamily: "var(--map-mono)",
        fontSize: 9,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ───────── Editor primitives ─────────

function ToolbarButton({
  children,
  onClick,
  accent,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
}) {
  const baseFg = danger
    ? "var(--map-crimson)"
    : accent
      ? "var(--map-vellum)"
      : "var(--map-ink)";
  const baseBg = accent ? "var(--map-ink)" : "transparent";
  const borderColor = danger ? "var(--map-crimson)" : "var(--map-ink-2)";
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--map-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        background: baseBg,
        color: baseFg,
        border: `1px solid ${borderColor}`,
        padding: "5px 10px",
        cursor: "pointer",
        transition: "all .12s",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Inline editable select used in 大领域 / 赛道 cells.
 *
 * Looks like a Badge until hover/focus reveals the dropdown chevron.
 * We use a real `<select>` element so keyboard nav + native dropdown work.
 */
function CellSelect({
  value,
  options,
  onChange,
  variant,
  italic,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  /** If set, lookup palette in Badge for visual continuity. */
  variant?: string;
  italic?: boolean;
}) {
  const isEmpty = !value || !options.some((o) => o.value === value);
  return (
    <select
      value={isEmpty ? "" : value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontFamily: italic ? "var(--map-serif)" : "var(--map-mono)",
        fontStyle: italic ? "italic" : "normal",
        fontSize: italic ? 12 : 10,
        letterSpacing: italic ? "0" : "0.14em",
        textTransform: italic ? "none" : "uppercase",
        color: isEmpty ? "var(--map-ink-faint)" : "var(--map-ink)",
        background: variant
          ? "rgba(160,120,40,.10)"
          : "var(--map-vellum)",
        border: "1px solid var(--map-ink-2)",
        padding: "2px 4px",
        cursor: "pointer",
        maxWidth: "100%",
      }}
    >
      {isEmpty ? <option value="">—</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
