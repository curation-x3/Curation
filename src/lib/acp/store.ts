import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { RuntimeSnapshot, AcpRuntimeEvent } from "../chat";

type Status = RuntimeSnapshot["status"];

export type RuntimeEntry = {
  sessionId: string;
  cardId: string | null;
  agentId: string;
  status: Status;
};

type AcpState = {
  bySession: Record<string, RuntimeEntry>;
  applyEvent: (evt: AcpRuntimeEvent) => void;
  applySnapshot: (list: RuntimeSnapshot[]) => void;
  remove: (sessionId: string) => void;
};

export const useAcpStore = create<AcpState>((set) => ({
  bySession: {},

  applyEvent: (evt) =>
    set((s) => {
      const next = { ...s.bySession };
      if (evt.status.kind === "errored") {
        delete next[evt.session_id];
      } else {
        next[evt.session_id] = {
          sessionId: evt.session_id,
          cardId: evt.card_id,
          agentId: evt.agent_id,
          status: evt.status,
        };
      }
      return { bySession: next };
    }),

  applySnapshot: (list) =>
    set(() => {
      const next: Record<string, RuntimeEntry> = {};
      for (const s of list) {
        next[s.session_id] = {
          sessionId: s.session_id,
          cardId: s.card_id,
          agentId: s.agent_id,
          status: s.status,
        };
      }
      return { bySession: next };
    }),

  remove: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.bySession)) return s;
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));

// ── Selectors (hooks) ─────────────────────────────────────────────────────

export function useRuntimeEntry(sessionId: string | null): RuntimeEntry | null {
  return useAcpStore((s) =>
    sessionId ? s.bySession[sessionId] ?? null : null,
  );
}

export function useIsSessionRunning(sessionId: string | null): boolean {
  return useAcpStore((s) =>
    sessionId
      ? s.bySession[sessionId]?.status.kind === "running"
      : false,
  );
}

export function useIsCardRunning(cardId: string | null): boolean {
  return useAcpStore((s) => {
    if (cardId === null) return false;
    for (const entry of Object.values(s.bySession)) {
      if (entry.cardId === cardId && entry.status.kind === "running") {
        return true;
      }
    }
    return false;
  });
}

export function useRunningCardIds(): string[] {
  return useAcpStore(
    useShallow((s) =>
      Object.values(s.bySession)
        .filter((e) => e.status.kind === "running" && e.cardId !== null)
        .map((e) => e.cardId as string),
    ),
  );
}
