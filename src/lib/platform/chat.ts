import * as tauriImpl from "./chat.tauri";
import * as webImpl from "./chat.web";
import { isTauriRuntime } from "./env";

const impl = isTauriRuntime() ? tauriImpl : webImpl;

export const IS_CHAT_AVAILABLE = impl.IS_CHAT_AVAILABLE;
export const detectAgents = impl.detectAgents;
export const createChatSession = impl.createChatSession;
export const getSessionForCard = impl.getSessionForCard;
export const getHomeSession = impl.getHomeSession;
export const getChatMessages = impl.getChatMessages;
export const sendChatMessage = impl.sendChatMessage;
export const cancelChatStream = impl.cancelChatStream;
export const listAcpRuntime = impl.listAcpRuntime;
export const setAcpMaxAlive = impl.setAcpMaxAlive;
export const getAcpMaxAlive = impl.getAcpMaxAlive;
export const checkAcpEnvironment = impl.checkAcpEnvironment;
export const exportDiagnostics = impl.exportDiagnostics;
export type { RuntimeSnapshot, AcpRuntimeEvent, FrontendDiagnosticsPayload } from "./chat.tauri";
