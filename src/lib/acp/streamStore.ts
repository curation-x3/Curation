import { create } from "zustand";

export type StreamState = {
  // Text already revealed to the UI (after typing animation).
  displayed: string;
  // Pending characters waiting to be revealed.
  buffered: string;
  // Backend finished emitting — typing loop will flush and finalize.
  done: boolean;
  // Final result reloaded from DB; clear this session's stream state.
  errored: boolean;
};

type StreamStoreState = {
  byId: Record<string, StreamState>;
  appendChunk: (sessionId: string, text: string) => void;
  reveal: (sessionId: string, delta: string) => void;
  markDone: (sessionId: string) => void;
  markError: (sessionId: string) => void;
  clear: (sessionId: string) => void;
  getBuffered: (sessionId: string) => string;
};

const empty: StreamState = { displayed: "", buffered: "", done: false, errored: false };

export const useStreamStore = create<StreamStoreState>((set, get) => ({
  byId: {},

  appendChunk: (sessionId, text) =>
    set((s) => {
      const prev = s.byId[sessionId] ?? empty;
      return {
        byId: {
          ...s.byId,
          [sessionId]: { ...prev, buffered: prev.buffered + text, done: false, errored: false },
        },
      };
    }),

  reveal: (sessionId, delta) =>
    set((s) => {
      const prev = s.byId[sessionId];
      if (!prev) return s;
      return {
        byId: {
          ...s.byId,
          [sessionId]: {
            ...prev,
            displayed: prev.displayed + delta,
            buffered: prev.buffered.slice(delta.length),
          },
        },
      };
    }),

  markDone: (sessionId) =>
    set((s) => {
      const prev = s.byId[sessionId] ?? empty;
      return { byId: { ...s.byId, [sessionId]: { ...prev, done: true } } };
    }),

  markError: (sessionId) =>
    set((s) => {
      const prev = s.byId[sessionId] ?? empty;
      return {
        byId: { ...s.byId, [sessionId]: { ...prev, errored: true, done: true } },
      };
    }),

  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const next = { ...s.byId };
      delete next[sessionId];
      return { byId: next };
    }),

  getBuffered: (sessionId) => get().byId[sessionId]?.buffered ?? "",
}));

export function useSessionStream(sessionId: string | null): StreamState {
  return useStreamStore((s) =>
    sessionId ? s.byId[sessionId] ?? empty : empty,
  );
}
