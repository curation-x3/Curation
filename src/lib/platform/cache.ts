import * as tauriImpl from "./cache.tauri";
import * as webImpl from "./cache.web";
import { isTauriRuntime } from "./env";

const impl = isTauriRuntime() ? tauriImpl : webImpl;

export type { CachedCard, CachedFavorite, SearchResult, CachedAccount } from "../cache";

export const initDbWithSecret = impl.initDbWithSecret;
export const setCacheAuthToken = impl.setCacheAuthToken;
export const setApiBase = impl.setApiBase;
export const setCacheUserScope = impl.setCacheUserScope;
export const getInboxCards = impl.getInboxCards;
export const getFavorites = impl.getFavorites;
export const loadFavoriteItems = impl.loadFavoriteItems;
export const searchCards = impl.searchCards;
export const markCardRead = impl.markCardRead;
export const markCardUnread = impl.markCardUnread;
export const markAllCardsRead = impl.markAllCardsRead;
export const toggleFavoriteLocal = impl.toggleFavoriteLocal;
export const getCardContent = impl.getCardContent;
export const setCardContent = impl.setCardContent;
export const getCachedAccounts = impl.getCachedAccounts;
export const saveCachedAccounts = impl.saveCachedAccounts;
export const getCachedDiscoverableAccounts = impl.getCachedDiscoverableAccounts;
export const saveCachedDiscoverableAccounts = impl.saveCachedDiscoverableAccounts;
export const runSync = impl.runSync;
