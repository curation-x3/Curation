import { create } from "zustand";
import { useAcpStore } from "./store";

// Per-card ACP lifecycle status driven by user action and stream events.
// - pending: user sent a message, awaiting agent response (spinner)
// - unread:  agent replied successfully, user has not viewed it yet
// - read:    agent replied and user is/was viewing the card
// - error:   communication failed
// - closed:  no live session for this card anymore (session evicted/ended)
export type CardStatus = "pending" | "unread" | "read" | "error" | "closed";

type CardStatusState = {
  byCard: Record<string, CardStatus>;
  setStatus: (cardId: string, status: CardStatus) => void;
  clear: (cardId: string) => void;
};

export const useCardStatusStore = create<CardStatusState>((set) => ({
  byCard: {},
  setStatus: (cardId, status) =>
    set((s) => {
      if (s.byCard[cardId] === status) return s;
      return { byCard: { ...s.byCard, [cardId]: status } };
    }),
  clear: (cardId) =>
    set((s) => {
      if (!(cardId in s.byCard)) return s;
      const next = { ...s.byCard };
      delete next[cardId];
      return { byCard: next };
    }),
}));

export function useCardStatus(cardId: string | null): CardStatus | null {
  return useCardStatusStore((s) => (cardId ? s.byCard[cardId] ?? null : null));
}

// When a card's last live runtime entry disappears (session evicted or ended),
// transition its status to "closed" — unless it's currently "error", which
// persists so the user keeps seeing the red dot.
let prevCardIds = new Set<string>();
useAcpStore.subscribe((state) => {
  const currCardIds = new Set<string>();
  for (const e of Object.values(state.bySession)) {
    if (e.cardId) currCardIds.add(e.cardId);
  }
  for (const cardId of prevCardIds) {
    if (currCardIds.has(cardId)) continue;
    const cur = useCardStatusStore.getState().byCard[cardId];
    if (!cur) continue;
    if (cur === "error" || cur === "closed") continue;
    useCardStatusStore.getState().setStatus(cardId, "closed");
  }
  prevCardIds = currCardIds;
});
