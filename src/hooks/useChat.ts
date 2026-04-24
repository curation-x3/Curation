import { useState, useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "../lib/platform/sync-event";
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
  type ChatStreamEvent,
} from "../lib/chat";
import { AcpTiming } from "../lib/acp/timing";

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
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentSessionRef = useRef<ChatSession | null>(null);

  // Typing buffer: chunks arrive in bursts, we reveal chars smoothly
  const bufferRef = useRef<string>("");        // pending text not yet shown
  const displayedRef = useRef<string>("");     // text already revealed
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef<boolean>(false);      // true when "done" event received

  // Timing instrumentation (per turn)
  const timingRef = useRef<AcpTiming | null>(null);
  const firstStreamRef = useRef<boolean>(true);
  const firstTextRef = useRef<boolean>(true);

  const startTypingTimer = useCallback(() => {
    if (timerRef.current) return; // already running
    timerRef.current = setInterval(() => {
      const pending = bufferRef.current;
      if (pending.length === 0) {
        // Nothing to type — if done, flush and stop
        if (doneRef.current) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          // Final state: clear streaming, reload from DB
          setStreamingContent("");
          setIsStreaming(false);
          setConnectionStatus("disconnected");
          const currentSession = currentSessionRef.current;
          if (currentSession) {
            getChatMessages(currentSession.session_id).then(setMessages);
          }
          displayedRef.current = "";
          doneRef.current = false;
        }
        return;
      }
      // Dynamic speed: more buffered → more chars per tick
      const charsPerTick = Math.max(1, Math.min(8, Math.ceil(pending.length / 10)));
      const chunk = pending.slice(0, charsPerTick);
      bufferRef.current = pending.slice(charsPerTick);
      displayedRef.current += chunk;
      setStreamingContent(displayedRef.current);
    }, 20); // 50fps
  }, []);

  // Keep ref in sync with state so callbacks have fresh value
  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  // Register the Tauri event listener for streaming once
  useEffect(() => {
    let cancelled = false;

    listen<ChatStreamEvent>("chat-stream", (event) => {
      const { event_type, content } = event.payload;

      if (firstStreamRef.current && timingRef.current) {
        timingRef.current.mark("t2 first_stream_event");
        firstStreamRef.current = false;
      }

      if (event_type === "text_chunk") {
        if (firstTextRef.current && timingRef.current) {
          timingRef.current.mark("t3 first_text_chunk");
          firstTextRef.current = false;
        }
        bufferRef.current += content;
        setConnectionStatus("connected");
        startTypingTimer();
      } else if (event_type === "done") {
        if (timingRef.current) {
          timingRef.current.mark("t4 done");
          timingRef.current = null;
        }
        // Mark done — the typing timer will flush remaining buffer then finalize
        doneRef.current = true;
        if (!timerRef.current) {
          // No timer running (empty buffer) — finalize immediately
          setStreamingContent("");
          setIsStreaming(false);
          setConnectionStatus("disconnected");
          const currentSession = currentSessionRef.current;
          if (currentSession) {
            getChatMessages(currentSession.session_id).then((msgs) => {
              if (!cancelled) setMessages(msgs);
            });
          }
          displayedRef.current = "";
          doneRef.current = false;
        }
      } else if (event_type === "error") {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        bufferRef.current = "";
        displayedRef.current = "";
        setStreamingContent("");
        setIsStreaming(false);
        setConnectionStatus("error");
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [startTypingTimer]);

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
      setIsStreaming(true);
      setConnectionStatus("connecting");

      try {
        // Create session on first message if none exists
        let activeSession = currentSessionRef.current;
        if (!activeSession) {
          activeSession = await createChatSession(cardId, agentId);
          setSession(activeSession);
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
        // Streaming events handled by the listener above
      } catch {
        setIsStreaming(false);
        setConnectionStatus("error");
        timingRef.current = null;
      }
    },
    [cardId],
  );

  const cancel = useCallback(async () => {
    try {
      await cancelChatStream();
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      bufferRef.current = "";
      displayedRef.current = "";
      doneRef.current = false;
      setIsStreaming(false);
      setStreamingContent("");
      setConnectionStatus("disconnected");
    }
  }, []);

  const clearSession = useCallback(
    async (agentId: string) => {
      // Stop any in-flight stream first
      try {
        await cancelChatStream();
      } catch {
        // ignore
      }

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      bufferRef.current = "";
      displayedRef.current = "";
      doneRef.current = false;
      setIsStreaming(false);
      setStreamingContent("");
      setConnectionStatus("disconnected");

      const newSession = await createChatSession(cardId, agentId);
      setSession(newSession);
      setMessages([]);
    },
    [cardId],
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

