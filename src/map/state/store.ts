// Map — session state.
//
// Holds hover / drawer / read state for one viewing session.
// Read state is layered: a card is read if either:
//   - card.read_at is non-null (initial state from data), or
//   - the user has marked it read this session (session_read_card_ids)

import { create } from "zustand";

type MapState = {
  hovered_card_id: string | null;
  drawer_card_id: string | null;
  session_read_card_ids: Set<string>;
  routes_visible: boolean;
  entity_scope: "core" | "all";
  /** Entities the user has explicitly hidden — their routes/lines are not
   *  rendered. Settlement halos still apply when other entities are focused. */
  hidden_entities: Set<string>;

  setHoveredCard: (id: string | null) => void;
  openDrawer: (card_id: string) => void;
  closeDrawer: () => void;
  markCardRead: (card_id: string) => void;
  toggleRoutes: () => void;
  setEntityScope: (scope: "core" | "all") => void;
  toggleEntityHidden: (entity: string) => void;
};

export const useMapStore = create<MapState>((set) => ({
  hovered_card_id: null,
  drawer_card_id: null,
  session_read_card_ids: new Set<string>(),
  routes_visible: true,
  entity_scope: "core",
  hidden_entities: new Set<string>(),

  setHoveredCard: (id) => set({ hovered_card_id: id }),

  openDrawer: (card_id) =>
    set((s) => ({
      drawer_card_id: card_id,
      hovered_card_id: null,
      // Note: closing the drawer is what marks read (per spec),
      // not opening it. So we don't add to session_read_card_ids here.
      session_read_card_ids: s.session_read_card_ids,
    })),

  closeDrawer: () =>
    set((s) => {
      const id = s.drawer_card_id;
      if (!id) return { drawer_card_id: null };
      const next = new Set(s.session_read_card_ids);
      next.add(id);
      return { drawer_card_id: null, session_read_card_ids: next };
    }),

  markCardRead: (card_id) =>
    set((s) => {
      if (s.session_read_card_ids.has(card_id)) return s;
      const next = new Set(s.session_read_card_ids);
      next.add(card_id);
      return { session_read_card_ids: next };
    }),

  toggleRoutes: () => set((s) => ({ routes_visible: !s.routes_visible })),

  setEntityScope: (scope) =>
    set({ entity_scope: scope, hidden_entities: new Set<string>() }),

  toggleEntityHidden: (entity) =>
    set((s) => {
      const next = new Set(s.hidden_entities);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return { hidden_entities: next };
    }),
}));

/**
 * Layered read predicate.
 *   isCardRead(card, store) === true if data says read OR session marked read.
 */
export function isCardRead(
  card: { card_id: string | null; read_at: string | null },
  session_read_card_ids: Set<string>,
): boolean {
  if (card.read_at != null) return true;
  if (card.card_id && session_read_card_ids.has(card.card_id)) return true;
  return false;
}
