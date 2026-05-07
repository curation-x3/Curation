// Map (今日舆图) data contracts.
// Spec: docs/superpowers/specs/2026-05-02-atlas-merge-into-main-app-design.md

import type { InboxItem } from "../types";

// ===== DSL = map skeleton (taxonomy) =====
export type MapDSL = {
  domains: Domain[];
  topics: Topic[];
};

export type Domain = {
  id: string;
  label: string;
  latin_label?: string;
  display_order: number;
};

export type Topic = {
  id: string;
  domain_id: string;       // FK → Domain.id
  label: string;
  display_order: number;
};

// ===== Cards = InboxItem itself =====
// MapCard equals InboxItem (topic is on InboxItem as an inline
// TopicRef — denormalized from topic + domain). The map-only
// computed/derived fields (formerly shared_entities, source_count) are now
// derived at render time: shared_entities = entities; source_count = 1 (v1).
export type MapCard = InboxItem;

// ===== Drawer content for one card =====
//
// Keyed by card_id (not article_id) since each card has its own AI-curated
// summary. For aggregate (merged) cards, this is a synthesized summary
// referencing the source cards.
export type ArticleContent = {
  id: string;
  title: string;
  account: string;
  publish_time: string;
  content_md: string;
  rawHtml?: string;
  rawMarkdown?: string;
};

// ===== Layout output (derived in lib/layout.ts) =====
export type MapLayout = {
  canvas: { width: number; height: number };
  continents: ContinentLayout[];
  routes: RouteLayout[];
  /**
   * The "voyage path" — a thick dashed line crossing the canvas left-to-right,
   * threading through the gaps between L1 continents. Decorative cartographic
   * element only (not data-driven). Endpoints sit on the left/right canvas
   * edges; start/end y are controllable so multi-day maps can stitch.
   */
  voyage_path: string;
  voyage_start: { x: number; y: number };
  voyage_end: { x: number; y: number };
};

/**
 * L2 = a mini-continent NESTED inside its L1 parent. Each region has its own
 * irregular coastline (no overlap with sibling regions, contained within the
 * L1 boundary). Cards belonging to the L2 are positioned within this region.
 */
export type TopicRegion = {
  topic_id: string;
  /** Region center, in canvas coords. */
  center: { x: number; y: number };
  /** Region base radius (the irregular coastline wobbles around this). */
  radius: number;
  /** Closed SVG path for the L2 sub-coastline. */
  coastline_path: string;
  /** Label anchor — placed just above the region (or inside if cramped). */
  label_x: number;
  label_y: number;
  /** Whether the label sits above the region (false = inside, when no headroom). */
  label_above: boolean;
};

export type ContinentLayout = {
  big_domain_id: string;
  center: { x: number; y: number };
  radius: number;
  coastline_path: string;
  shadow_path: string;
  sparse: boolean;
  cards: SettlementLayout[];
  /** L2 sub-regions: irregular shapes nested inside this L1 continent. */
  topic_regions: TopicRegion[];
  label_x: number;
  label_y: number;
};

export type SettlementLayout = {
  card_id: string;
  topic_id: string;
  x: number;
  y: number;
  /** Visual radius in px. */
  radius: number;
  /** Whether to render as filled (hot) or hollow (single source). */
  hot: boolean;
};

export type RouteLayout = {
  from_card_id: string;
  to_card_id: string;
  path: string;
  shared_entities: string[];
};
