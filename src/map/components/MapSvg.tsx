// Map — main SVG cartographic canvas.

import { useState } from "react";
import {
  GRATICULE,
  SEA_LABELS,
  SEA_MONSTERS,
  SEA_MONSTER_PATH,
  SEA_SWIRLS,
} from "../lib/decoration";
import {
  pickShape,
  baseRadius,
  ringCount,
  sourceCount,
  starPath,
  trianglePath,
} from "../lib/settlement-style";
import type {
  MapCard,
  MapDSL,
  MapLayout,
  ContinentLayout,
  RouteLayout,
  SettlementLayout,
  TopicRegion,
} from "../types";

/**
 * Route focus is **entity-based**, not pair-based.
 *
 * When user hovers/clicks a single dashed line, the focus selects the entity
 * labeled on that line; all cards sharing that entity light up, and all
 * routes that involve that entity highlight together. The original triggering
 * pair (fromId/toId) is recorded so we can still show two endpoint popovers.
 */
export type RouteFocus = {
  entity: string;
  /** The pair whose line was hovered/clicked — used to position 2 popovers. */
  fromId: string;
  toId: string;
  pinned: boolean;
};

type Props = {
  dsl: MapDSL;
  cards: MapCard[];
  layout: MapLayout;
  isCardRead: (card_id: string) => boolean;
  onSettlementHover: (card_id: string | null, x: number, y: number) => void;
  onSettlementClick: (card_id: string) => void;
  routeFocus: RouteFocus | null;
  routesVisible: boolean;
  /** Entities the user has hidden via the entity list — their routes skip
   *  rendering entirely. */
  hiddenEntities: Set<string>;
  onRouteHover: (focus: RouteFocus | null) => void;
  onRouteClick: (focus: RouteFocus) => void;
  onCanvasBlankClick: () => void;
  /** Set of card_ids that the user has favorited. */
  favoritedIds?: Set<string>;
};

function routeRenderKey(route: RouteLayout): string {
  return `${route.from_card_id}-${route.to_card_id}-${route.shared_entities.join("|")}`;
}

