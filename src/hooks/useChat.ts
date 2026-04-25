import { useState, useEffect, useCallback, useRef } from "react";
import {
  detectAgents,
  createChatSession,
  getSessionForCard,
  getHomeSession,
  getChatMessages,
  sendChatMessage,
  cancelChatStream,
  type AgentConfig,
  type ChatSession,
  type ChatMessage,
} from "../lib/chat";
import { AcpTiming } from "../lib/acp/timing";
import { useRuntimeEntry } from "../lib/acp/store";
import { useSessionStream, useStreamStore } from "../lib/acp/streamStore";
import { onStreamFinalized } from "../lib/acp/listener";
import { useCardStatusStore } from "../lib/acp/cardStatusStore";

// ─── useAgentDetection ───────────────────────────────────────────────────────

export function useAgentDetection() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    detectAgents().then((detected) => {
      setAgents(detected);
      if (selectedAgentId === null) {
        const firstAvailable = detected.find((a) => a.detected);
        if (firstAvailable) {
          setSelectedAgentId(firstAvailable.id);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agents, selectedAgentId, setSelectedAgentId };
}

// ─── useChat ─────────────────────────────────────────────────────────────────

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export function useChat(cardId: string | null, ready: boolean = true) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const sessionId = session?.session_id ?? null;

  // Streaming state for THIS session, derived from the app-level store.
  const streamState = useSessionStream(sessionId);
  const runtime = useRuntimeEntry(sessionId);

  const streamingContent = streamState.displayed;
  const isRuntimeBusy = runtime?.status.kind === "running" || runtime?.status.kind === "starting";
  const hasBufferedStream = streamState.displayed.length > 0 || streamState.buffered.length > 0;
  const isStreaming = isRuntimeBusy || hasBufferedStream;
  const connectionStatus: ConnectionStatus = (() => {
    if (runtime?.status.kind === "errored" || streamState.errored) return "error";
    if (runtime?.status.kind === "starting") return "connecting";
    if (runtime?.status.kind === "running" || hasBufferedStream) return "connected";
    return "disconnected";
  })();

  const currentSessionRef = useRef<ChatSession | null>(null);
  const timingRef = useRef<AcpTiming | null>(null);
  const firstStreamRef = useRef<boolean>(true);
  const firstTextRef = useRef<boolean>(true);

  // Keep ref in sync with state so callbacks have fresh value
  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  // When backend emits "done" and typing buffer drains, reload messages from DB.
  useEffect(() => {
    return onStreamFinalized((finalizedSessionId) => {
      const current = currentSessionRef.current;
      if (current && current.session_id === finalizedSessionId) {
        getChatMessages(finalizedSessionId)
          .then(setMessages)
          .catch(() => {});
      }
    });
  }, []);

  // Timing marks reacting to runtime + stream transitions for this session.
  useEffect(() => {
    if (!timingRef.current) return;
    if (firstStreamRef.current && runtime) {
      timingRef.current.mark("t2 first_stream_event");
      firstStreamRef.current = false;
    }
    if (firstTextRef.current && streamState.displayed.length > 0) {
      timingRef.current.mark("t3 first_text_chunk");
      firstTextRef.current = false;
    }
    if (streamState.done && streamState.buffered.length === 0) {
      timingRef.current.mark("t4 done");
      timingRef.current = null;
    }
  }, [runtime, streamState.displayed.length, streamState.buffered.length, streamState.done]);

  // Load session + messages whenever cardId changes (wait for DB to be ready)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function loadSession() {
      try {
        const existing =
          cardId !== null
            ? await getSessionForCard(cardId)
            : await getHomeSession();

        if (cancelled) return;

        setSession(existing);

        if (existing) {
          const msgs = await getChatMessages(existing.session_id);
          if (!cancelled) setMessages(msgs);
        } else {
          setMessages([]);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setMessages([]);
        }
      }
    }

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [cardId, ready]);

  const sendMessage = useCallback(
    async (text: string, agentId: string, systemPrompt: string) => {
      try {
        // Create session on first message if none exists
        let activeSession = currentSessionRef.current;
        if (!activeSession) {
          activeSession = await createChatSession(cardId, agentId);
          setSession(activeSession);
        }

        if (cardId) {
          useCardStatusStore.getState().setStatus(cardId, "pending");
        }

        // Timing instrumentation for this turn
        timingRef.current = new AcpTiming(activeSession.session_id);
        timingRef.current.mark("t0 send_clicked");
        firstStreamRef.current = true;
        firstTextRef.current = true;

        // Optimistically add user message to UI
        const optimisticMsg: ChatMessage = {
          id: Date.now(),
          session_id: activeSession.session_id,
          role: "user",
          content: text,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMsg]);

        await sendChatMessage(
          activeSession.session_id,
          agentId,
          text,
          systemPrompt,
        );
        timingRef.current?.mark("t1 invoke_returned");
      } catch {
        timingRef.current = null;
      }
    },
    [cardId],
  );

  const cancel = useCallback(async () => {
    if (!sessionId) return;
    try {
      await cancelChatStream(sessionId);
    } finally {
      useStreamStore.getState().clear(sessionId);
    }
  }, [sessionId]);

  const clearSession = useCallback(
    async (agentId: string) => {
      if (sessionId) {
        try {
          await cancelChatStream(sessionId);
        } catch {
          // ignore
        }
        useStreamStore.getState().clear(sessionId);
      }

      const newSession = await createChatSession(cardId, agentId);
      setSession(newSession);
      setMessages([]);
      if (cardId) {
        useCardStatusStore.getState().clear(cardId);
      }
    },
    [cardId, sessionId],
  );

  return {
    session,
    messages,
    streamingContent,
    isStreaming,
    connectionStatus,
    sendMessage,
    clearSession,
    cancel,
  };
}
