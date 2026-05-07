// Atlas — layout algorithm.
//
// Pure function: (dsl, cards, canvas) -> MapLayout.
// Same input always produces the same output (snapshot-testable).
//
// Strategy:
//   1. Group cards by big_domain (via small_domain_id -> big_domain).
//   2. Place continent centers on a hand-tuned grid (preview: hardcoded
//      slots; reorder by card count so dense continents take the central
//      slots).
//   3. For each continent, generate a coastline path, then place its
//      settlements (cards) inside the coastline by small-domain sector.
//   4. Compute trade routes from card-pair shared_entities intersections.

import { generateCoastline } from "./coastline";
import { curvedRoute, hashSeed, mulberry32 } from "./geometry";
import type {
  MapCard,
  MapDSL,
  MapLayout,
  ContinentLayout,
  Domain,
  RouteLayout,
  SettlementLayout,
  Topic,
  TopicRegion,
} from "../types";

/** Default canvas (matches the explored mockup viewBox). */
export const MAP_CANVAS = { width: 1600, height: 900 };

/**
 * UI elements that L1 continents must steer clear of (in canvas coords).
 * The relaxation step pushes any continent overlapping these rectangles
 * (plus the rect's `pad` margin) outward.
 */
const FORBIDDEN_ZONES: Array<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  pad: number;
}> = [
  // Cartouche (top-left)
  { x1: 0, y1: 0, x2: 340, y2: 130, pad: 8 },
  // Legend (bottom-left)
  { x1: 20, y1: 720, x2: 320, y2: 880, pad: 8 },
  // Compass (bottom-right)
  { x1: 1420, y1: 720, x2: 1580, y2: 870, pad: 8 },
  // Tab bar (top-right)
  { x1: 1220, y1: 0, x2: 1580, y2: 80, pad: 8 },
  // Mare Tenebrarum label
  { x1: 1300, y1: 130, x2: 1500, y2: 195, pad: 4 },
  // Terra Incognita label
  { x1: 200, y1: 845, x2: 360, y2: 905, pad: 4 },
];

/** Continents with fewer cards than this render as sparse (dashed, dimmer). */
const SPARSE_THRESHOLD = 2;
/** Min/max L1 radius (px). Caps the count-derived size. */
const L1_MIN_R = 38;
const L1_MAX_R = 175;

// ═══════════════ Single source of truth ═══════════════
//
// Everything else in this file derives from these design tolerances and
// rendering style constants. To change the look:
//   - VISUAL_GAP_COAST       → spacing between L1 coastlines
//   - L2_GAP_COAST           → spacing between L2 coastlines (smaller —
//                              L2s are themselves smaller, so an absolute
//                              gap that's right for L1 looks proportionally
//                              huge between L2s)
//   - VISUAL_GAP_LABEL_COAST → spacing between a label's halo and its coastline
//   - L1_FONT / L2_FONT      → if you change the font in MapSvg, mirror here
// All other distances (label_y, pair_padding, max L2 radius, ring distance, …)
// are computed from these — no per-case tuning.

/** Coastline wobble factors — must match `generateCoastline()` defaults. */
const L1_WOBBLE = 0.28;
const L2_WOBBLE = 0.18;
const L1_OUTER = 1 + L1_WOBBLE; // 1.28 — outer wobble peak
const L2_OUTER = 1 + L2_WOBBLE; // 1.18

/** Visible empty space between two L1 coastline outer wobble peaks. */
const VISUAL_GAP_COAST = 8;
/**
 * Visible empty space between two L2 coastlines (and between an L2 and its
 * parent L1's inner boundary). Smaller than the L1 gap because L2 circles
 * are themselves smaller — keeping the same absolute gap as L1 would make
 * L2 spacing look proportionally enormous.
 */
const L2_GAP_COAST = 3.75; // 3 → 3.75 (+25%)
/** Minimum visible empty space between a label's halo and its coastline. */
const VISUAL_GAP_LABEL_COAST = 6;

/**
 * How aggressively to push L2 packing toward L1's *visible* outer edge.
 *
 * L1's coastline at any angle is in `[parentR · (1−L1_WOBBLE),
 * parentR · (1+L1_WOBBLE)]`. The *strict-safe* L2 boundary is the inner
 * trough (parentR · (1−L1_WOBBLE)), giving guaranteed no-overlap but
 * leaving a wide annulus of empty space at most angles. Relaxing the
 * boundary toward L1's mean radius (= parentR · 1.0) lets L2s fill more
 * of the visible interior, at the cost of occasional grazing where
 * L1's wobble trough happens to align with L2's wobble peak.
 *
 * `L1_BUDGET` interpolates: 0.0 = strict trough, 1.0 = mean radius.
 *   0.5 → L2 outer reach equals (trough + mean) / 2 — typical case.
 */
const L1_BUDGET = 0.80;
const L1_PACK_INNER = 1 - L1_WOBBLE * (1 - L1_BUDGET); // ≈ 0.944

// ═══════════════ Bottom-up sizing ═══════════════
//
// Sizes propagate UP from cards → L2 → L1, instead of being squeezed DOWN
// from a fixed canvas budget. The result: every circle's radius reflects
// real content density. A 10-card L2 is visibly bigger than a 1-card L2,
// and an L1 holding many large L2s is visibly bigger than one holding few.
//
// Card dot has a *fixed* visual size (the design unit). L2 = the smallest
// circle that fits its K dots in a sunflower packing (plus L2's own wobble).
// L1 = the smallest circle that fits its N L2s in a ring (using the same
// outer-D max-r geometry as the L2 packer, but inverted).

/** Each card-dot's effective on-screen radius (visual unit). */
const DOT_R = 4.5;
/** Min spacing between adjacent dot edges in a sunflower packing. */
const DOT_GAP = 4.375; // 3.5 → 4.375 (+25%)
/**
 * Sunflower packing efficiency — fraction of L2 inner area that's dots vs.
 * empty space between them. Empirical for golden-angle spirals: ~0.78.
 */
const SUNFLOWER_EFFICIENCY = 0.78;

/**
 * Total fraction of canvas the algorithm aims to fill (sum of L1 base areas).
 * Lower = more breathing room between L1s but smaller continents.
 *
 * Note: this is an *upper bound* — actual fill is min(this, max-r-binding).
 * For dense datasets (10+ L1s with required PAIR_GAP), 0.40 leaves enough
 * gap that pairwise relaxation can always converge to no-overlap.
 */
const CANVAS_FILL_TARGET = 0.40;

