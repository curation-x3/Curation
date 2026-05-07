// Atlas — 8-map cartographic preview (4 perspectives × 2 dates).
//
// Data source: curation-dataset/tag-cards/ (generated to data/tag-data.ts).
// Each tab = one perspective × one date, with L1=BigDomain, L2=SmallDomain.

import { useEffect, useMemo, useState } from "react";
import { MapCanvas } from "./components/MapCanvas";
import { MapTablePage } from "./components/MapTablePage";
import { useMapStore } from "./state/store";
import { taggedCards } from "./data/tag-data";
import { tagCardContent } from "./data/tag-card-content";
import {
  applyCardAssignments,
  applyDslOverrides,
  loadOverrides,
  saveOverrides,
  type MapOverrides,
} from "./state/overrides";
import type { MapCard, MapDSL, Domain, Topic } from "./types";
import type { TopicRef } from "../types";

// D framework: single perspective `persona` (读者人格).
// L1 = 读者的脸（创业故事 / 巨头博弈 / 技术深挖 / 工具新货 /
//                风险预警 / 学术前沿 / 行业脉搏 / 盲区一瞥）
// L2 = 主题领域（AI模型 / AI Agent / 网络安全 / ...）
type PerspectiveKey = "persona";

type Tab =
  | { type: "map"; perspective: PerspectiveKey; date: string }
  | { type: "table" };

// Build flat tab list: 1 perspective × 2 dates + 1 data
const MAP_DATES = ["2026-04-25", "2026-04-26"];
const TABS: Array<{ tab: Tab; label: string; group: string }> = [];
for (const d of MAP_DATES) {
  TABS.push({
    tab: { type: "map", perspective: "persona", date: d },
    label: `舆图 ${d.slice(5)}`,
    group: "舆图",
  });
}
TABS.push({ tab: { type: "table" }, label: "数据", group: "" });

// ───── DSL + card conversion ─────

function deriveDsl(cards: typeof taggedCards, perspective: PerspectiveKey): MapDSL {
  // IMPORTANT: only use tags[0] (the card's primary classification).
  // `convertToMapCards` routes each card to its tags[0] L2, so if we
  // collected L1s from secondary tags here we'd get "ghost" L1s with zero
  // cards routed to them — the user sees empty circles on the map.
  const l1map = new Map<string, string[]>();

  for (const card of cards) {
    const tags = card.tags[perspective] || [];
    if (tags.length === 0) continue;
    const primary = tags[0];
    const parts = primary.split("/");
    const l1 = parts[0];
    const l2 = parts.length >= 2 ? parts[1] : parts[0];
    if (!l1map.has(l1)) l1map.set(l1, []);
    const list = l1map.get(l1)!;
    if (!list.includes(l2)) list.push(l2);
  }

  const domains: Domain[] = [];
  const topics: Topic[] = [];

  // L2 IDs MUST be L1-scoped. The same L2 label (e.g. "AI助手聊天") legitimately
  // appears under multiple L1s (创业故事 / 工具新货 / 巨头博弈 / 行业脉搏).
  // Fix: prefix L2 id with L1, so deriveDsl + tagToSmallDomainId compute the
  // same id deterministically.
  let domainOrder = 0;
  for (const [l1, l2s] of l1map) {
    domains.push({
      id: l1,
      label: l1,
      latin_label: l1.toUpperCase(),
      display_order: domainOrder++,
    });
    let topicOrder = 0;
    for (const l2 of l2s) {
      topics.push({
        id: scopedL2Id(l1, l2),
        domain_id: l1,
        label: l2,
        display_order: topicOrder++,
      });
    }
  }

  // Only add the "未分类" bucket if there's actually at least one card
  // with no tags in this perspective — otherwise it'd render as an empty
  // ghost circle that confuses the visual story.
  const hasUntagged = cards.some(
    (c) => (c.tags[perspective] || []).length === 0,
  );
  if (hasUntagged) {
    domains.push({ id: "untagged", label: "未分类", display_order: domainOrder });
    topics.push({ id: "pending", domain_id: "untagged", label: "未审", display_order: 0 });
  }

  return { domains, topics };
}

/** L1-scoped L2 id. See deriveDsl comment for why this prefix is required. */
function scopedL2Id(l1: string, l2: string): string {
  return `${l1}__${l2}`.replace(/[^a-zA-Z0-9一-鿿_]/g, "_").toLowerCase();
}

function tagToSmallDomainId(tags: string[]): string {
  if (tags.length === 0) return "pending";
  const parts = tags[0].split("/");
  if (parts.length < 2) return "pending";
  return scopedL2Id(parts[0], parts[1]);
}

