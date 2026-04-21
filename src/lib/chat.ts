import { invoke } from "@tauri-apps/api/core";

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

export function detectAgents(): Promise<AgentConfig[]> {
  return invoke("detect_available_agents");
}

export function createChatSession(
  cardId: string | null,
  agentId: string,
): Promise<ChatSession> {
  return invoke("create_chat_session", { cardId, agentId });
}

export function getSessionForCard(cardId: string): Promise<ChatSession | null> {
  return invoke("get_session_for_card", { cardId });
}

export function getHomeSession(): Promise<ChatSession | null> {
  return invoke("get_home_session");
}

export function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  return invoke("get_chat_messages", { sessionId });
}

export function sendChatMessage(
  sessionId: string,
  agentId: string,
  message: string,
  systemPrompt: string,
): Promise<string> {
  return invoke("send_chat_message", { sessionId, agentId, message, systemPrompt });
}

export function cancelChatStream(): Promise<void> {
  return invoke("cancel_chat_stream");
}
