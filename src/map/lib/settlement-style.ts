import type { MapCard } from "../types";

export type SettlementShape =
  | "star"
  | "triangle"
  | "circle-rust"
  | "circle-vellum";

/**
 * Determine the visual category of a settlement, by priority:
 *   1. favorited → "star" (overrides everything)
 *   2. no card (article-only / 临时文章) → "triangle"
 *   3. ai_curation → "circle-rust"
 *   4. original_content_with_* → "circle-vellum"
 *   5. fallback (null routing with a card) → "circle-rust"
 */
export function pickShape(card: MapCard, isFavorited: boolean): SettlementShape {
  if (isFavorited) return "star";
  if (!card.card_id) return "triangle";
  if (card.routing === "ai_curation") return "circle-rust";
  if (
    card.routing === "original_content_with_pre_card" ||
    card.routing === "original_content_with_post_card"
  ) {
    return "circle-vellum";
  }
  return "circle-rust";
}

/**
 * Base radius in px from reading_minutes via sqrt curve.
 * Reference: 1 min → 4.8, 5 min → 7.0, 10 min → 8.7, 20+ min → 11 (cap).
 */
export function baseRadius(readingMinutes: number | undefined): number {
  const m = Math.max(0, readingMinutes ?? 1);
  return Math.min(11, Math.max(4, 3 + Math.sqrt(m) * 1.8));
}

/**
 * Aggregate ring count = max(0, source_count − 1), capped at 4.
 * Settlement renders ringCount(n) dashed concentric circles around the base shape.
 * v1 source_count is always 1 → 0 rings; renderer is future-proof.
 */
export function ringCount(sourceCount: number | undefined): number {
  const n = sourceCount ?? 1;
  return Math.min(4, Math.max(0, n - 1));
}

export function sourceCount(card: Pick<MapCard, "source_card_ids"> & { source_count?: number | null }): number {
  if (Array.isArray(card.source_card_ids) && card.source_card_ids.length > 0) {
    return card.source_card_ids.length;
  }
  return card.source_count ?? 1;
}

/** 5-pointed star, outer radius r, inner radius r * 0.4. */
export function starPath(r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? r : r * 0.4;
    points.push(
      `${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join(" L")} Z`;
}

/** Equilateral triangle pointing up, circumscribed by radius r. */
export function trianglePath(r: number): string {
  const a = -Math.PI / 2;
  const pts = [0, 1, 2].map((i) => {
    const ang = a + (i * 2 * Math.PI) / 3;
    return `${(r * Math.cos(ang)).toFixed(2)},${(r * Math.sin(ang)).toFixed(2)}`;
  });
  return `M${pts.join(" L")} Z`;
}