/**
 * Required L2 base radius to display K cards as dots, with safety margin
 * for L2's own wobble peak. Derived from sunflower area:
 *   K dots × π · (DOT_R + DOT_GAP/2)² / SUNFLOWER_EFFICIENCY
 *
 * Floor is set just above one dot diameter — this is the minimum visible
 * "place" for K=1. Without this aggressive low floor, K=1, 2, 3 all clamp
 * to the same size and the visual stops conveying card density.
 */
function requiredL2Radius(K: number): number {
  const dotEff = DOT_R + DOT_GAP / 2;
  const innerArea = (K * Math.PI * dotEff * dotEff) / SUNFLOWER_EFFICIENCY;
  const innerR = Math.sqrt(innerArea / Math.PI);
  // L2 base radius — divide by (1 - L2_WOBBLE) so wobble troughs still
  // contain the dot zone.
  const baseR = innerR / (1 - L2_WOBBLE);
  // Floor: enough room for one dot + small breathing margin. Smaller than
  // before so K=1 looks visibly smaller than K=4 etc.
  const floor = (DOT_R + DOT_GAP) / (1 - L2_WOBBLE);
  return Math.max(floor, baseR);
}

/**
 * Required L1 base radius to contain N L2s of given radii in a ring.
 *
 * Uses the same outer-D max-r geometry as `packL2RandomRelaxed`, inverted
 * — given r_max (largest L2), solve for the L1 inner safe radius L:
 *
 *   L = (r_max · o · (1 + s) + GAP/2) / s     where s = sin(π/N), o = L2_OUTER
 *
 * Then the L1 base radius is L scaled back through L1_PACK_INNER plus a
 * coast-edge gap.
 *
 * Special cases: N=0 (sparse, no L2) and N=1 (concentric L2).
 */
function requiredL1Radius(l2Radii: number[]): number {
  const N = l2Radii.length;
  if (N === 0) return L1_MIN_R;
  const o = L2_OUTER;
  const r_max = Math.max(...l2Radii);
  let safeInner: number;
  if (N === 1) {
    safeInner = r_max * o;
  } else {
    const s = Math.sin(Math.PI / N);
    // L2 pairwise gap inside L1 — uses L2_GAP_COAST (smaller than L1's gap).
    safeInner = (r_max * o * (1 + s) + L2_GAP_COAST / 2) / s;
  }
  // Convert L1 safe-inner → L1 base radius. Add L2_GAP_COAST so the
  // outermost L2 wobble peak doesn't kiss the L1 inner-trough boundary.
  return safeInner / L1_PACK_INNER + L2_GAP_COAST;
}

/**
 * Required L1 radius for a sparse atoll (no L2 nesting, K cards placed
 * directly in the L1).
 */
function requiredSparseL1Radius(K: number): number {
  // Same as L2 sizing — sparse L1 is essentially a single L2-shaped region.
  return Math.max(L1_MIN_R, requiredL2Radius(K));
}

/** Rendering style constants — must mirror MapSvg.tsx render values. */
const L1_FONT = { size: 17, haloStroke: 4.5 };
// L2 font is sized per-region by MapSvg (Math.max(11, Math.min(14, r*0.28))).
// We use the *largest* expected fontSize here so the gap is conservative
// (i.e. labels never get too close to the coastline at any size).
const L2_FONT = { size: 14, haloStroke: 3 };

/**
 * Baseline-to-coastline-top distance such that the visible halo bottom
 * sits exactly `VISUAL_GAP_LABEL_COAST` px above the coastline.
 *
 * Halo bottom = baseline + font.descent + haloStroke/2
 * descent ≈ 0.22 * fontSize (typical for serif/display fonts at this scale)
 */
const fontDescent = (size: number) => size * 0.22;
const labelBaselineGap = (font: { size: number; haloStroke: number }) =>
  VISUAL_GAP_LABEL_COAST + fontDescent(font.size) + font.haloStroke / 2;

const L1_LABEL_GAP = labelBaselineGap(L1_FONT); // ≈ 6 + 3.74 + 2.25 = 12
const L2_LABEL_GAP = labelBaselineGap(L2_FONT); // ≈ 6 + 3.08 + 1.5  = 10.6

/**
 * Voyage-path control options. Both endpoints are y-coords on the canvas
 * left/right edges; defaults to canvas vertical midline. Stitching multiple
 * days = pass `start_y` of day N+1 = `end_y` of day N.
 */
export type VoyageOpts = {
  start_y?: number;
  end_y?: number;
  /** RNG seed for hand-drawn jitter — tweak to get a different squiggle. */
  seed?: string;
};

