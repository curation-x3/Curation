// Types are owned here; both platform implementations import them.
import type { TopicRef } from "../types";

export interface CachedCard {
  card_id: string;
  article_id: string;
  kind?: "initial" | "deduped" | string | null;
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
  updated_at: string;
  publish_time: string | null;
  account_id: number | null;
  biz: string | null;
  cover_url: string | null;
  digest: string | null;
  word_count: number | null;
  is_original: boolean | null;
  /** JSON-encoded array of canonical entity name strings, exactly as stored
   *  in the local SQLite TEXT column. Parse with `parseEntities()` below. */
  entities: string | string[] | null;
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

/**
 * Parse a CachedCard.entities JSON-string into a string array.
 * Returns [] for null / empty / malformed input — never throws — so a single
 * bad row can't crash the inbox / drawer rendering.
 */
export function parseEntities(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
  } catch {
    return [];
  }
}

export {
  initDbWithSecret,
  setCacheAuthToken,
  setApiBase,
  getInboxCards,
  getFavorites,
  loadFavoriteItems,
  searchCards,
  markCardRead,
  markCardUnread,
  markAllCardsRead,
  toggleFavoriteLocal,
  getCardContent,
  setCardContent,
  getCachedAccounts,
  saveCachedAccounts,
  getCachedDiscoverableAccounts,
  saveCachedDiscoverableAccounts,
  runSync,
} from "./platform/cache";