/**
 * Entities that appear in 2-6 cards within the same date are kept for
 * connection drawing. Below 2 = no pair to connect; above 6 = too many
 * crisscrossing lines (Anthropic in 17 cards = 136 edges = visual chaos).
 * The filter is applied PER-DATE so the map only considers same-day shared
 * entities.
 */
const ENTITY_MIN_FREQ = 2;
const ENTITY_MAX_FREQ = 6;

function filterEntitiesByLocalFrequency(
  cards: typeof taggedCards,
): Map<string, string[]> {
  const freq = new Map<string, number>();
  for (const c of cards) {
    for (const e of c.entities || []) {
      freq.set(e, (freq.get(e) || 0) + 1);
    }
  }
  const filtered = new Map<string, string[]>();
  for (const c of cards) {
    const kept = (c.entities || []).filter((e) => {
      const f = freq.get(e) || 0;
      return f >= ENTITY_MIN_FREQ && f <= ENTITY_MAX_FREQ;
    });
    filtered.set(c.card_id, kept);
  }
  return filtered;
}

function buildTopicRef(
  tags: string[],
  dsl: MapDSL,
): TopicRef | null {
  const topicId = tagToSmallDomainId(tags);
  const topic = dsl.topics.find((t) => t.id === topicId);
  if (!topic) return null;
  const domain = dsl.domains.find((d) => d.id === topic.domain_id);
  return {
    id: topic.id,
    label: topic.label,
    domain_id: topic.domain_id,
    domain_label: domain?.label ?? topic.domain_id,
    domain_latin_label: domain?.latin_label ?? null,
  };
}

function convertToMapCards(
  cards: typeof taggedCards,
  perspective: PerspectiveKey,
  dsl: MapDSL,
): MapCard[] {
  const filteredEntities = filterEntitiesByLocalFrequency(cards);
  return cards.map((tc) => ({
    card_id: tc.card_id,
    article_id: tc.article_id,
    title: tc.title,
    description: tc.description,
    // entities: frequency-filtered subset for route-drawing (formerly shared_entities).
    // MapCard = InboxItem, so entities is the connection-line source.
    entities: filteredEntities.get(tc.card_id) ?? tc.entities ?? [],
    routing: (tc.routing === "discard" ? null : tc.routing) as
      | "ai_curation"
      | "original_content_with_pre_card"
      | "original_content_with_post_card"
      | null,
    template: null,
    template_reason: null,
    card_date: tc.article_date,
    read_at: null,
    queue_status: null,
    article_meta: {
      title: tc.title,
      account: tc.account,
      biz: "",
      author: null,
      publish_time: tc.article_date,
      url: tc.article_url,
      cover_url: null,
      digest: null,
    },
    topic: buildTopicRef(tc.tags[perspective] || [], dsl),
    // reading_minutes not available from mock data; layout falls back to default radius.
    reading_minutes: undefined,
  }));
}

// ───── Map tab content ─────

function MapTabContent({
  perspective,
  date,
  onMarkRead,
}: {
  perspective: PerspectiveKey;
  date: string;
  onMarkRead: (id: string) => void;
}) {
  const dateCards = useMemo(
    () => taggedCards.filter((c) => c.article_date === date),
    [date],
  );
  const dsl = useMemo(() => deriveDsl(dateCards, perspective), [dateCards, perspective]);
  const cards = useMemo(
    () => convertToMapCards(dateCards, perspective, dsl),
    [dateCards, perspective, dsl],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          zIndex: 50,
          fontFamily: "var(--map-serif)",
          fontStyle: "italic",
          fontSize: 12,
          color: "var(--map-rust)",
        }}
      >
        {cards.length} cards · {dsl.domains.length} domains
      </div>
      <MapCanvas
        dsl={dsl}
        cards={cards}
        onMarkRead={onMarkRead}
      />
    </div>
  );
}

// ───── Main ─────

type MapTheme = "light" | "dark";

const THEME_KEY = "map-theme";

function loadTheme(): MapTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {}
  return "light";
}

