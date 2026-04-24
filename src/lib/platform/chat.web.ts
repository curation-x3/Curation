import type { AgentConfig, ChatSession, ChatMessage } from "../chat";

export const IS_CHAT_AVAILABLE = false;

const unavailable = (op: string): never => {
  throw new Error(`Chat operation "${op}" is not available in the web build`);
};

export function detectAgents(): Promise<AgentConfig[]> {
  return Promise.resolve([]);
}

export function createChatSession(
  _cardId: string | null,
  _agentId: string,
): Promise<ChatSession> {
  return unavailable("createChatSession");
}

export function getSessionForCard(_cardId: string): Promise<ChatSession | null> {
  return Promise.resolve(null);
}

export function getHomeSession(): Promise<ChatSession | null> {
  return Promise.resolve(null);
}

export function getChatMessages(_sessionId: string): Promise<ChatMessage[]> {
  return Promise.resolve([]);
}

export function sendChatMessage(
  _sessionId: string,
  _agentId: string,
  _message: string,
  _systemPrompt: string,
): Promise<string> {
  return unavailable("sendChatMessage");
}

export function cancelChatStream(): Promise<void> {
  return Promise.resolve();
}
