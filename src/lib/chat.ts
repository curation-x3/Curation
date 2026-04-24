// Types owned here; both platform implementations import them.
export interface AgentConfig {
  name: string;
  id: string;
  command: string;
  args: string[];
  detected: boolean;
}

export interface ChatSession {
  session_id: string;
  card_id: string | null;
  agent_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatStreamEvent {
  session_id: string;
  event_type: "text_chunk" | "tool_call" | "tool_call_update" | "done" | "error";
  content: string;
}

export {
  IS_CHAT_AVAILABLE,
  detectAgents,
  createChatSession,
  getSessionForCard,
  getHomeSession,
  getChatMessages,
  sendChatMessage,
  cancelChatStream,
} from "./platform/chat";