export function computeLayout(
  dsl: MapDSL,
  cards: MapCard[],
  canvas: { width: number; height: number } = MAP_CANVAS,
  voyageOpts: VoyageOpts = {},
): MapLayout {
  // Filter cards without a topic — they can't be placed on the map.
  const validCards = cards.filter((c) => c.topic?.id != null);

  // Build topicsByDomain map: domain_id → Topic[] sorted by display_order.
  const topicsByDomain = new Map<string, Topic[]>();
  for (const t of dsl.topics) {
    if (!topicsByDomain.has(t.domain_id)) topicsByDomain.set(t.domain_id, []);
    topicsByDomain.get(t.domain_id)!.push(t);
  }
  for (const list of topicsByDomain.values()) list.sort((a, b) => a.display_order - b.display_order);

  // Build topic -> domain index.
  const topic_to_domain = new Map<string, string>();
  for (const t of dsl.topics) {
    topic_to_domain.set(t.id, t.domain_id);
  }

  // Group cards by domain, preserving order from dsl.domains.
  const groups = new Map<string, MapCard[]>();
  for (const bd of dsl.domains) groups.set(bd.id, []);
  for (const c of validCards) {
    const bd_id = topic_to_domain.get(c.topic!.id);
    if (!bd_id) continue; // shouldn't happen — validate runs first
    groups.get(bd_id)!.push(c);
  }

  // ════════ Bottom-up sizing ════════
  // Step A: per L1, group cards by L2 and compute each L2's required radius
  //          from K cards.
  // Step B: each L1's required radius = enough to ring-pack its L2s
  //          (or sparse atoll size if 0/1 L2s). For sparse/1-card L1s the
  //          L1 itself sizes as if it were a single L2.
  // Step C: if total required area exceeds canvas budget, scale all radii
  //          uniformly down to fit. If under-budget, leave as-is (whitespace
  //          is fine — the map honestly reflects "you have less to read today").
  const plans: L1Plan[] = dsl.domains.map((bd) => {
    const bdCards = groups.get(bd.id) ?? [];
    const sparse = bdCards.length < SPARSE_THRESHOLD;
    const topicIds = (topicsByDomain.get(bd.id) ?? []).map((t) => t.id);
    const cardsBySid = new Map<string, MapCard[]>();
    for (const sid of topicIds) cardsBySid.set(sid, []);
    for (const c of bdCards) {
      const list = cardsBySid.get(c.topic!.id);
      if (list) list.push(c);
    }
    const filledSids = topicIds.filter(
      (sid) => (cardsBySid.get(sid)?.length || 0) > 0,
    );
    // Compute L2 radii from card counts (bottom-up).
    const l2Radii = new Map<string, number>();
    for (const sid of filledSids) {
      const K = cardsBySid.get(sid)!.length;
      l2Radii.set(sid, requiredL2Radius(K));
    }
    // Compute L1 radius from L2 radii (bottom-up).
    let l1Radius: number;
    if (sparse || filledSids.length === 0) {
      l1Radius = requiredSparseL1Radius(Math.max(1, bdCards.length));
    } else {
      l1Radius = requiredL1Radius(filledSids.map((sid) => l2Radii.get(sid)!));
    }
    return { bd_id: bd.id, topicIds, cards: bdCards, sparse, filledSids, cardsBySid, l2Radii, l1Radius };
  });

  // Step C: pick a uniform scale that preserves bottom-up proportions while
  // (a) fitting the canvas area budget and (b) not blowing past L1_MAX_R.
  //
  // Two candidate scales:
  //   scaleByArea — total L1 area equals `CANVAS_FILL_TARGET` of canvas
  //   scaleByMax  — largest L1 fits exactly at L1_MAX_R
  // We take the *smaller* — whichever constraint binds first. This way:
  //   - lots of cards / small canvas → area binds, L1s shrink uniformly
  //   - few cards / large canvas    → max binds, biggest L1 hits MAX_R,
  //                                   others stay proportional
  const totalRequiredArea = plans.reduce(
    (sum, p) => sum + Math.PI * p.l1Radius * p.l1Radius,
    0,
  );
  const canvasBudget = canvas.width * canvas.height * CANVAS_FILL_TARGET;
  const scaleByArea = Math.sqrt(canvasBudget / Math.max(1, totalRequiredArea));
  const maxRequiredR = Math.max(...plans.map((p) => p.l1Radius));
  const scaleByMax = L1_MAX_R / Math.max(1, maxRequiredR);
  const scale = Math.min(scaleByArea, scaleByMax);

  for (const p of plans) {
    if (p.sparse) {
      // Sparse atolls (0/1 cards) stay at L1_MIN_R regardless of scale —
      // scaling an empty L1 to match the dense ones produces visually
      // weird "huge empty island" + makes packing harder. Atolls should
      // *look* like atolls.
      p.l1Radius = L1_MIN_R;
    } else {
      p.l1Radius = Math.max(L1_MIN_R, p.l1Radius * scale);
      for (const sid of p.filledSids) {
        p.l2Radii.set(sid, p.l2Radii.get(sid)! * scale);
      }
    }
  }

  // Sort by L1 radius desc so packL1Continents places the biggest first.
  const sortedPlans = [...plans].sort((a, b) => b.l1Radius - a.l1Radius);

  // Seeded random L1 layout — different across tabs (DSL identity), stable
  // across renders within a tab. Each L1 gets a unique position with no
  // overlaps and no collisions with UI furniture.
  const l1Seed = `l1-${dsl.domains.map((b) => b.id).join("|")}`;
  const l1Slots = packL1ContinentsByRadii(
    sortedPlans.map((p) => p.l1Radius),
    canvas.width,
    canvas.height,
    l1Seed,
  );

  const continents: ContinentLayout[] = [];
  sortedPlans.forEach((plan, idx) => {
    const bd = dsl.domains.find((b) => b.id === plan.bd_id)!;
    const slot = l1Slots[idx];
    const radius = slot.radius;
    const seed = `coast-${bd.id}`;
    const coast = generateCoastline({
      cx: slot.x,
      cy: slot.y,
      radius,
      seed,
      sparse: plan.sparse,
    });
    const shadow = generateCoastline({
      cx: slot.x,
      cy: slot.y,
      radius: radius * 1.04,
      seed,
      sparse: plan.sparse,
    });

    const { settlements, regions } = layoutSettlements(
      bd,
      plan,
      slot.x,
      slot.y,
      radius,
    );

    const cont: ContinentLayout = {
      big_domain_id: bd.id,
      center: { x: slot.x, y: slot.y },
      radius,
      coastline_path: coast.path,
      shadow_path: shadow.path,
      sparse: plan.sparse,
      cards: settlements,
      topic_regions: regions,
      label_x: slot.x,
      // CONSTANT visual gap from the actual coastline edge — anchored to
      // the path's true top, not the base radius. So every L1 has the same
      // distance between its squiggly top and its label, regardless of
      // where its individual wobble peaks happen to land.
      label_y: coast.top_y - L1_LABEL_GAP,
    };
    continents.push(cont);
  });

  // ════════ Trade routes: minimum spanning tree per shared entity ════════
  //
  // Naive pair-wise edges produce C(N,2) lines for an N-card entity (5 cards
  // → 10 lines = visual chaos). Instead, for each entity we compute a
  // minimum spanning tree over its cards: N cards → N-1 edges that still
  // make the cluster traversable, but without the redundant crisscross.
  //
  // Same pair sharing multiple entities may render multiple semantic lines.
  // Duplicate-pair curves are offset so the lines do not overlap.
  const cardPos = new Map<string, { x: number; y: number; r: number }>();
  for (const c of continents) {
    for (const s of c.cards) {
      cardPos.set(s.card_id, { x: s.x, y: s.y, r: s.radius });
    }
  }
  const allSettlements = Array.from(cardPos.entries()).map(([id, p]) => ({
    id,
    x: p.x,
    y: p.y,
    r: p.r,
  }));
  const cardById = new Map(validCards.map((c) => [c.card_id!, c]));
  const routes: RouteLayout[] = [];
  const pairUseCount = new Map<string, number>();

  function routePairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  function offsetDuplicateBow(baseBow: number, duplicateIndex: number): number {
    if (duplicateIndex === 0) return baseBow;
    const magnitude = 36 * Math.ceil(duplicateIndex / 2);
    const direction = duplicateIndex % 2 === 1 ? 1 : -1;
    return baseBow + direction * magnitude;
  }

  /** Sample N evenly-spaced points along a quadratic bezier. */
  function sampleBezier(
    ax: number, ay: number,
    cx: number, cy: number,
    bx: number, by: number,
    n: number,
  ): Array<{ x: number; y: number }> {
    const pts: Array<{ x: number; y: number }> = [];
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const u = 1 - t;
      const x = u * u * ax + 2 * u * t * cx + t * t * bx;
      const y = u * u * ay + 2 * u * t * cy + t * t * by;
      pts.push({ x, y });
    }
    return pts;
  }

  /** Min clearance from bezier samples to any non-endpoint settlement. */
  function scoreBow(
    ax: number, ay: number, bx: number, by: number,
    bow: number,
    excludeIds: Set<string>,
  ): number {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len;
    const py = dx / len;
    const cx = mx + px * bow;
    const cy = my + py * bow;
    const samples = sampleBezier(ax, ay, cx, cy, bx, by, 14);
    let minClearance = Infinity;
    for (const s of allSettlements) {
      if (excludeIds.has(s.id)) continue;
      for (const p of samples) {
        const d = Math.hypot(p.x - s.x, p.y - s.y) - (s.r + 6);
        if (d < minClearance) minClearance = d;
      }
    }
    return minClearance;
  }

  /**
   * Prim's MST on a point set. Returns N-1 edges as [iA, iB] index pairs.
   * Edge weight = euclidean distance (shorter cards = preferred connection).
   */
  function computeMST(
    nodes: Array<{ id: string; x: number; y: number }>,
  ): Array<[number, number]> {
    if (nodes.length < 2) return [];
    const inTree = new Set<number>([0]);
    const edges: Array<[number, number]> = [];
    while (inTree.size < nodes.length) {
      let bestDist = Infinity;
      let bestPair: [number, number] | null = null;
      for (const i of inTree) {
        for (let j = 0; j < nodes.length; j++) {
          if (inTree.has(j)) continue;
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < bestDist) {
            bestDist = d;
            bestPair = [i, j];
          }
        }
      }
      if (!bestPair) break;
      edges.push(bestPair);
      inTree.add(bestPair[1]);
    }
    return edges;
  }

  // Group cards by entity (formerly shared_entities — now sourced from InboxItem.entities).
  const cardsByEntity = new Map<
    string,
    Array<{ id: string; x: number; y: number }>
  >();
  for (const c of validCards) {
    if (!c.card_id || !c.entities) continue;
    const pos = cardPos.get(c.card_id);
    if (!pos) continue;
    for (const e of c.entities) {
      if (!cardsByEntity.has(e)) cardsByEntity.set(e, []);
      cardsByEntity.get(e)!.push({ id: c.card_id, x: pos.x, y: pos.y });
    }
  }

  // For each entity with ≥2 cards, build MST and emit one route per edge.
  for (const [entity, nodeList] of cardsByEntity) {
    if (nodeList.length < 2) continue;
    const mstEdges = computeMST(nodeList);
    for (const [iA, iB] of mstEdges) {
      const a = nodeList[iA];
      const b = nodeList[iB];
      // Search bow that maximizes clearance from unrelated settlements.
      const seed = hashSeed(`route-${entity}-${a.id}-${b.id}`);
      const exclude = new Set([a.id, b.id]);
      const bowCandidates = [
        30, 50, 75, 100, 130, 165, 200,
        -30, -50, -75, -100, -130, -165, -200,
      ];
      const jittered = bowCandidates.map((b) => b + ((seed % 7) - 3));
      let bestBow = jittered[0];
      let bestScore = -Infinity;
      for (const bow of jittered) {
        const s = scoreBow(a.x, a.y, b.x, b.y, bow, exclude);
        const adjusted = s - Math.abs(bow) * 0.02;
        if (adjusted > bestScore) {
          bestScore = adjusted;
          bestBow = bow;
        }
      }
      const pairKey = routePairKey(a.id, b.id);
      const duplicateIndex = pairUseCount.get(pairKey) ?? 0;
      pairUseCount.set(pairKey, duplicateIndex + 1);
      const routeBow = offsetDuplicateBow(bestBow, duplicateIndex);
      const route = {
        from_card_id: a.id,
        to_card_id: b.id,
        path: curvedRoute(a.x, a.y, b.x, b.y, routeBow),
        shared_entities: [entity],
      };
      routes.push(route);
    }
  }

  // Suppress unused warning (cardById may aid future enrichment).
  void cardById;

  // ════════ Voyage path ════════
  // A thick dashed line crossing the canvas left → right, threading
  // through the gaps between L1 continents. Endpoints sit on canvas
  // edges; both y values are caller-controllable for multi-day stitching.
  const start_y = voyageOpts.start_y ?? canvas.height * 0.5;
  const end_y = voyageOpts.end_y ?? canvas.height * 0.5;
  const voyage = computeVoyagePath(
    continents,
    canvas,
    start_y,
    end_y,
    voyageOpts.seed ?? `voyage-${dsl.domains.map((b) => b.id).join("|")}`,
  );

  return {
    canvas,
    continents,
    routes,
    voyage_path: voyage.path,
    voyage_start: { x: 0, y: start_y },
    voyage_end: { x: canvas.width, y: end_y },
  };
}

