import { invoke } from "@tauri-apps/api/core";

export interface CachedCard {
  card_id: string;
  article_id: string;
  title: string | null;
  article_title: string | null;
  content_md: string | null;
  description: string | null;
  routing: string | null;
  article_date: string | null;
  account: string | null;
  author: string | null;
  url: string | null;
  read_at: string | null;
  updated_at: string;
  publish_time: string | null;
}

export interface CachedFavorite {
  item_type: "card" | "article";
  item_id: string;
  created_at: string;
  synced: number;
}

export interface SearchResult {
  card_id: string;
  title: string | null;
  article_id: string;
  account: string | null;
  article_date: string | null;
  highlight: string;
  is_favorite: boolean;
}

export function openDbFromKeychain(): Promise<boolean> {
  return invoke("open_db_from_keychain");
}

export function initDbWithLogin(token: string, userId: string): Promise<void> {
  return invoke("init_db_with_login", { token, userId });
}

export function setCacheAuthToken(token: string): Promise<void> {
  return invoke("set_auth_token", { token });
}

export function setApiBase(apiBase: string): Promise<void> {
  return invoke("set_api_base", { apiBase });
}

export function getInboxCards(account?: string | null, unreadOnly?: boolean): Promise<CachedCard[]> {
  return invoke("get_inbox_cards", { account: account ?? undefined, unreadOnly });
}

export function getFavorites(): Promise<CachedFavorite[]> {
  return invoke("get_favorites");
}

export function searchCards(query: string): Promise<SearchResult[]> {
  return invoke("search_cards", { query });
}

export function markCardRead(cardId: string): Promise<void> {
  return invoke("mark_read", { cardId });
}

export function markCardUnread(cardId: string): Promise<void> {
  return invoke("mark_unread", { cardId });
}

export function markAllCardsRead(cardIds: string[]): Promise<void> {
  return invoke("mark_all_read", { cardIds });
}

export function toggleFavoriteLocal(itemType: string, itemId: string, isFavorited: boolean): Promise<void> {
  return invoke("toggle_favorite", { itemType, itemId, isFavorited });
}

export function getCachedArticle(articleId: string): Promise<string | null> {
  return invoke("get_cached_article", { articleId });
}

export function getCardContent(cardId: string): Promise<string | null> {
  return invoke("get_card_content", { cardId });
}

export function runSync(): Promise<string[]> {
  return invoke("run_sync");
}
