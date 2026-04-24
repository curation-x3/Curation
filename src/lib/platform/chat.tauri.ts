import { invoke } from "@tauri-apps/api/core";
import type { AgentConfig, ChatSession, ChatMessage } from "../chat";

export const IS_CHAT_AVAILABLE = true;

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
