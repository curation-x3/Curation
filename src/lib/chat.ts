// Types owned here; both platform implementations import them.
export interface AgentConfig {
  name: string;
  id: string;
  command: string;
  args: string[];
  detected: boolean;
}

export interface CommandCheck {
  command: string;
  available: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface AdapterCheck {
  package: string | null;
  binary: string | null;
  ready: boolean;
  checked: boolean;
  error: string | null;
}

export interface AgentEnvironmentCheck {
  name: string;
  id: string;
  detected: boolean;
  cli: CommandCheck;
  launcher: CommandCheck;
  adapter: AdapterCheck;
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
  listAcpRuntime,
  setAcpMaxAlive,
  getAcpMaxAlive,
  checkAcpEnvironment,
  exportDiagnostics,
} from "./platform/chat";
export type { RuntimeSnapshot, AcpRuntimeEvent, FrontendDiagnosticsPayload } from "./platform/chat";
