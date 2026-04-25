import { listen, type UnlistenFn } from "../platform/sync-event";
import { listAcpRuntime, type AcpRuntimeEvent, type ChatStreamEvent } from "../chat";
import { useAcpStore } from "./store";
import { useStreamStore } from "./streamStore";
import { useCardStatusStore } from "./cardStatusStore";

let started = false;
let unlistenRuntime: UnlistenFn | null = null;
let unlistenStream: UnlistenFn | null = null;
let typingTimer: ReturnType<typeof setInterval> | null = null;

// Fires when backend sent "done" and the typing loop has fully drained the buffer.
// Components listen for this and then reload messages from the DB.
export const STREAM_FINALIZED = "acp:stream-finalized";

export function onStreamFinalized(fn: (sessionId: string) => void): () => void {
  const handler = (evt: Event) => {
    const sid = (evt as CustomEvent<string>).detail;
    fn(sid);
  };
  window.addEventListener(STREAM_FINALIZED, handler as EventListener);
  return () => window.removeEventListener(STREAM_FINALIZED, handler as EventListener);
}

function startTypingLoop(): void {
  if (typingTimer) return;
  typingTimer = setInterval(() => {
    const store = useStreamStore.getState();
    const entries = Object.entries(store.byId);
    if (entries.length === 0) return;

    for (const [sessionId, state] of entries) {
      if (state.buffered.length > 0) {
        const charsPerTick = Math.max(1, Math.min(8, Math.ceil(state.buffered.length / 10)));
        const delta = state.buffered.slice(0, charsPerTick);
        store.reveal(sessionId, delta);
      } else if (state.done) {
        // Buffer drained — finalize this session.
        const wasErrored = state.errored;
        store.clear(sessionId);
        if (!wasErrored) {
          // Transition card to "unread" — ReaderPane downgrades to "read"
          // for the currently-viewed card. Skip if card is already "error"
          // so a prior failure remains visible.
          const entry = useAcpStore.getState().bySession[sessionId];
          const cardId = entry?.cardId ?? null;
          if (cardId) {
            const cur = useCardStatusStore.getState().byCard[cardId];
            if (cur !== "error") {
              useCardStatusStore.getState().setStatus(cardId, "unread");
            }
          }
        }
        window.dispatchEvent(new CustomEvent(STREAM_FINALIZED, { detail: sessionId }));
      }
    }
  }, 20);
}

function stopTypingLoop(): void {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
}

export async function startAcpListener(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const initial = await listAcpRuntime();
    useAcpStore.getState().applySnapshot(initial);
  } catch {
    // first boot before DB ready is fine
  }

  unlistenRuntime = await listen<AcpRuntimeEvent>("acp-runtime", (event) => {
    const evt = event.payload;
    // Errored runtime events delete the session from the store, so capture
    // the cardId here before applyEvent runs.
    if (evt.status.kind === "errored" && evt.card_id) {
      useCardStatusStore.getState().setStatus(evt.card_id, "error");
    }
    // Stopping is the only signal for graceful shutdown — backend does not
    // emit a "removed" event after the task exits cleanly.
    if (evt.status.kind === "stopping" && evt.card_id) {
      const cur = useCardStatusStore.getState().byCard[evt.card_id];
      if (cur && cur !== "error") {
        useCardStatusStore.getState().setStatus(evt.card_id, "closed");
      }
    }
    useAcpStore.getState().applyEvent(evt);
  });

  unlistenStream = await listen<ChatStreamEvent>("chat-stream", (event) => {
    const { session_id, event_type, content } = event.payload;
    const stream = useStreamStore.getState();
    if (event_type === "text_chunk") {
      stream.appendChunk(session_id, content);
    } else if (event_type === "done") {
      stream.markDone(session_id);
    } else if (event_type === "error") {
      stream.markError(session_id);
      const entry = useAcpStore.getState().bySession[session_id];
      if (entry?.cardId) {
        useCardStatusStore.getState().setStatus(entry.cardId, "error");
      }
      window.dispatchEvent(new CustomEvent(STREAM_FINALIZED, { detail: session_id }));
    }
  });

  startTypingLoop();
}

export function stopAcpListener(): void {
  if (unlistenRuntime) {
    unlistenRuntime();
    unlistenRuntime = null;
  }
  if (unlistenStream) {
    unlistenStream();
    unlistenStream = null;
  }
  stopTypingLoop();
  started = false;
}