export function MapPreviewApp() {
  const [activeIdx, setActiveIdx] = useState(0);
  const activeTab = TABS[activeIdx]?.tab ?? TABS[0].tab;

  const [theme, setTheme] = useState<MapTheme>(loadTheme);
  useEffect(() => {
    document.documentElement.setAttribute("data-map-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  // Tab-change cleanup: hovered/drawer state lives in the global zustand
  // store (not in MapTabContent), so even with `key`-based remount they
  // can persist with stale card_ids from the previous date. Force-clear.
  const setHoveredStore = useMapStore((s) => s.setHoveredCard);
  const closeDrawerStore = useMapStore((s) => s.closeDrawer);
  useEffect(() => {
    setHoveredStore(null);
    closeDrawerStore();
  }, [activeIdx, setHoveredStore, closeDrawerStore]);

  // Override layer
  const [overrides, setOverridesState] = useState<MapOverrides>(() =>
    loadOverrides(),
  );
  const updateOverrides = (
    updater: (prev: MapOverrides) => MapOverrides,
  ) => {
    setOverridesState((prev) => {
      const next = updater(prev);
      saveOverrides(next);
      return next;
    });
  };

  const handleMarkRead = (_card_id: string) => {};

  // "数据" tab data
  const allDsl = useMemo(() => deriveDsl(taggedCards, "persona"), []);
  const allCards = useMemo(
    () => convertToMapCards(taggedCards, "persona", allDsl),
    [allDsl],
  );
  const effectiveDsl = useMemo(
    () => applyDslOverrides(allDsl, overrides),
    [allDsl, overrides],
  );
  const effectiveCards = useMemo(
    () => applyCardAssignments(allCards, overrides),
    [allCards, overrides],
  );

  return (
    <>
      <TabBar
        tabs={TABS}
        activeIdx={activeIdx}
        onChange={setActiveIdx}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      {activeTab.type === "table" ? (
        <MapTablePage
          dsl={effectiveDsl}
          cards={effectiveCards}
          cardContent={tagCardContent}
          overrides={overrides}
          onUpdateOverrides={updateOverrides}
        />
      ) : (
        <MapTabContent
          // `key` forces a fresh mount on tab change. Without this, AtlasPage
          // keeps its local state (routeFocus, hovered, etc.) across date
          // switches, which leaves stale entity-focus rendering on the new
          // map until the user manually ESCs.
          key={`${activeTab.perspective}-${activeTab.date}`}
          perspective={activeTab.perspective}
          date={activeTab.date}
          onMarkRead={handleMarkRead}
        />
      )}
    </>
  );
}

// ───── Tab bar with perspective grouping ─────

type TabDef = { tab: Tab; label: string; group: string };

function TabBar({
  tabs,
  activeIdx,
  onChange,
  theme,
  onToggleTheme,
}: {
  tabs: TabDef[];
  activeIdx: number;
  onChange: (idx: number) => void;
  theme: MapTheme;
  onToggleTheme: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 28,
        right: 28,
        zIndex: 50,
        display: "flex",
        gap: 1,
        background: "var(--map-vellum)",
        border: "1.5px solid var(--map-ink)",
        padding: 3,
        boxShadow: "var(--map-shadow-vellum)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--map-mono)",
          fontSize: 8,
          letterSpacing: "0.24em",
          color: "var(--map-ink-2)",
          padding: "8px 10px",
          textTransform: "uppercase",
          borderRight: "1px solid var(--map-ink-2)",
          marginRight: 4,
        }}
      >
        Atlas
      </span>
      {tabs.map((t, i) => {
        const isMap = t.tab.type === "map";
        const isLastOfGroup =
          i === tabs.length - 1 ||
          tabs[i + 1].group !== t.group ||
          t.group === "";

        return (
          <button
            key={i}
            onClick={() => onChange(i)}
            style={{
              fontFamily: "var(--map-display)",
              fontSize: 12,
              letterSpacing: "0.12em",
              background: i === activeIdx ? "var(--map-ink)" : "transparent",
              color: i === activeIdx ? "var(--map-vellum)" : "var(--map-ink)",
              border: "none",
              padding: "8px 12px",
              cursor: "pointer",
              transition: "all .15s",
              marginRight: isLastOfGroup && isMap ? 6 : 0,
              borderRight:
                isLastOfGroup && isMap
                  ? "1px solid var(--map-ink-2)"
                  : "none",
            }}
          >
            {t.label}
          </button>
        );
      })}
      <button
        onClick={onToggleTheme}
        title={theme === "dark" ? "切到日间舆图" : "切到夜间舆图"}
        style={{
          fontFamily: "var(--map-display)",
          fontSize: 13,
          background: "transparent",
          color: "var(--map-ink)",
          border: "none",
          borderLeft: "1px solid var(--map-ink-2)",
          padding: "8px 12px",
          marginLeft: 4,
          cursor: "pointer",
          lineHeight: 1,
          transition: "all .15s",
        }}
      >
        {theme === "dark" ? "☾" : "☼"}
      </button>
    </div>
  );
}