export function MapSvg({
  dsl,
  cards,
  layout,
  isCardRead,
  onSettlementHover,
  onSettlementClick,
  routeFocus,
  routesVisible,
  hiddenEntities,
  onRouteHover,
  onRouteClick,
  onCanvasBlankClick,
  favoritedIds,
}: Props) {
  const [hoveredBigDomain, setHoveredBigDomain] = useState<string | null>(null);
  const hasFocus = routeFocus != null || hoveredBigDomain != null;

  // Entity-based focus expansion: collect ALL cards that share the focused
  // entity, and ALL routes whose shared_entities list contains it. So hovering
  // any line of an entity lights up the whole constellation.
  const focusedCardIds = new Set<string>();
  const focusedRouteKeys = new Set<string>();
  if (routeFocus) {
    for (const c of cards) {
      if (c.card_id && c.entities?.includes(routeFocus.entity)) {
        focusedCardIds.add(c.card_id);
      }
    }
    for (const r of layout.routes) {
      if (r.shared_entities.includes(routeFocus.entity)) {
        focusedRouteKeys.add(routeRenderKey(r));
      }
    }
  }

  const cardById = new Map<string, MapCard>();
  for (const c of cards) if (c.card_id) cardById.set(c.card_id, c);

  return (
    <svg
      viewBox={`0 0 ${layout.canvas.width} ${layout.canvas.height}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={(e) => {
        // Click "elsewhere" → clear pin. Settlements and routes both call
        // e.stopPropagation() in their own onClick, so this only fires for
        // clicks on truly inert SVG elements (sea rect, graticule, coastline,
        // labels). Don't gate on `e.target === e.currentTarget`: that broke
        // because clicks land on child <rect>/<path>, never the SVG root
        // itself.
        e.stopPropagation();
        onCanvasBlankClick();
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <defs>
        <pattern
          id="map-ocean-waves"
          x={0}
          y={0}
          width={60}
          height={20}
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0,10 q15,-6 30,0 t30,0"
            stroke="var(--map-wave)"
            strokeWidth={0.4}
            fill="none"
            opacity={0.35}
          />
        </pattern>
      </defs>

      {/* Sea base = wave pattern, then translucent paper overlay so coastlines pop */}
      <rect
        width={layout.canvas.width}
        height={layout.canvas.height}
        fill="url(#map-ocean-waves)"
      />
      <rect
        width={layout.canvas.width}
        height={layout.canvas.height}
        fill="var(--map-paper)"
        opacity={0.86}
      />

      {/* Graticule */}
      <g stroke="var(--map-graticule)" strokeWidth={0.3} opacity={0.18}>
        {GRATICULE.horizontals.map((y) => (
          <line key={`h-${y}`} x1={0} y1={y} x2={layout.canvas.width} y2={y} />
        ))}
        {GRATICULE.verticals.map((x) => (
          <line key={`v-${x}`} x1={x} y1={0} x2={x} y2={layout.canvas.height} />
        ))}
      </g>

      {/* Sea swirls */}
      <g
        stroke="var(--map-ink-2)"
        strokeWidth={0.4}
        fill="none"
        opacity={0.35}
      >
        {SEA_SWIRLS.flatMap((s) =>
          s.radii.map((r, i) => (
            <circle key={`${s.cx}-${s.cy}-${i}`} cx={s.cx} cy={s.cy} r={r} />
          )),
        )}
      </g>

      {/* Sea labels (Terra Incognita / Mare Tenebrarum) */}
      {SEA_LABELS.map((label) => (
        <g key={`sea-${label.x}-${label.y}`}>
          <text
            x={label.x}
            y={label.y}
            textAnchor="middle"
            fontFamily="var(--map-display)"
            fontStyle="italic"
            fontSize={label.size ?? 18}
            fill="var(--map-ink-2)"
            opacity={0.42}
            letterSpacing="0.18em"
          >
            {label.text}
          </text>
          {label.italic && (
            <text
              x={label.x}
              y={label.y + 20}
              textAnchor="middle"
              fontFamily="var(--map-serif)"
              fontStyle="italic"
              fontSize={11}
              fill="var(--map-ink-2)"
              opacity={0.65}
            >
              {label.italic}
            </text>
          )}
        </g>
      ))}

      {/* Sea monsters */}
      {SEA_MONSTERS.map((m, i) => (
        <g
          key={`mon-${i}`}
          transform={`translate(${m.x},${m.y}) scale(${m.scale})`}
          fill="var(--map-ink-2)"
          opacity={0.35}
        >
          <path d={SEA_MONSTER_PATH} />
          <circle cx={22} cy={-3} r={1.5} />
        </g>
      ))}

      {/* Voyage path — drawn BEFORE continents so each continent's opaque
          fill paints over the path where it would cross. The stack of
          three strokes mimics ink-on-vellum: a pale wide wash, a darker
          inner ink, and a thin solid centerline that catches in the
          dashed segments. Continents in front make it look like the
          journey "threads" through the islands. */}
      {layout.voyage_path && (
        <g
          pointerEvents="none"
          opacity={hasFocus ? 0.18 : 1}
          style={{ transition: "opacity 180ms" }}
        >
          {/* Wide soft wash — the ink "halo" / wake */}
          <path
            d={layout.voyage_path}
            fill="none"
            stroke="var(--map-voyage-halo)"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Inner shadow — slight darker tone */}
          <path
            d={layout.voyage_path}
            fill="none"
            stroke="var(--map-voyage-shadow)"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Main dashed line — the "voyage stamps" */}
          <path
            d={layout.voyage_path}
            fill="none"
            stroke="var(--map-voyage-main)"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="14 10"
            opacity={0.95}
          />
          {/* Thin solid centerline accent — connects the dashes faintly */}
          <path
            d={layout.voyage_path}
            fill="none"
            stroke="var(--map-crimson)"
            strokeWidth={0.8}
            strokeLinecap="round"
            opacity={0.45}
          />
        </g>
      )}

      {/* Continents (coastlines, sub-regions, labels — but NOT settlements
          which render in a top-level group below). When a route is focused,
          all non-endpoint continents dim so the highlighted constellation
          pops forward. */}
      {layout.continents.map((cont) => {
        const involvesFocus =
          routeFocus != null &&
          cont.cards.some((s) => focusedCardIds.has(s.card_id));
        const dimByRoute = routeFocus != null && !involvesFocus;
        const dimByHover =
          hoveredBigDomain != null && hoveredBigDomain !== cont.big_domain_id;
        return (
          <Continent
            key={cont.big_domain_id}
            continent={cont}
            dsl={dsl}
            dimmed={dimByHover || dimByRoute}
            onContinentEnter={() => setHoveredBigDomain(cont.big_domain_id)}
            onContinentLeave={() => setHoveredBigDomain(null)}
          />
        );
      })}

      {/* Voyage endpoints — start = port-of-departure circle with cross
          (compass mark); end = X-marks-the-spot on red diamond. Drawn
          AFTER continents so they're always on top. */}
      {layout.voyage_path && (
        <g pointerEvents="none">
          {/* Start: vellum disc + crosshair, like a port-of-departure stamp */}
          <g transform={`translate(${layout.voyage_start.x}, ${layout.voyage_start.y})`}>
            <circle
              r={9}
              fill="var(--map-vellum)"
              stroke="var(--map-rust)"
              strokeWidth={2}
            />
            <circle
              r={4}
              fill="none"
              stroke="var(--map-rust)"
              strokeWidth={1.5}
            />
            <line x1={-9} y1={0} x2={9} y2={0} stroke="var(--map-rust)" strokeWidth={1} />
            <line x1={0} y1={-9} x2={0} y2={9} stroke="var(--map-rust)" strokeWidth={1} />
          </g>
          {/* End: bold rust dot + an X-cross ("X marks the spot") */}
          <g transform={`translate(${layout.voyage_end.x}, ${layout.voyage_end.y})`}>
            <circle
              r={9}
              fill="var(--map-rust)"
              stroke="var(--map-ink)"
              strokeWidth={1.5}
            />
            <line
              x1={-5} y1={-5} x2={5} y2={5}
              stroke="var(--map-vellum)"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line
              x1={-5} y1={5} x2={5} y2={-5}
              stroke="var(--map-vellum)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>
        </g>
      )}

      {/* Trade routes — drawn on top of continent fills, but BELOW the
          settlement layer so dots win mouse events when a route crosses them.
          Hidden entirely when user toggles routes off; per-entity hidden
          routes are filtered out below. */}
      <g style={{ display: routesVisible ? "block" : "none" }}>
        {layout.routes
          .map((r, idx) => {
          const visibleEntities = r.shared_entities.filter((e) => !hiddenEntities.has(e));
          if (visibleEntities.length === 0) return null;
          const routeForRender = visibleEntities.length === r.shared_entities.length
            ? r
            : { ...r, shared_entities: visibleEntities };
          const focusKey = routeRenderKey(r);
          const key = `${focusKey}-${idx}`;
          const isFocused = focusedRouteKeys.has(focusKey);
          // The triggering pair (originally hovered/clicked) gets the strongest
          // visual emphasis; sibling routes of the same entity get a softer
          // halo highlight.
          const isTrigger =
            routeFocus != null &&
            routeFocus.fromId === r.from_card_id &&
            routeFocus.toId === r.to_card_id &&
            r.shared_entities.includes(routeFocus.entity);
          // Each route's primary entity = the one shown as label. Use it as
          // the "entity to focus on" when hovered.
          const primaryEntity = visibleEntities[0] ?? "";
          return (
            <TradeRoute
              key={key}
              route={routeForRender}
              onEnter={() => {
                // While pinned: ignore hover so the pinned focus stays.
                if (routeFocus?.pinned) return;
                if (!primaryEntity) return;
                onRouteHover({
                  entity: primaryEntity,
                  fromId: r.from_card_id,
                  toId: r.to_card_id,
                  pinned: false,
                });
              }}
              onLeave={() => {
                if (routeFocus?.pinned) return;
                onRouteHover(null);
              }}
              onClick={() => {
                if (!primaryEntity) return;
                onRouteClick({
                  entity: primaryEntity,
                  fromId: r.from_card_id,
                  toId: r.to_card_id,
                  pinned: true,
                });
              }}
              highlighted={isFocused}
              pinned={isFocused && routeFocus!.pinned}
              isTrigger={isTrigger}
              dimmed={routeFocus != null && !isFocused}
            />
          );
        })}
      </g>

      {/* Settlements — rendered at the SVG top so dots reliably capture
          hover/click even when route lines cross over them. */}
      <g>
        {layout.continents.flatMap((cont) =>
          cont.cards.map((s) => {
            const focused = focusedCardIds.has(s.card_id);
            const card = cardById.get(s.card_id);
            const isFavorited = card?.card_id
              ? (favoritedIds?.has(card.card_id) ?? false)
              : false;
            return (
              <Settlement
                key={s.card_id}
                settlement={s}
                card={card ?? null}
                isRead={isCardRead(s.card_id)}
                isFocused={focused}
                isFavorited={isFavorited}
                dimmed={routeFocus != null && !focused}
                onHover={onSettlementHover}
                onClick={onSettlementClick}
              />
            );
          }),
        )}
      </g>
    </svg>
  );
}

function Continent({
  continent,
  dsl,
  dimmed,
  onContinentEnter,
  onContinentLeave,
}: {
  continent: ContinentLayout;
  dsl: MapDSL;
  dimmed: boolean;
  onContinentEnter: () => void;
  onContinentLeave: () => void;
}) {
  const bd = dsl.domains.find((b) => b.id === continent.big_domain_id);
  const latin = bd?.latin_label ?? bd?.label.toUpperCase() ?? "";

  return (
    <g
      onMouseEnter={onContinentEnter}
      onMouseLeave={onContinentLeave}
      style={{ cursor: "default", opacity: dimmed ? 0.3 : 1, transition: "opacity 180ms" }}
    >
      {/* Coastline shadow (water blur halo) */}
      <path
        d={continent.shadow_path}
        fill="none"
        stroke="var(--map-coast-shadow)"
        strokeWidth={5}
      />
      {/* Continent fill */}
      <path
        d={continent.coastline_path}
        fill={continent.sparse ? "var(--map-paper)" : "var(--map-paper-2)"}
        stroke="var(--map-ink-2)"
        strokeWidth={continent.sparse ? 0.8 : 1.2}
        strokeDasharray={continent.sparse ? "4 3" : undefined}
        opacity={continent.sparse ? 0.85 : 1}
      />

      {/* Big-domain label — stroke-then-fill halo so the title pops on
          any background (paper, vellum, or sea swirls) without needing
          a solid rect behind it. Strokes are vellum-colored so they
          read as "ink-on-parchment". */}
      <text
        x={continent.label_x}
        y={continent.label_y}
        textAnchor="middle"
        fontFamily="var(--map-display)"
        fontSize={continent.sparse ? 13 : 17}
        fontWeight={600}
        letterSpacing="0.32em"
        paintOrder="stroke"
        stroke="var(--map-vellum)"
        strokeWidth={4.5}
        strokeLinejoin="round"
        fill="var(--map-ink)"
        opacity={continent.sparse ? 0.65 : 1}
      >
        {latin}
      </text>

      {/* L2 mini-continents — irregular sub-shapes nested inside the L1.
          Each L2's coastline is a smaller copy of the L1 style; cards
          belonging to the L2 sit inside its boundary. Render coastlines
          first, then labels, so labels sit on top. */}
      {continent.topic_regions.map((region: TopicRegion) => (
        <path
          key={`coast-${region.topic_id}`}
          d={region.coastline_path}
          fill="var(--map-region-fill)"
          stroke="var(--map-ink-2)"
          strokeWidth={0.7}
          strokeDasharray="3 2"
          opacity={0.85}
        />
      ))}

      {/* L2 labels — italic Chinese, just above each L2 region.
          Same stroke-then-fill halo as L1 so the label doesn't fade
          into the dotted L2 coastline or compete with cards/dots. */}
      {continent.topic_regions.map((region: TopicRegion) => {
        const topicInfo = dsl.topics.find(
          (x) => x.id === region.topic_id,
        );
        const fontSize = Math.max(11, Math.min(14, region.radius * 0.28));
        return (
          <text
            key={`label-${region.topic_id}`}
            x={region.label_x}
            y={region.label_y}
            textAnchor="middle"
            fontFamily="var(--map-serif)"
            fontStyle="italic"
            fontSize={fontSize}
            fontWeight={600}
            paintOrder="stroke"
            stroke="var(--map-vellum)"
            strokeWidth={3}
            strokeLinejoin="round"
            fill="var(--map-ink)"
          >
            {topicInfo?.label ?? ""}
          </text>
        );
      })}

      {/* Settlements are rendered in a top-level group at the END of the
          SVG (see the <g> after routes in AtlasCanvas), so they always sit
          above routes in z-order — small dots can be hovered/clicked even
          when a dashed route line passes near or through them. */}
    </g>
  );
}

function Settlement({
  settlement,
  card,
  isRead,
  isFocused,
  isFavorited,
  dimmed,
  onHover,
  onClick,
}: {
  settlement: SettlementLayout;
  card: MapCard | null;
  isRead: boolean;
  isFocused: boolean;
  isFavorited: boolean;
  /** True when a route focus is active and this settlement is not in it. */
  dimmed: boolean;
  onHover: (card_id: string | null, x: number, y: number) => void;
  onClick: (card_id: string) => void;
}) {
  // Derive shape + radius from the card (fall back to settlement.radius if no card)
  const shape = card ? pickShape(card, isFavorited) : "circle-rust";
  const r = card ? baseRadius(card.reading_minutes) : settlement.radius;
  const rings = card ? ringCount(sourceCount(card)) : 0;

  // Priority: dimmed (entity not in focus) → focused → read-dim → normal
  const opacity = dimmed ? 0.15 : isFocused ? 1 : isRead ? 0.35 : 1;

  return (
    <g
      transform={`translate(${settlement.x}, ${settlement.y})`}
      onMouseEnter={() => onHover(settlement.card_id, settlement.x, settlement.y)}
      onMouseLeave={() => onHover(null, 0, 0)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(settlement.card_id);
      }}
      style={{
        cursor: "pointer",
        opacity,
        transition: "opacity 180ms",
      }}
    >
      {/* Outer halo when this settlement is a route endpoint in focus */}
      {isFocused && (
        <>
          <circle
            cx={0}
            cy={0}
            r={r + 8}
            fill="none"
            stroke="var(--map-crimson)"
            strokeWidth={1.2}
            opacity={0.55}
            strokeDasharray="2 2"
          />
          <circle
            cx={0}
            cy={0}
            r={r + 4}
            fill="none"
            stroke="var(--map-crimson)"
            strokeWidth={1.4}
            opacity={0.85}
          />
        </>
      )}

      {/* Aggregate rings (solid concentric circles, rendered before main shape) */}
      {Array.from({ length: rings }).map((_, i) => (
        <circle
          key={`ring-${i}`}
          cx={0}
          cy={0}
          r={r + 3 + i * 3}
          fill="none"
          stroke="var(--map-ink-2)"
          strokeWidth={0.9}
          opacity={0.86}
        />
      ))}

      {/* Main shape based on priority */}
      {shape === "star" && (
        <path
          d={starPath(r)}
          fill="var(--map-gold)"
          stroke="var(--map-gold)"
          strokeWidth={1}
          style={{ transition: "all 180ms" }}
        />
      )}
      {shape === "triangle" && (
        <path
          d={trianglePath(r)}
          fill="none"
          stroke="var(--map-ink-2)"
          strokeWidth={1.2}
          style={{ transition: "all 180ms" }}
        />
      )}
      {shape === "circle-rust" && (
        <circle
          cx={0}
          cy={0}
          r={r}
          fill="var(--map-rust)"
          stroke={isFocused ? "var(--map-crimson)" : "var(--map-ink)"}
          strokeWidth={isFocused ? 1.8 : isRead ? 0.6 : 1.4}
          style={{ transition: "all 180ms" }}
        />
      )}
      {shape === "circle-vellum" && (
        <circle
          cx={0}
          cy={0}
          r={r}
          fill="var(--map-vellum)"
          stroke={isFocused ? "var(--map-crimson)" : "var(--map-ink)"}
          strokeWidth={isFocused ? 1.8 : isRead ? 0.6 : 1.4}
          style={{ transition: "all 180ms" }}
        />
      )}

      {/* Invisible enlarged hit-area. Settlement dots render at 4-11px radius
          which is awkward to target precisely; a +5px transparent halo lets
          hover/click resolve to the dot rather than to a passing route line.
          Drawn last so it's the topmost element of this <g>. */}
      <circle
        cx={0}
        cy={0}
        r={r + 5}
        fill="transparent"
        stroke="transparent"
      />
    </g>
  );
}

function TradeRoute({
  route,
  onEnter,
  onLeave,
  onClick,
  highlighted,
  pinned,
  isTrigger,
  dimmed,
}: {
  route: RouteLayout;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  /** True when this route shares the focused entity. */
  highlighted: boolean;
  /** True when focus is pinned (clicked, persists past hover). */
  pinned: boolean;
  /** True when this is the route the user actually hovered/clicked. */
  isTrigger: boolean;
  /** True when a different entity is in focus — quiet this route to background. */
  dimmed: boolean;
}) {
  // Quadratic bezier midpoint for label placement.
  // Path format: "M ax,ay Q cx,cy bx,by"
  // At t=0.5: x = 0.25·ax + 0.5·cx + 0.25·bx (same for y)
  const m = route.path.match(
    /M\s*([\d.-]+),([\d.-]+)\s*Q\s*([\d.-]+),([\d.-]+)\s*([\d.-]+),([\d.-]+)/,
  );
  let labelX = 0;
  let labelY = 0;
  if (m) {
    const ax = parseFloat(m[1]);
    const ay = parseFloat(m[2]);
    const cx = parseFloat(m[3]);
    const cy = parseFloat(m[4]);
    const bx = parseFloat(m[5]);
    const by = parseFloat(m[6]);
    labelX = 0.25 * ax + 0.5 * cx + 0.25 * bx;
    labelY = 0.25 * ay + 0.5 * cy + 0.25 * by;
  }
  // Show the first (most distinctive) shared entity as the line label.
  const labelText = route.shared_entities[0] || "";
  // Approx text width for background pill (each Chinese char ~9px, latin ~6px).
  const charWidth = (s: string) =>
    [...s].reduce((sum, c) => sum + (/[一-鿿]/.test(c) ? 9 : 6), 0);
  const textW = charWidth(labelText) + 8;

  // Visual states (in priority order):
  //   - dimmed (some other entity is in focus)             → faintest
  //   - idle (no focus)                                    → light dashed
  //   - highlighted (entity sibling, not trigger)          → medium dashed
  //   - highlighted + pinned                               → solid (all entity routes)
  //   - highlighted + trigger                              → slightly bolder than siblings
  // When pinned, ALL routes sharing the focused entity become solid — not
  // just the originally clicked one. The trigger keeps a +0.4 stroke and
  // pill border so the user remembers which line they pinned from.
  const strokeWidth = pinned && isTrigger
    ? 1.9
    : pinned && highlighted
      ? 1.5
      : highlighted && isTrigger
        ? 1.4
        : highlighted
          ? 1.0
          : 0.7;
  const strokeDasharray = pinned && highlighted ? undefined : "2 4";
  const opacity = dimmed
    ? 0.08
    : pinned && isTrigger
      ? 0.98
      : pinned && highlighted
        ? 0.92
        : highlighted && isTrigger
          ? 0.9
          : highlighted
            ? 0.65
            : 0.45;
  const labelOpacity = dimmed ? 0.15 : pinned ? 1 : highlighted ? 1 : 0.8;
  const bgOpacity = dimmed ? 0.2 : pinned ? 1 : highlighted ? 0.95 : 0.75;
  const labelFontSize = (highlighted || pinned) && isTrigger ? 10 : 9;

  return (
    <g
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ cursor: "pointer" }}
    >
      {/* Invisible thin hit-area. 5px is wide enough to hover the dashed
          visible line (drawn at 0.7-1.9px) with a small slop, but narrow
          enough to NOT swallow nearby settlement dots (which are 4-7px in
          radius and rendered with their own hit-area). */}
      <path
        d={route.path}
        fill="none"
        stroke="transparent"
        strokeWidth={5}
      />
      <path
        d={route.path}
        fill="none"
        stroke="var(--map-crimson)"
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        opacity={opacity}
        style={{ transition: "stroke-width 150ms, opacity 150ms" }}
      />
      {labelText && (
        <g pointerEvents="none">
          {/* Vellum-tinted background pill for legibility against continents */}
          <rect
            x={labelX - textW / 2}
            y={labelY - 7}
            width={textW}
            height={13}
            fill="var(--map-vellum)"
            stroke={pinned ? "var(--map-crimson)" : "none"}
            strokeWidth={pinned ? 0.6 : 0}
            opacity={bgOpacity}
            rx={2}
          />
          <text
            x={labelX}
            y={labelY + 3}
            textAnchor="middle"
            fontFamily="var(--map-serif)"
            fontStyle="italic"
            fontSize={labelFontSize}
            fontWeight={pinned ? 600 : 400}
            fill="var(--map-crimson)"
            opacity={labelOpacity}
          >
            {labelText}
          </text>
        </g>
      )}
    </g>
  );
}
