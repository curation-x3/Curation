// Map — top-level page composition.
//
// Migration contract: MapCanvas takes only its data + callbacks via props.
// The preview wrapper supplies mock data + a fake article-content lookup;
// the production wrapper would supply the real ones.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, MAP_CANVAS } from "../lib/layout";
import { layoutFloatingCards, placeFloatingCard } from "../lib/geometry";
import { validate } from "../lib/validate";
import { isCardRead as deriveRead, useMapStore } from "../state/store";
import type { MapCard, MapDSL } from "../types";
import { MapSvg, type RouteFocus } from "./MapSvg";
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

      const cw = MAP_CANVAS.width;
      const ch = MAP_CANVAS.height;
      const scale = Math.min(stageSize.width / cw, stageSize.height / ch);
      const renderedW = cw * scale;
      const renderedH = ch * scale;
      const offsetX = (stageSize.width - renderedW) / 2;
      const offsetY = (stageSize.height - renderedH) / 2;
      const screenX = offsetX + foundX * scale + foundR * scale;
      const screenY = offsetY + foundY * scale;
      return placeFloatingCard(screenX, screenY, 280, 200, stageSize, 14);
    },
    [layout, stageSize],
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
      const cw = MAP_CANVAS.width;
      const ch = MAP_CANVAS.height;
      const scale = Math.min(stageSize.width / cw, stageSize.height / ch);
      const offsetX = (stageSize.width - cw * scale) / 2;
      const offsetY = (stageSize.height - ch * scale) / 2;
      return {
        x: offsetX + foundX * scale + foundR * scale,
        y: offsetY + foundY * scale,
      };
    },
    [layout, stageSize],
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

  const isCardReadFn = (card_id: string): boolean => {
    const c = cards.find((x) => x.card_id === card_id);
    if (!c) return false;
    return deriveRead(c, sessionRead);
  };

  return (
    <div ref={stageRef} style={{ position: "relative", width: "100%", height: "100%" }}>
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

      <MapLegend />
      <MapCompass />
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
