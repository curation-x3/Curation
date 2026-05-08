import { invoke } from "@tauri-apps/api/core";
import type { FavoriteItem, TopicRef } from "../../types";

export interface CachedCard {
  card_id: string;
  article_id: string;
  kind?: string | null;
  source_card_ids?: string[] | null;
  source_article_ids?: string[] | null;
  title: string | null;
  article_title: string | null;
  content_md: string | null;
  additional_content?: string | null;
  description: string | null;
  routing: string | null;
  template: string | null;
  template_reason: string | null;
  card_date: string | null;
  account: string | null;
  author: string | null;
  url: string | null;
  read_at: string | null;
  favorited_at?: string | null;
  updated_at: string;
  publish_time: string | null;
  account_id: number | null;
  biz: string | null;
  cover_url: string | null;
  digest: string | null;
  word_count: number | null;
  is_original: boolean | null;
  /** JSON-encoded array of canonical entity name strings, exactly as stored
   *  in the local SQLite TEXT column. Parse with `parseEntities()` from
   *  `lib/cache.ts` (returns [] for null / malformed input). */
  entities: string | null;
  topic?: TopicRef | null;
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
  card_date: string | null;
  highlight: string;
  is_favorite: boolean;
}

export function initDbWithSecret(secret: string): Promise<void> {
  return invoke("init_db_with_secret", { secret });
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

export async function loadFavoriteItems(): Promise<FavoriteItem[]> {
  // Tauri: local SQLite stores raw favorite rows + cards separately. Build
  // the display shape by joining client-side. cardMap covers ALL received
  // cards (not just inbox-filtered), so favorites of unsubscribed/older
  // bizes still resolve correctly.
  const [rawFavorites, cards] = await Promise.all([
    getFavorites(),
    getInboxCards(null, false),
  ]);
  const cardMap = new Map(cards.map((c) => [c.card_id, c]));
  const sorted = [...rawFavorites].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return sorted.map((fav): FavoriteItem => {
    if (fav.item_type === "card") {
      const card = cardMap.get(fav.item_id);
      return {
        item_type: "card",
        item_id: fav.item_id,
        created_at: fav.created_at,
        title: card?.title ?? null,
        description: card?.description ?? null,
        routing: (card?.routing as FavoriteItem["routing"]) ?? null,
        article_id: card?.article_id ?? null,
        article_title: card?.article_title ?? card?.title ?? null,
        article_account: card?.account ?? null,
        article_meta: card
          ? {
              title: card.article_title ?? card.title ?? "",
              account: card.account ?? "",
              biz: card.biz ?? null,
              author: card.author ?? null,
              publish_time: card.publish_time ?? card.card_date ?? null,
              url: card.url ?? "",
              cover_url: card.cover_url,
              digest: card.digest,
            }
          : null,
      };
    }
    // item_type === "article": no local articles table for full metadata
    return {
      item_type: "article",
      item_id: fav.item_id,
      created_at: fav.created_at,
      title: null,
      description: null,
      routing: null,
      article_id: fav.item_id,
      article_title: null,
      article_account: null,
      article_meta: null,
    };
  });
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

export function getCardContent(cardId: string): Promise<string | null> {
  return invoke("get_card_content", { cardId });
}

export function setCardContent(cardId: string, contentMd: string): Promise<void> {
  return invoke("set_card_content", { cardId, contentMd });
}

export interface CachedAccount {
  id: number;
  biz: string;
  name: string | null;
  avatar_url: string | null;
  description: string | null;
  last_monitored_at: string | null;
  article_count: number | null;
  subscription_type: string | null;
  sync_count: number | null;
}

export function getCachedAccounts(): Promise<CachedAccount[]> {
  return invoke("get_cached_accounts");
}

export function saveCachedAccounts(accounts: Record<string, unknown>[]): Promise<number> {
  return invoke("save_cached_accounts", { accounts });
}

export function getCachedDiscoverableAccounts(): Promise<Record<string, unknown>[]> {
  return invoke("get_cached_discoverable_accounts");
}

export function saveCachedDiscoverableAccounts(accounts: Record<string, unknown>[]): Promise<number> {
  return invoke("save_cached_discoverable_accounts", { accounts });
}

export function runSync(): Promise<string[]> {
  return invoke("run_sync");
}
