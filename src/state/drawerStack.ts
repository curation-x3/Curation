import { create } from "zustand";

export type ViewTarget =
  | { kind: "card";           cardId: string }
  | { kind: "sourceCards";    cardId: string }
  | { kind: "clusterSources"; clusterSignature: string; subtitle?: string }
  | { kind: "article";        articleId: string };

interface DrawerStackState {
  stack: ViewTarget[];
  push: (target: ViewTarget) => void;
  pop: () => void;
  clear: () => void;
  replaceTop: (target: ViewTarget) => void;
}

export const useDrawerStack = create<DrawerStackState>((set) => ({
  stack: [],
  push: (target) => set((s) => ({ stack: [...s.stack, target] })),
  pop: () => set((s) => (s.stack.length === 0 ? s : { stack: s.stack.slice(0, -1) })),
  clear: () => set({ stack: [] }),
  replaceTop: (target) =>
    set((s) => (s.stack.length === 0 ? s : { stack: [...s.stack.slice(0, -1), target] })),
}));
