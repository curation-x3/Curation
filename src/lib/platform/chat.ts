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