/**
 * Lay out an L1 continent's interior:
 *
 *   1. Each L2 (small_domain) becomes a mini-continent — its own irregular
 *      coastline circle nested inside the L1 boundary.
 *   2. L2 mini-circles are packed via deterministic ring layout so:
 *        - they don't overlap each other
 *        - they all fit fully inside the L1 boundary
 *      Sizes are weighted by L2 card count so denser L2s look bigger.
 *   3. Cards (settlements) are placed inside their L2 region using
 *      sunflower / golden-angle spacing, biased away from the L2 label.
 *   4. L2 labels sit just above the L2 mini-coastline (or inside top, if
 *      placing above would cross the L1 boundary).
 *
 * Sparse continents (atolls) skip the nested L2 step — they're too small to
 * usefully nest, so cards drop directly into the L1 with golden-angle spread.
 */
type L1Plan = {
  bd_id: string;
  topicIds: string[];
  cards: MapCard[];
  sparse: boolean;
  filledSids: string[];
  cardsBySid: Map<string, MapCard[]>;
  l2Radii: Map<string, number>;
  l1Radius: number;
};

function layoutSettlements(
  _bd: Domain,
  plan: L1Plan,
  cx: number,
  cy: number,
  radius: number,
): { settlements: SettlementLayout[]; regions: TopicRegion[] } {
  if (plan.cards.length === 0) return { settlements: [], regions: [] };

  // ───── Sparse atolls: skip L2 nesting ─────
  if (plan.sparse || plan.filledSids.length === 0) {
    return {
      settlements: placeCardsInCircle(
        plan.cards,
        cx,
        cy,
        // Atolls also wobble (sparse=true uses generateCoastline with smaller
        // wobble 0.18) — use that to size the safe inner area for dots.
        radius * (1 - 0.18) - 4,
      ),
      regions: [],
    };
  }

  // ───── Dense continents: place pre-sized L2 circles ─────
  // L2 radii were computed bottom-up by `requiredL2Radius(K)` and live in
  // `plan.l2Radii`. Sort by radius desc so the biggest L2 takes the most
  // visually prominent slot.
  const orderedFilled = [...plan.filledSids].sort(
    (a, b) => plan.l2Radii.get(b)! - plan.l2Radii.get(a)!,
  );
  const orderedRadii = orderedFilled.map((sid) => plan.l2Radii.get(sid)!);

  const packed = packL2WithRadii(
    orderedRadii,
    radius,
    `pack-${plan.topicIds.join("|")}`,
  );

  const regions: TopicRegion[] = [];
  const settlements: SettlementLayout[] = [];

  orderedFilled.forEach((sid, slotIdx) => {
    const slot = packed[slotIdx];
    const list = plan.cardsBySid.get(sid)!;
    const l2r = slot.r;

    const l2cx = cx + slot.dx;
    const l2cy = cy + slot.dy;

    // L2 mini-coastline (slightly less wobble than L1 so nesting reads cleanly).
    const l2coast = generateCoastline({
      cx: l2cx,
      cy: l2cy,
      radius: l2r,
      seed: `l2-${plan.topicIds.indexOf(sid)}-${sid}`,
      segments: 9,
      wobble: 0.18,
    });

    // Label position: anchored at a CONSTANT visual gap above the L2's
    // actual coastline top, not relative to base radius. This ensures
    // every L2 across the map has identical-looking label spacing.
    const labelAboveY = l2coast.top_y - L2_LABEL_GAP;
    const useAbove = labelAboveY > 12; // only fall back if it'd cross canvas top
    const label_x = l2cx;
    const label_y = useAbove ? labelAboveY : l2cy - l2r * 0.45;

    regions.push({
      topic_id: sid,
      center: { x: l2cx, y: l2cy },
      radius: l2r,
      coastline_path: l2coast.path,
      label_x,
      label_y,
      label_above: useAbove,
    });

    // Place cards inside this L2 region.
    // Use L2's inner-wobble radius as the safe placement boundary so dots
    // don't poke through L2 coastline troughs. Reserve a "label band" at
    // the top of L2 (~38% of radius) when the label is placed inside.
    const innerSettlements = placeCardsInCircle(
      list,
      l2cx,
      l2cy,
      l2r * (1 - L2_WOBBLE) - 4,
      /* avoidTopFrac= */ useAbove ? 0 : 0.38,
    );
    // Re-stamp topic_id (placeCardsInCircle preserves card props but
    // we want to be explicit).
    for (const s of innerSettlements) {
      s.topic_id = sid;
      settlements.push(s);
    }
  });

  return { settlements, regions };
}

