// Map — top-level page composition.
//
// Migration contract: MapCanvas takes only its data + callbacks via props.
// The preview wrapper supplies mock data + a fake article-content lookup;
// the production wrapper would supply the real ones.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { computeLayout, MAP_CANVAS } from "../lib/layout";
import { layoutFloatingCards, placeFloatingCard } from "../lib/geometry";
import {
  applyZoomAt,
  clampViewport,
  DEFAULT_VIEWPORT,
  panViewportBy,
  wheelZoomFactor,
  type ViewportPoint,
  type ViewportTransform,
} from "../lib/viewport";
import { validate } from "../lib/validate";
import { isCardRead as deriveRead, useMapStore } from "../state/store";
import type { MapCard, MapDSL } from "../types";
import { MapSvg, type RouteFocus } from "./MapSvg";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useFavorites } from "../../hooks/useFavorites";
import { MapCompass } from "./MapCompass";
import { MapEntityList } from "./MapEntityList";
import { MapFloatingCard } from "./MapFloatingCard";
import { MapLegend } from "./MapLegend";
import { MapPreviewDrawer } from "./MapPreviewDrawer";

export type MapCanvasProps = {
  dsl: MapDSL;
  cards: MapCard[];
  /** Called when a settlement should be marked read (popover button or drawer close). */
  onMarkRead: (card_id: string) => void;
};

type MapGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragged: boolean;
};

