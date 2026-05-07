// IndexedDB schema for the web build's local cache. Mirrors the desktop's
// SQLite tables (src-tauri/src/db.rs) so the same /sync delta payload writes
// into either backend without per-platform shaping.
//
// Bump DB_VERSION every time we change the shape of any object store
// (column equivalent) OR need to wipe stale data after a server-side schema
// change — same pattern as the desktop's `card_id_format_v2_ulid` marker.
// The `upgrade` callback in idb.ts switches on `oldVersion` to apply the
// right one-shot for each version transition.
import type { DBSchema } from "idb";
import type { CachedCard, CachedFavorite, CachedAccount } from "../cache";

// Web cache v3 intentionally uses a new IndexedDB database name instead of
// another in-place upgrade. The previous cache could be blocked by an old tab
// during large clear-and-resync migrations, leaving the inbox query pending on
// first paint. A fresh DB opens immediately, then /sync repopulates it page by
// page just like the desktop app.
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
export const DB_VERSION = 7;

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
