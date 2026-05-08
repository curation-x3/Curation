// IndexedDB schema for the web build's local cache. Mirrors the desktop's
// SQLite tables (src-tauri/src/db.rs) so the same /sync delta payload writes
// into either backend without per-platform shaping.
//
// IndexedDB's native version is reserved for actual object-store shape
// changes. Cache invalidations and full-resync requests use
// CACHE_DATA_VERSION inside sync_state instead, so a stale tab cannot block the
// app on an IndexedDB versionchange just because we need to wipe local rows.
import type { DBSchema } from "idb";
import type { CachedCard, CachedFavorite, CachedAccount } from "../cache";

export const DB_NAME = "curation_cache_v3";
// v2 (2026-05-04): server's /sync semantics changed from
//   filter: card.updated_at > since
// to
//   filter: GREATEST(card.updated_at, cd.created_at, cd.read_at,
//                    cd.favorited_at, cd.dismissed_at) >= since
// Cards delivered by subscribe-time backfill or a re-run since the user
// last synced with the OLD logic are stuck behind the user's
// last_sync_ts cursor — they'll never surface incrementally because
// their event_at < the stored cursor. Bump forces a cards/articles
// wipe + last_sync_ts reset → next /sync pulls full state.
// v3 (2026-05-05): local cache now stores dedup metadata and removes
// superseded source cards when a deduped card arrives. Clear card state so
// clients with stale source cards rebuild from server visibility.
// v4 (2026-05-05): dedup reruns can produce a new aggregate card ID for the
// same source set. Clear stale cards once; new sync code also prunes older
// local deduped cards with overlapping source_card_ids.
// v5 (2026-05-06): /sync now carries cards.additional_content so
// original_content_with_* rows can render rich original HTML from local cache.
// Force a card cache rebuild so existing rows receive that field.
// v6 (2026-05-06): /sync now carries cards.content as content_md, so card
// body reads are local and no longer lazy-loaded per card.
// v7 (2026-05-07): /sync now carries inline Atlas topic refs. Rebuild card
// rows so the map can build its taxonomy from local cache.
// v8 (2026-05-08): card favorites are sourced from card_deliveries.favorited_at
// inside /sync card rows instead of legacy /favorites card rows. Clear the
// local favorites store and reset the sync cursor so a full pull rebuilds
// both card favorites and legacy article favorites from server truth.
// v9 (2026-05-08): /sync cards now carry card-level word_count and
// reading_minutes. Reset card rows once so existing cached cards receive
// the new display + Atlas sizing fields.
export const CACHE_DATA_VERSION = 9;

export interface ArticleContentRow {
  article_id: string;
  content_html: string | null;
  updated_at: string;
}

export interface SyncStateRow {
  key: string;
  value: string;
}

export interface CurationCacheSchema extends DBSchema {
  cards: {
    key: string; // card_id
    value: CachedCard;
    indexes: {
      by_routing: string;
      by_card_date: string;
      by_updated: string;
    };
  };
  wechat_articles: {
    key: string; // article_id
    value: ArticleContentRow;
  };
  wechat_subscriptions: {
    key: number; // id
    value: CachedAccount;
  };
  favorites: {
    key: [string, string]; // [item_type, item_id]
    value: CachedFavorite;
    indexes: { by_created: string };
  };
  sync_state: {
    key: string;
    value: SyncStateRow;
  };
}