export function MapCanvas({
  dsl,
  cards,
  onMarkRead,
}: MapCanvasProps) {
  // Validate (throws on structural errors so failures are loud).
  validate(dsl, cards);

  const layout = useMemo(
    () => computeLayout(dsl, cards, MAP_CANVAS),
    [dsl, cards],
  );

  const hovered = useMapStore((s) => s.hovered_card_id);
  const setHovered = useMapStore((s) => s.setHoveredCard);
  const drawerCardId = useMapStore((s) => s.drawer_card_id);
  const openDrawer = useMapStore((s) => s.openDrawer);
  const closeDrawer = useMapStore((s) => s.closeDrawer);
  const markCardRead = useMapStore((s) => s.markCardRead);
  const sessionRead = useMapStore((s) => s.session_read_card_ids);
  const routesVisible = useMapStore((s) => s.routes_visible);
  const hiddenEntities = useMapStore((s) => s.hidden_entities);
  const [viewport, setViewport] =
    useState<ViewportTransform>(DEFAULT_VIEWPORT);
  const gestureLastScaleRef = useRef(1);
  const panStateRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const { data: favorites } = useFavorites();
  const favoritedIds = useMemo(
    () =>
      new Set(
        (favorites ?? [])
          .filter((f: any) => f.item_type === "card")
          .map((f: any) => f.item_id as string),
      ),
    [favorites],
  );

  // Track stage element to compute popover absolute positions (the SVG canvas
  // uses a viewBox so we need the rendered scale to map back to screen pixels).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({ width: r.width, height: r.height });
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!stageSize.width || !stageSize.height) return;
    setViewport((prev) => clampViewport(prev, stageSize));
  }, [stageSize]);
  useEffect(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, [layout]);

  const stagePointFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node || !stageSize.width || !stageSize.height) return;
    const onWheel = (event: WheelEvent) => {
      if (isFixedMapUiTarget(event.target)) return;
      const anchor = stagePointFromClient(event.clientX, event.clientY);
      if (!anchor) return;
      event.preventDefault();
      setViewport((prev) =>
        applyZoomAt(prev, wheelZoomFactor(event), anchor, stageSize),
      );
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [stagePointFromClient, stageSize]);


  useEffect(() => {
    const node = stageRef.current;
    if (!node || !stageSize.width || !stageSize.height) return;
    const onGestureStart = (event: Event) => {
      if (isFixedMapUiTarget(event.target)) return;
      event.preventDefault();
      gestureLastScaleRef.current = 1;
    };
    const onGestureChange = (event: Event) => {
      if (isFixedMapUiTarget(event.target)) return;
      const gesture = event as MapGestureEvent;
      const anchor = stagePointFromClient(gesture.clientX, gesture.clientY);
      if (!anchor || !Number.isFinite(gesture.scale) || gesture.scale <= 0) {
        return;
      }
      event.preventDefault();
      const factor = gesture.scale / gestureLastScaleRef.current;
      gestureLastScaleRef.current = gesture.scale;
      setViewport((prev) => applyZoomAt(prev, factor, anchor, stageSize));
    };
    const onGestureEnd = () => {
      gestureLastScaleRef.current = 1;
    };
    node.addEventListener("gesturestart", onGestureStart, { passive: false });
    node.addEventListener("gesturechange", onGestureChange, { passive: false });
    node.addEventListener("gestureend", onGestureEnd);
    return () => {
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
    };
  }, [stagePointFromClient, stageSize]);

  const zoomAtStageCenter = useCallback(
    (factor: number) => {
      if (!stageSize.width || !stageSize.height) return;
      const anchor = { x: stageSize.width / 2, y: stageSize.height / 2 };
      setViewport((prev) => applyZoomAt(prev, factor, anchor, stageSize));
    },
    [stageSize],
  );

  const resetZoom = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isFixedMapUiTarget(event.target)) return;
      if (!event.isPrimary || event.button !== 0 || viewport.scale <= 1) return;
      panStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragged: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
    },
    [viewport.scale],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panStateRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;
      const delta = {
        x: event.clientX - pan.lastX,
        y: event.clientY - pan.lastY,
      };
      pan.lastX = event.clientX;
      pan.lastY = event.clientY;

      const dragDistance =
        Math.abs(event.clientX - pan.startX) +
        Math.abs(event.clientY - pan.startY);
      if (dragDistance > 4) pan.dragged = true;
      if (delta.x === 0 && delta.y === 0) return;

      event.preventDefault();
      setViewport((prev) => panViewportBy(prev, delta, stageSize));
    },
    [stageSize],
  );

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (pan.dragged) suppressClickRef.current = true;
    panStateRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isFixedMapUiTarget(event.target)) return;
      if (isMapInteractiveTarget(event.target)) return;
      if (!stageSize.width || !stageSize.height) return;
      const anchor = stagePointFromClient(event.clientX, event.clientY);
      if (!anchor) return;
      event.preventDefault();
      setViewport((prev) => applyZoomAt(prev, 1.6, anchor, stageSize));
    },
    [stagePointFromClient, stageSize],
  );

  const projectMapPointToStage = useCallback(
    (mapX: number, mapY: number, mapRadius = 0): ViewportPoint | null => {
      if (!stageSize.width || !stageSize.height) return null;
      const cw = MAP_CANVAS.width;
      const ch = MAP_CANVAS.height;
      const scale = Math.min(stageSize.width / cw, stageSize.height / ch);
      const renderedW = cw * scale;
      const renderedH = ch * scale;
      const offsetX = (stageSize.width - renderedW) / 2;
      const offsetY = (stageSize.height - renderedH) / 2;
      return {
        x: viewport.x + (offsetX + mapX * scale + mapRadius * scale) * viewport.scale,
        y: viewport.y + (offsetY + mapY * scale) * viewport.scale,
      };
    },
    [stageSize, viewport],
  );

  // Compute the popover anchor position in stage pixel coords, given a card.
  // SVG viewBox preserveAspectRatio="xMidYMid meet" means we project from
  // stage size + canvas size, finding the on-screen point of (cardX, cardY).
  const computePopoverPosition = useCallback(
    (cardId: string | null) => {
      if (!cardId || !stageSize.width || !stageSize.height) return null;
      let foundX = 0;
      let foundY = 0;
      let foundR = 0;
      let found = false;
      for (const c of layout.continents) {
        for (const s of c.cards) {
          if (s.card_id === cardId) {
            foundX = s.x;
            foundY = s.y;
            foundR = s.radius;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) return null;

      const projected = projectMapPointToStage(foundX, foundY, foundR);
      if (!projected) return null;
      return placeFloatingCard(projected.x, projected.y, 280, 200, stageSize, 14);
    },
    [layout, projectMapPointToStage, stageSize],
  );

  // Route-focus state (hover or pinned). When set, two endpoint popovers and
  // a halo on the endpoints are rendered. Pinned state survives mouse leave;
  // unpins on (a) clicking same route again, (b) clicking blank canvas,
  // (c) clicking a different route (which becomes new pin),
  // (d) pressing Escape.
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);

  // ESC handling is sequential: drawer first, route focus second. So pressing
  // ESC while a drawer is open closes the drawer but leaves the pinned route
  // focus intact — pressing ESC again then clears the route. Mirrors the
  // click-outside cascade (scrim closes drawer first, then canvas-click
  // unpins the route).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The drawer has its own keydown listener that calls onClose. We bail
      // here so the drawer's handler "wins" this keypress; the next ESC
      // will then reach this branch and clear the route focus.
      if (drawerCardId) return;
      if (routeFocus) setRouteFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routeFocus, drawerCardId]);

  // When user toggles routes off while a focus is active, drop the focus.
  useEffect(() => {
    if (!routesVisible && routeFocus) setRouteFocus(null);
  }, [routesVisible, routeFocus]);

  // When user hides the focused entity, drop the focus (its lines just
  // disappeared, so the constellation has nothing to highlight).
  useEffect(() => {
    if (routeFocus && hiddenEntities.has(routeFocus.entity)) {
      setRouteFocus(null);
    }
  }, [hiddenEntities, routeFocus]);

  const popoverPosition = useMemo(
    () => computePopoverPosition(hovered),
    [hovered, computePopoverPosition],
  );

  const hoveredCard = hovered ? cards.find((c) => c.card_id === hovered) : null;

  // All cards belonging to the focused entity (the whole "constellation").
  // Each gets its own popover, not just the 2 endpoints of the triggering pair.
  const focusedCards = useMemo(() => {
    if (!routeFocus) return [];
    return cards.filter((c) =>
      c.card_id && c.entities?.includes(routeFocus.entity),
    );
  }, [cards, routeFocus]);

  // Entity → card_ids index, for the left-side MapEntityList. Built from
  // entities (formerly shared_entities), so every entry here will
  // produce at least one route on the map.
  const entitiesIndex = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of cards) {
      if (!c.card_id || !c.entities) continue;
      for (const e of c.entities) {
        if (!m.has(e)) m.set(e, []);
        m.get(e)!.push(c.card_id);
      }
    }
    // Only entities with ≥2 cards produce routes; sort by cardCount desc.
    return Array.from(m.entries())
      .filter(([, ids]) => ids.length >= 2)
      .map(([name, ids]) => ({ name, cardIds: ids }))
      .sort((a, b) => b.cardIds.length - a.cardIds.length);
  }, [cards]);

  const handleEntitySelect = (entityName: string) => {
    const e = entitiesIndex.find((x) => x.name === entityName);
    if (!e || e.cardIds.length < 2) return;
    // Toggle: if this entity is currently pinned, unpin (clear focus).
    if (
      routeFocus?.pinned &&
      routeFocus.entity === entityName
    ) {
      setRouteFocus(null);
      return;
    }
    setRouteFocus({
      entity: entityName,
      // Use the first two cards as the "triggering pair" for popover
      // positioning logic; entity-based highlighting still pulls in all
      // cards/routes sharing this entity.
      fromId: e.cardIds[0],
      toId: e.cardIds[1],
      pinned: true,
    });
  };

  // Helper: project a card's settlement onto stage pixel coords (for the
  // popover anchor). Decoupled from `computePopoverPosition` so we can feed
  // anchor coords into the multi-card layout algorithm.
  const computeAnchorScreenPos = useCallback(
    (cardId: string): { x: number; y: number } | null => {
      if (!stageSize.width || !stageSize.height) return null;
      let foundX = 0;
      let foundY = 0;
      let foundR = 0;
      let found = false;
      for (const c of layout.continents) {
        for (const s of c.cards) {
          if (s.card_id === cardId) {
            foundX = s.x;
            foundY = s.y;
            foundR = s.radius;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) return null;
      return projectMapPointToStage(foundX, foundY, foundR);
    },
    [layout, projectMapPointToStage, stageSize],
  );

  // Layout all focused-entity popovers at once so they don't overlap.
  const focusedCardPositions = useMemo(() => {
    if (!focusedCards.length || !stageSize.width) return [];
    const anchors = focusedCards
      .map((c) => {
        const a = computeAnchorScreenPos(c.card_id!);
        return a ? { id: c.card_id!, x: a.x, y: a.y } : null;
      })
      .filter((a): a is { id: string; x: number; y: number } => a != null);
    const positions = layoutFloatingCards(anchors, 280, 200, stageSize, 14);
    return focusedCards
      .map((card) => {
        const pos = positions.get(card.card_id!);
        return pos ? { card, pos } : null;
      })
      .filter(
        (x): x is {
          card: MapCard;
          pos: { x: number; y: number; anchor: "left" | "right" };
        } => x != null,
      );
  }, [focusedCards, stageSize, computeAnchorScreenPos]);
  const drawerCard = drawerCardId
    ? cards.find((c) => c.card_id === drawerCardId)
    : null;

  // Wrap close-drawer to also propagate mark-read to caller.
  const handleCloseDrawer = () => {
    if (drawerCardId) onMarkRead(drawerCardId);
    closeDrawer();
  };
  const handleMarkRead = (card_id: string) => {
    markCardRead(card_id);
    onMarkRead(card_id);
    setHovered(null);
  };

  const sourceLabelForCard = useCallback(
    (card: MapCard): string | undefined => {
      const sourceIds = Array.isArray(card.source_card_ids)
        ? card.source_card_ids
        : [];
      if (sourceIds.length <= 1) return undefined;

      const sourceAccounts = sourceIds
        .map((id) => cards.find((c) => c.card_id === id)?.article_meta?.account)
        .filter((account): account is string => Boolean(account));
      const uniqueAccounts = Array.from(new Set(sourceAccounts));
      if (uniqueAccounts.length === 0) {
        return `来源汇总 · ${sourceIds.length} 张`;
      }
      const visibleAccounts = uniqueAccounts.slice(0, 3).join("、");
      const suffix =
        uniqueAccounts.length > 3 ? ` 等 ${uniqueAccounts.length} 个来源` : "";
      return `来源汇总 · ${sourceIds.length} 张 · ${visibleAccounts}${suffix}`;
    },
    [cards],
  );

  const isCardReadFn = (card_id: string): boolean => {
    const c = cards.find((x) => x.card_id === card_id);
    if (!c) return false;
    return deriveRead(c, sessionRead);
  };

  return (
    <div
      ref={stageRef}
      data-map-stage
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onClickCapture={handleClickCapture}
      onDoubleClick={handleDoubleClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        cursor: viewport.scale > 1 ? (isPanning ? "grabbing" : "grab") : "default",
      }}
    >
      <div
        data-map-viewport
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <MapSvg
          dsl={dsl}
          cards={cards}
          layout={layout}
          isCardRead={isCardReadFn}
          onSettlementHover={(id) => setHovered(id)}
          onSettlementClick={(id) => openDrawer(id)}
          routeFocus={routeFocus}
          routesVisible={routesVisible}
          hiddenEntities={hiddenEntities}
          onRouteHover={(focus) => setRouteFocus(focus)}
          onRouteClick={(focus) => {
            setRouteFocus((prev) => {
              // Same route clicked twice while pinned → unpin (clear focus).
              if (
                prev?.pinned &&
                prev.fromId === focus.fromId &&
                prev.toId === focus.toId
              ) {
                return null;
              }
              return focus; // focus.pinned = true (set by MapSvg)
            });
          }}
          onCanvasBlankClick={() => setRouteFocus(null)}
          favoritedIds={favoritedIds}
        />
      </div>

      <MapLegend />
      <MapCompass />
      <MapZoomControls
        scale={viewport.scale}
        onZoomIn={() => zoomAtStageCenter(1.2)}
        onZoomOut={() => zoomAtStageCenter(1 / 1.2)}
        onReset={resetZoom}
      />
      <MapEntityList
        entities={entitiesIndex.map((e) => ({
          name: e.name,
          cardCount: e.cardIds.length,
        }))}
        selectedEntity={routeFocus?.entity ?? null}
        onSelect={handleEntitySelect}
      />

      {/* Single-card hover popover. Independent of any route focus — hovering
          a dot ALWAYS surfaces that one card, like the original baseline UX. */}
      {hoveredCard && popoverPosition && (
        <MapFloatingCard
          card={hoveredCard}
          dsl={dsl}
          position={popoverPosition}
          onMarkRead={() => handleMarkRead(hoveredCard.card_id!)}
          onMouseEnter={() => setHovered(hoveredCard.card_id!)}
          onMouseLeave={() => setHovered(null)}
          onOpenDrawer={() => openDrawer(hoveredCard.card_id!)}
          sourceLabel={sourceLabelForCard(hoveredCard)}
        />
      )}

      {/* Entity-constellation popovers: one per card sharing the focused
          entity. Active when routeFocus is set AND user isn't currently
          hovering a specific dot (dot hover takes precedence — single-card
          mode wins). Click any card to open its drawer. */}
      {!hovered &&
        focusedCardPositions.map(({ card, pos }) => (
          <MapFloatingCard
            key={card.card_id}
            card={card}
            dsl={dsl}
            position={pos}
            onMarkRead={() => handleMarkRead(card.card_id!)}
            onMouseEnter={() => {}}
            onMouseLeave={() => {}}
            onOpenDrawer={() => openDrawer(card.card_id!)}
            interactive={routeFocus?.pinned ?? false}
            sourceLabel={sourceLabelForCard(card)}
          />
        ))}

      <MapPreviewDrawer
        open={drawerCardId != null}
        card={drawerCard ?? null}
        onClose={handleCloseDrawer}
      />
    </div>
  );
}

function isFixedMapUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-map-fixed-ui]") != null;
}

function isMapInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-map-interactive]") != null;
}

function MapZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div
      data-map-fixed-ui
      style={{
        position: "absolute",
        right: 36,
        bottom: 190,
        zIndex: 6,
        display: "grid",
        gridTemplateColumns: "30px 30px",
        gap: 4,
        padding: 6,
        background: "var(--map-vellum)",
        border: "1px solid var(--map-ink)",
        boxShadow: "var(--map-shadow-vellum)",
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <button type="button" title="放大" onClick={onZoomIn} style={zoomButtonStyle}>
        <Plus size={15} strokeWidth={1.8} />
      </button>
      <button type="button" title="缩小" onClick={onZoomOut} style={zoomButtonStyle}>
        <Minus size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="重置缩放"
        onClick={onReset}
        style={{
          ...zoomButtonStyle,
          gridColumn: "1 / 3",
          width: 64,
          fontFamily: "var(--map-mono)",
          fontSize: 9,
          letterSpacing: "0.08em",
          gap: 5,
        }}
      >
        <RotateCcw size={11} strokeWidth={1.7} />
        {Math.round(scale * 100)}%
      </button>
    </div>
  );
}

const zoomButtonStyle: CSSProperties = {
  width: 30,
  height: 26,
  border: "1px solid var(--map-ink-2)",
  background: "var(--map-paper)",
  color: "var(--map-ink)",
  fontFamily: "var(--map-display)",
  fontSize: 15,
  lineHeight: "22px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
