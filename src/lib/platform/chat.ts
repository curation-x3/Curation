import * as tauriImpl from "./chat.tauri";
import * as webImpl from "./chat.web";

const impl = __IS_WEB__ ? webImpl : tauriImpl;

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
export type { RuntimeSnapshot, AcpRuntimeEvent } from "./chat.tauri";