/**
 * Pack N circles inside a parent circle of radius `parentR` using a seeded
 * random initial layout + physical relaxation (repulsion + boundary push-in).
 *
 * Why not a fixed ring template? Because identical N would produce identical
 * shapes across L1s, making the map look obviously templated. With seeded
 * randomness, each L1 gets its own organic layout while still being
 * deterministic (same seed → same output across renders).
 *
 * Algorithm:
 *   1. Compute each circle's target radius from card weights (sqrt scaling
 *      so area is proportional to weight). Cap at MAX_FRAC of parentR.
 *   2. Seed with random initial positions inside parent (sqrt-distributed
 *      so density is uniform by area, not by radius).
 *   3. Relax for K iterations: pairwise repulsion when overlapping, plus
 *      boundary push-in. Convergence is fast for N <= 8.
 */
/**
 * Pack N L2 circles inside an L1 of base radius `parentR`.
 *
 * Algorithm derives every distance from geometric invariants. The single
 * design dial is `VISUAL_GAP_COAST` (visible empty space between any two
 * coastline edges). No per-N magic numbers.
 *
 * Geometry:
 *   - L1 inner safe boundary (where L2 outer-peak must stop):
 *       L = parentR * (1 - L1_WOBBLE) - VISUAL_GAP_COAST
 *   - L2 outer reach factor: o = 1 + L2_WOBBLE
 *
 * For N ≥ 2 circles arranged on a ring at distance D from L1 center, mutual
 * no-overlap and L1 containment give two constraints:
 *
 *     pairwise:  2·D·sin(π/N) ≥ 2·r·o + VISUAL_GAP_COAST   ...(P)
 *     boundary:  D + r·o ≤ L                               ...(B)
 *
 * **Maximum-r solution** (where both (P) and (B) bind simultaneously) gives
 * the biggest L2 circles that still pack legally:
 *
 *     r_max = (s·L − GAP/2) / (o·(1 + s))     where s = sin(π/N)
 *     D     = L − r_max·o                     // L2 wobble peak kisses
 *                                                L1 inner-wobble trough
 *
 * Pushing L2s to the L1 edge (rather than the visually balanced D = L/2)
 * gives bigger L2s and visually spreads them outward — less empty space
 * inside L1, less "clustered in the middle".
 *
 * Per-L2 size = r_max · sqrt(count_i / max_count), area-proportional to
 * card count, floored at a readable minimum.
 *
 * For N = 1 the single L2 sits concentric, filling L entirely (r = L/o).
 */
/**
 * Pack N L2 circles of pre-computed radii inside an L1 of base radius
 * `parentR`. Radii come from `requiredL2Radius(K)` so each L2's size
 * already reflects its card count — no internal sizing logic.
 *
 * Geometry constraints (still derived from VISUAL_GAP_COAST, L1_BUDGET,
 * etc.) place each L2 on a ring around L1 center.
 */
function packL2WithRadii(
  radii: number[],
  parentR: number,
  seed: string,
): Array<{ dx: number; dy: number; r: number }> {
  const N = radii.length;
  if (N <= 0) return [];

  const L = parentR * L1_PACK_INNER - L2_GAP_COAST;
  const o = L2_OUTER;

  if (N === 1) {
    return [{ dx: 0, dy: 0, r: Math.min(radii[0], Math.max(0, L / o)) }];
  }

  const r_max = Math.max(...radii);
  const s = Math.sin(Math.PI / N);

  // Helpers — legal D range for a given r (from constraints).
  const D_min_for = (r: number) => (r * o + L2_GAP_COAST / 2) / s;
  const D_max_for = (r: number) => L - r * o;

  // Default ring distance: push to L1 edge for max-r L2s. Smaller L2s sit
  // proportionally inward (still on a wider band so they don't all align).
  // For a smaller L2 with r < r_max, D = D_max_for(r) > D_max_for(r_max),
  // i.e. it can sit even farther — but we don't want it sticking out past
  // the main ring, so cap at D_max_for(r_max).
  const D_outer = D_max_for(r_max);

  // ── Step 2: stratified angular placement ──
  const rng = mulberry32(hashSeed(seed));
  const ringRotation = rng() * Math.PI * 2;
  const angularStep = (Math.PI * 2) / N;
  // Angular jitter capped so neighbour sectors can't swap.
  const angularJitter = angularStep * 0.18;
  const positions: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < N; i++) {
    const r = radii[i];
    const angle =
      ringRotation + i * angularStep + (rng() - 0.5) * angularJitter * 2;
    // Anchor each L2 at D_outer (or its own legal D_max if smaller). Apply
    // small inward radial jitter for organic feel — bounded so L2 still
    // satisfies pairwise.
    const D_max_r = Math.min(D_max_for(r), D_outer);
    const D_min_r = D_min_for(r);
    const D_anchor = Math.max(D_min_r, D_max_r);
    const D_jitterRange = Math.max(0, (D_anchor - D_min_r) * 0.4);
    const D_jitter = (rng() - 0.5) * D_jitterRange;
    const D_i = Math.max(D_min_r, Math.min(D_max_r, D_anchor + D_jitter));
    positions.push({
      x: D_i * Math.cos(angle),
      y: D_i * Math.sin(angle),
      r,
    });
  }

  // ── Step 3: light relaxation to absorb any jitter-induced violations ──
  // Constraints are already satisfied by construction (radii capped at
  // r_max, D in [D_min, D_max]); relaxation only fixes edge cases like
  // two L2s with very different sizes whose jitter brought them closer
  // than the strict pairwise minimum.
  const ITER = 30;
  for (let iter = 0; iter < ITER; iter++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = positions[i];
        const b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = a.r * o + b.r * o + L2_GAP_COAST;
        if (d < minD && d > 0.001) {
          const overlap = minD - d;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
      }
    }
    for (const p of positions) {
      const d = Math.hypot(p.x, p.y);
      const maxD = L - p.r * o;
      if (d > maxD && d > 0.001) {
        p.x = (p.x / d) * maxD;
        p.y = (p.y / d) * maxD;
      }
    }
  }

  return positions.map((p) => ({ dx: p.x, dy: p.y, r: p.r }));
}

/**
 * Place a list of cards as deterministic dots inside a circular region.
 * Sunflower / golden-angle spacing, deterministic per card_id.
 *
 * `avoidTopFrac` (0..1): if >0, reserve the top portion of the circle for
 * a label by biasing the y of placed cards downward.
 */
function placeCardsInCircle(
  cards: MapCard[],
  cx: number,
  cy: number,
  rMax: number,
  avoidTopFrac = 0,
): SettlementLayout[] {
  if (cards.length === 0) return [];

  // Sort by card_id for stable deterministic order (source_count dropped — v1 always 1).
  const sorted = [...cards].sort((a, b) =>
    (a.card_id || "").localeCompare(b.card_id || ""),
  );

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const out: SettlementLayout[] = [];

  sorted.forEach((c, idx) => {
    const seed = mulberry32(hashSeed(`pos-${c.card_id}`));
    const j = seed();
    // Sunflower r: r ∝ sqrt(idx) — distributes dots evenly by area.
    const t = (idx + 0.5) / sorted.length;
    let rFrac = Math.sqrt(t) * 0.95;
    rFrac = 0.18 + rFrac * 0.7 + (j - 0.5) * 0.06;
    const r = rMax * rFrac;
    const theta = idx * goldenAngle + (seed() - 0.5) * 0.4;

    let x = cx + r * Math.cos(theta);
    let y = cy + r * Math.sin(theta);

    // If reserving top band for label, push any dot in the top band downward.
    if (avoidTopFrac > 0) {
      const topBoundary = cy - rMax * (1 - avoidTopFrac);
      if (y < topBoundary) {
        y = topBoundary + (topBoundary - y) * 0.5;
      }
    }

    // source_count is always 1 in v1 (formerly derived from aggregate cards).
    const hot = false;
    // Visual radius driven by **reading_minutes** (server-computed) when available;
    // falls back to a uniform default radius otherwise.
    // Tuned for typical 1–15 min range; clamped to [2.7, 9] px.
    const mins = c.reading_minutes ?? null;
    const visualR = mins != null
      ? Math.min(9, Math.max(2.7, 2.0 + mins * 0.5))
      : 4.5;

    out.push({
      card_id: c.card_id!,
      topic_id: c.topic?.id ?? "",
      x,
      y,
      radius: visualR,
      hot,
    });
  });

  return out;
}

/**
 * Pack N L1 continents into the canvas with seeded randomness, returning
 * each continent's slot {x, y, radius}.
 *
 * Layout philosophy (set by user feedback):
 *   - Continents distribute along an irregular *central curve* across
 *     the canvas (left to right) — gives the overall map a long rectangular
 *     shape rather than a square cluster.
 *   - L1s are split above / below the curve in a roughly balanced way
 *     (上下对称分布) — biggest sits ON the curve, the rest alternate sides.
 *   - The central curve is itself jittered (3 superposed sine waves) so
 *     the row reads as organic / hand-drawn rather than a straight line.
 *
 * Algorithm:
 *   1. Compute each L1's target radius from card count (sqrt-scaled, clamped).
 *   2. Generate a central curve y = curveY(x) from 3 seeded sine waves.
 *   3. Seed initial positions: each L1 takes a stratified x-slot along the
 *      width of the canvas; biggest sits on the curve, others alternate
 *      above/below with random offset magnitude.
 *   4. Relax for K iterations: pairwise repulsion + boundary clamp +
 *      forbidden-zone push-out + a soft "curve attraction" that pulls each
 *      L1 toward its target offset from the curve (prevents the relaxation
 *      from collapsing into a square cluster).
 *
 * Determinism: seed is based on DSL big_domain ids — same tab → same layout,
 * different tabs → visibly different layouts.
 */
function packL1ContinentsByRadii(
  radii: number[],
  canvasW: number,
  canvasH: number,
  seed: string,
): Array<{ x: number; y: number; radius: number }> {
  const N = radii.length;
  if (N === 0) return [];

  const rng = mulberry32(hashSeed(seed));

  // ── Step 2: central curve (3 superposed sine waves for irregularity) ──
  const freq1 = ((2 * Math.PI) / canvasW) * (1.2 + rng() * 0.6);
  const freq2 = ((2 * Math.PI) / canvasW) * (2.6 + rng() * 0.8);
  const freq3 = ((2 * Math.PI) / canvasW) * (4.5 + rng() * 1.2);
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const phase3 = rng() * Math.PI * 2;
  const amp1 = canvasH * 0.058;
  const amp2 = canvasH * 0.038;
  const amp3 = canvasH * 0.022;
  const curveY = (x: number) =>
    canvasH / 2 +
    amp1 * Math.sin(freq1 * x + phase1) +
    amp2 * Math.sin(freq2 * x + phase2) +
    amp3 * Math.sin(freq3 * x + phase3);

  // Forbidden-zone clearance helper.
  // Effective collision radius = wobble peak + the visual gap we want to
  // keep between the coastline and any UI element.
  const zoneClearance = (x: number, y: number, r: number) => {
    let worstOverlap = 0;
    let worstNx = 0;
    let worstNy = 0;
    const effectiveR = r * L1_OUTER + VISUAL_GAP_COAST;
    for (const z of FORBIDDEN_ZONES) {
      const closestX = Math.max(z.x1, Math.min(x, z.x2));
      const closestY = Math.max(z.y1, Math.min(y, z.y2));
      const dx = x - closestX;
      const dy = y - closestY;
      const d = Math.hypot(dx, dy);
      const minD = effectiveR + z.pad;
      if (d < minD) {
        const overlap = minD - d;
        if (overlap > worstOverlap) {
          worstOverlap = overlap;
          if (d < 0.001) {
            const cx = (z.x1 + z.x2) / 2;
            const cy = (z.y1 + z.y2) / 2;
            const px = x - cx;
            const py = y - cy;
            const pd = Math.hypot(px, py) || 1;
            worstNx = px / pd;
            worstNy = py / pd;
          } else {
            worstNx = dx / d;
            worstNy = dy / d;
          }
        }
      }
    }
    return { overlap: worstOverlap, nx: worstNx, ny: worstNy };
  };

  // ── Step 3: seeded initial positions along the curve ──
  // Stratify x: each L1 gets a slot of width canvasW/N along the row, with
  // a random jitter inside its slot. Sides alternate so the row visually
  // balances above/below the curve.
  // Side assignment: biggest L1 (index 0) sits on the curve (side=0); others
  // alternate -1 (above) and +1 (below) — but we *shuffle* the side
  // assignment slightly so it doesn't always go above-below-above.
  const positions: Array<{
    x: number;
    y: number;
    r: number;
    targetY: number; // soft attractor
    side: number;
  }> = [];
  // The order in which x-slots are assigned to L1s — slightly shuffled so
  // largest isn't always at the same position.
  const slotPerm: number[] = Array.from({ length: N }, (_, i) => i);
  // Shuffle (Fisher-Yates with seeded rng) but keep the largest near a
  // visually prominent position — slot index = floor(N/2) ish, but with
  // some randomness so it's not always dead-center.
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [slotPerm[i], slotPerm[j]] = [slotPerm[j], slotPerm[i]];
  }
  // Place biggest near the middle slot (index ~ N/2 in slotPerm) for
  // visual anchoring.
  const midPos = Math.floor(N / 2);
  const biggestSlotIdx = slotPerm.indexOf(midPos);
  if (biggestSlotIdx > 0) {
    [slotPerm[0], slotPerm[biggestSlotIdx]] = [
      slotPerm[biggestSlotIdx],
      slotPerm[0],
    ];
  }

  // Side assignment: alternate but with random extra offset magnitude.
  for (let i = 0; i < N; i++) {
    const r = radii[i];
    const slot = slotPerm[i];
    // x in this slot: center of slot + random jitter within slot bounds
    const slotW = canvasW / N;
    const slotMid = slotW * (slot + 0.5);
    const xJitter = (rng() - 0.5) * slotW * 0.5;
    let x = slotMid + xJitter;
    x = Math.max(r + 16, Math.min(canvasW - r - 16, x));

    // Side: biggest on curve, others alternate. Use a stable mapping based
    // on i so the relaxation converges.
    let side: number;
    if (i === 0) side = 0;
    else if (i % 2 === 1) side = -1;
    else side = 1;

    // Target y: curve + offset proportional to L1 radius
    const offsetMag = side === 0 ? 0 : r * 0.85 + 30 + rng() * 40;
    let targetY = curveY(x) + side * offsetMag;
    targetY = Math.max(r + 24, Math.min(canvasH - r - 16, targetY));

    positions.push({ x, y: targetY, r, targetY, side });
  }

  // ── Step 4: two-phase relaxation ──
  // Phase 1 (first half): curve attraction + repulsion together — establishes
  //   the overall row-of-continents shape.
  // Phase 2 (second half): pure repulsion + boundary — guarantees no overlap
  //   by removing the pull forces that fight against repulsion.
  const ITER = 800;
  const PHASE1_ITERS = 250;
  // Pair distance must satisfy: d ≥ a.r·L1_OUTER + b.r·L1_OUTER + GAP.
  // The GAP depends on the relative position of the two continents:
  //   - if the lower one's label could collide with the upper one's coastline
  //     (i.e. they're vertically stacked), GAP = full label-height-above-coast;
  //   - otherwise (mostly horizontal arrangement), GAP = just the coastline gap.
  // Computed per-pair so horizontal neighbors pack tightly while vertical
  // neighbors still give labels room to breathe.
  const L1_LABEL_HEIGHT_ABOVE =
    L1_LABEL_GAP + L1_FONT.size * 0.78 + L1_FONT.haloStroke / 2;
  const pairGap = (dx: number, dy: number) => {
    // Lower neighbor's label is above its coastline; only matters when dy > 0
    // (b below a) AND vertical separation dominates over horizontal.
    const verticalness = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) + 0.001);
    return (
      VISUAL_GAP_COAST +
      L1_LABEL_HEIGHT_ABOVE * Math.max(0, verticalness - 0.4)
    );
  };
  // Curve attraction strength: pulls y toward targetY each step. Kept
  // gentle so pairwise repulsion (which strictly enforces no-overlap) wins
  // when the two forces conflict.
  const CURVE_PULL = 0.025;
  // Horizontal spread: gentle force keeping x near initial slot center.
  const X_PULL = 0.015;
  for (let iter = 0; iter < ITER; iter++) {
    // Pairwise repulsion — uses outer-wobble factor so two squiggly
    // coastlines never visually touch. Gap per pair depends on relative
    // position (see `pairGap`).
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = positions[i];
        const b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const minD = a.r * L1_OUTER + b.r * L1_OUTER + pairGap(dx, dy);
        if (d < minD) {
          if (d < 0.001) {
            const ang = rng() * Math.PI * 2;
            const nudge = minD * 0.5;
            a.x -= Math.cos(ang) * nudge;
            a.y -= Math.sin(ang) * nudge;
            b.x += Math.cos(ang) * nudge;
            b.y += Math.sin(ang) * nudge;
            continue;
          }
          const overlap = minD - d;
          const nx = dx / d;
          const ny = dy / d;
          // Strong repulsion (>0.5) so each pass closes overlap quickly.
          // Combined with weakened curve/x pulls, repulsion always wins on
          // contact, leaving zero overlap after enough iterations.
          const k = 0.65;
          a.x -= nx * overlap * k;
          a.y -= ny * overlap * k;
          b.x += nx * overlap * k;
          b.y += ny * overlap * k;
        }
      }
    }

    // Curve / x pulls only run in Phase 1. Phase 2 is pure repulsion +
    // boundary so any remaining overlap from Phase 1 gets resolved.
    if (iter < PHASE1_ITERS) {
      // Curve attraction (vertical pull toward targetY)
      for (const p of positions) {
        const dy = p.targetY - p.y;
        p.y += dy * CURVE_PULL;
      }
      // Horizontal pull toward initial x slot center (prevents bunching)
      for (let i = 0; i < N; i++) {
        const p = positions[i];
        const slot = slotPerm[i];
        const slotMid = (canvasW / N) * (slot + 0.5);
        const dx = slotMid - p.x;
        p.x += dx * (i === 0 ? X_PULL * 0.4 : X_PULL);
      }
    }

    // Canvas boundary clamp.
    // Top headroom = wobble + label_above + tab-bar-safety (label must clear
    // the fixed DOM tab bar even at smallest viewport scale ~50% which
    // doubles its viewBox-y extent to ~80px).
    // Sides/bottom = wobble + small canvas-edge padding.
    const TAB_BAR_VIEWBOX_MAX_Y = 80;
    for (const p of positions) {
      const TOP_HEADROOM = p.r * L1_WOBBLE + L1_LABEL_HEIGHT_ABOVE + TAB_BAR_VIEWBOX_MAX_Y;
      const SIDE_PAD = VISUAL_GAP_COAST + p.r * L1_WOBBLE;
      const BOTTOM_PAD = VISUAL_GAP_COAST + p.r * L1_WOBBLE;
      if (p.x - p.r < SIDE_PAD) p.x = p.r + SIDE_PAD;
      if (p.x + p.r > canvasW - SIDE_PAD) p.x = canvasW - p.r - SIDE_PAD;
      if (p.y - p.r - TOP_HEADROOM < 0) p.y = p.r + TOP_HEADROOM;
      if (p.y + p.r > canvasH - BOTTOM_PAD) p.y = canvasH - p.r - BOTTOM_PAD;
    }

    // Forbidden zone push-out
    for (const p of positions) {
      const z = zoneClearance(p.x, p.y, p.r);
      if (z.overlap > 0) {
        p.x += z.nx * z.overlap * 0.85;
        p.y += z.ny * z.overlap * 0.85;
      }
    }
  }

  return positions.map((p) => ({ x: p.x, y: p.y, radius: p.r }));
}

// ═══════════════ Voyage path ═══════════════
//
// Generate the thick dashed "航线" — a hand-drawn-ish curve that crosses
// the canvas left → right while threading through the gaps between L1
// continents. Algorithm: at each sampled x, find the y intervals that
// don't intersect any L1 (with safety clearance), then pick the y in
// those intervals closest to a smooth interpolation between start_y and
// end_y. Build a smooth bezier through the resulting waypoints.

/** Thick dashed line stroke half-width — used for L1 clearance. */
const VOYAGE_HALF_WIDTH = 4;
/** Number of sample x positions across canvas. More = smoother. */
const VOYAGE_SAMPLES = 90;
/** Per-sample hand-drawn jitter (px). Stays inside the legal y interval. */
const VOYAGE_JITTER = 8;

function computeVoyagePath(
  _continents: ContinentLayout[],
  canvas: { width: number; height: number },
  startY: number,
  endY: number,
  seed: string,
): { path: string } {
  const rng = mulberry32(hashSeed(seed));

  // ────────── Old-map voyage path ──────────
  // Hand-drawn-style trail: linear interpolation start → end, modulated by
  // THREE superposed sine waves of different frequencies (low + mid + high)
  // for organic non-repeating shape. Plus per-sample jitter for ink wobble.
  // Continents paint over this layer in MapSvg — so we don't avoid
  // L1s. The visible bits in the gaps trace the journey.

  const W = canvas.width;
  // 3 octaves of sine for natural variation. Frequencies in cycles per canvas.
  const f1 = ((2 * Math.PI) / W) * (1.4 + rng() * 0.8);
  const f2 = ((2 * Math.PI) / W) * (3.1 + rng() * 1.2);
  const f3 = ((2 * Math.PI) / W) * (6.5 + rng() * 1.8);
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const p3 = rng() * Math.PI * 2;
  // Amplitudes — biggest swing on low freq, smaller on higher.
  const A1 = Math.min(canvas.height * 0.13, 95);
  const A2 = canvas.height * 0.05;
  const A3 = canvas.height * 0.025;

  const waypoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= VOYAGE_SAMPLES; i++) {
    const t = i / VOYAGE_SAMPLES;
    const x = t * W;
    // Linear baseline start → end, attenuated near endpoints so the wave
    // calms down (forces start/end to land near startY/endY).
    const lineY = startY * (1 - t) + endY * t;
    // Edge attenuation: 0 at endpoints, 1 in the middle (sin envelope).
    const edge = Math.sin(Math.PI * t);
    const wave =
      edge *
      (A1 * Math.sin(f1 * x + p1) +
        A2 * Math.sin(f2 * x + p2) +
        A3 * Math.sin(f3 * x + p3));
    // Larger jitter near middle of journey, near zero at edges.
    const jit = edge * (rng() - 0.5) * VOYAGE_JITTER * 2;
    let y = lineY + wave + jit;
    // Soft canvas clamp.
    y = Math.max(VOYAGE_HALF_WIDTH + 4, Math.min(canvas.height - VOYAGE_HALF_WIDTH - 4, y));
    waypoints.push({ x, y });
  }

  // Force exact endpoints (canvas edges, controllable y).
  waypoints[0] = { x: 0, y: startY };
  waypoints[waypoints.length - 1] = { x: canvas.width, y: endY };

  // Build smooth bezier path. Pattern: M start, then quadratic through
  // each interior waypoint with midpoints as endpoints (same trick as
  // generateCoastline for tangent-continuous curves).
  if (waypoints.length === 0) return { path: "" };
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  let d = `M ${waypoints[0].x.toFixed(1)},${waypoints[0].y.toFixed(1)}`;
  for (let i = 1; i < waypoints.length - 1; i++) {
    const v = waypoints[i];
    const next = waypoints[i + 1];
    const m = mid(v, next);
    d += ` Q ${v.x.toFixed(1)},${v.y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`;
  }
  // Final segment to the endpoint.
  const last = waypoints[waypoints.length - 1];
  d += ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;
  return { path: d };
}
