// Web-only IndexedDB wrapper for the local cache. Mirrors the desktop's
// SQLite layer in src-tauri/src/db.rs: same row shapes, same /sync delta
// flow, same logout-clears-everything contract.
//
// All readers go through this module — UI components never call idb
// directly. Schema lives in idb-schema.ts; bump DB_VERSION there and add
// an `if (oldVersion < N)` clause to the `upgrade` callback below for
// every breaking change.
import { openDB, type IDBPDatabase } from "idb";
import type { CachedCard, CachedFavorite, CachedAccount } from "../cache";
import {
  DB_NAME,
  DB_VERSION,
  type ArticleContentRow,
  type CurationCacheSchema,
} from "./idb-schema";

let _dbPromise: Promise<IDBPDatabase<CurationCacheSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CurationCacheSchema>> {
  if (!_dbPromise) {
    _dbPromise = openDB<CurationCacheSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const cards = db.createObjectStore("cards", { keyPath: "card_id" });
          cards.createIndex("by_routing", "routing");
          cards.createIndex("by_card_date", "card_date");
          cards.createIndex("by_updated", "updated_at");

          db.createObjectStore("wechat_articles", { keyPath: "article_id" });
          db.createObjectStore("wechat_subscriptions", { keyPath: "id" });

          const favs = db.createObjectStore("favorites", {
            keyPath: ["item_type", "item_id"],
          });
          favs.createIndex("by_created", "created_at");

          db.createObjectStore("sync_state", { keyPath: "key" });
        }
        if (oldVersion < 2) {
          // 2026-05-04: server /sync filter changed (see schema comment).
          // Wipe card-side state and last_sync_ts so next /sync rebuilds.
          // Subscriptions can stay — they're rebuilt on demand from
          // /accounts and don't depend on the new sync filter.
          const wipe = (name: "cards" | "wechat_articles" | "favorites") => {
            try { tx.objectStore(name).clear(); } catch { /* store may not exist on fresh installs */ }
          };
          wipe("cards");
          wipe("wechat_articles");
          wipe("favorites");
          try {
            tx.objectStore("sync_state").delete("last_sync_ts");
          } catch { /* ditto */ }
        }
        if (oldVersion < 3) {
          try { tx.objectStore("cards").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("wechat_articles").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("sync_state").delete("last_sync_ts"); } catch { /* store may not exist */ }
        }
        if (oldVersion < 4) {
          try { tx.objectStore("cards").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("wechat_articles").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("sync_state").delete("last_sync_ts"); } catch { /* store may not exist */ }
        }
        if (oldVersion < 5) {
          try { tx.objectStore("cards").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("wechat_articles").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("sync_state").delete("last_sync_ts"); } catch { /* store may not exist */ }
        }
        if (oldVersion < 6) {
          try { tx.objectStore("cards").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("wechat_articles").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("sync_state").delete("last_sync_ts"); } catch { /* store may not exist */ }
        }
        if (oldVersion < 7) {
          try { tx.objectStore("cards").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("wechat_articles").clear(); } catch { /* store may not exist */ }
          try { tx.objectStore("sync_state").delete("last_sync_ts"); } catch { /* store may not exist */ }
        }
      },
    });
  }
  return _dbPromise;
}

// Inbox-visible routings — must match server's get_inbox_cards filter.
const INBOX_ROUTINGS = new Set([
  "ai_curation",
  "original_content_with_pre_card",
  "original_content_with_post_card",
]);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function readCards(opts: {
  biz?: string | null;
  unreadOnly?: boolean;
}): Promise<CachedCard[]> {
  const db = await getDb();
  const all = await db.getAll("cards");
  return all
    .filter((c) => {
      if (!INBOX_ROUTINGS.has(c.routing ?? "")) return false;
      if (opts.biz && c.biz !== opts.biz) return false;
      if (opts.unreadOnly && c.read_at != null) return false;
      return true;
    })
    .sort((a, b) => (b.card_date ?? "").localeCompare(a.card_date ?? ""));
}

export async function writeCardDelta(rows: CachedCard[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const tx = db.transaction("cards", "readwrite");
  const superseded = new Set<string>();
  // Merge with existing row instead of full overwrite. Server /sync owns
  // content_md and additional_content; both should overwrite local values so
  // card bodies and original-rich-text render from cache.
  for (const r of rows) {
    if (r.kind === "deduped" && Array.isArray(r.source_card_ids) && r.source_card_ids.length > 0) {
      const sourceSet = new Set(r.source_card_ids);
      const existingCards = await tx.store.getAll();
      for (const existing of existingCards) {
        if (existing.card_id === r.card_id || existing.kind !== "deduped") continue;
        const existingSources = Array.isArray(existing.source_card_ids) ? existing.source_card_ids : [];
        if (existingSources.some((sourceId) => sourceSet.has(sourceId))) {
          await tx.store.delete(existing.card_id);
        }
      }
    }
    const existing = await tx.store.get(r.card_id);
    if (existing) {
      const merged: CachedCard = {
        ...existing,
        ...r,
        content_md: r.content_md ?? null,
        additional_content: r.additional_content ?? null,
      };
      await tx.store.put(merged);
    } else {
      await tx.store.put(r);
    }
    if (r.kind === "deduped" && Array.isArray(r.source_card_ids)) {
      for (const sourceId of r.source_card_ids) {
        if (sourceId !== r.card_id) superseded.add(sourceId);
      }
    }
  }
  for (const sourceId of superseded) {
    await tx.store.delete(sourceId);
  }
  await tx.done;
}

export async function getCardById(card_id: string): Promise<CachedCard | null> {
  const db = await getDb();
  return (await db.get("cards", card_id)) ?? null;
}

export async function updateCardRow(
  card_id: string,
  patch: Partial<CachedCard>,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("cards", "readwrite");
  const existing = await tx.store.get(card_id);
  if (existing) {
    await tx.store.put({ ...existing, ...patch });
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Article content
// ---------------------------------------------------------------------------

export async function readArticleContent(
  article_id: string,
): Promise<ArticleContentRow | null> {
  const db = await getDb();
  return (await db.get("wechat_articles", article_id)) ?? null;
}

export async function writeArticleContent(row: ArticleContentRow): Promise<void> {
  const db = await getDb();
  await db.put("wechat_articles", row);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function readSubscriptions(): Promise<CachedAccount[]> {
  const db = await getDb();
  return db.getAll("wechat_subscriptions");
}

export async function writeSubscriptionDelta(rows: CachedAccount[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const tx = db.transaction("wechat_subscriptions", "readwrite");
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function readFavorites(): Promise<CachedFavorite[]> {
  const db = await getDb();
  return db.getAll("favorites");
}

export async function writeFavoriteDelta(rows: CachedFavorite[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const tx = db.transaction("favorites", "readwrite");
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
}

export async function deleteFavorite(
  item_type: "card" | "article",
  item_id: string,
): Promise<void> {
  const db = await getDb();
  await db.delete("favorites", [item_type, item_id]);
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export async function getSyncState(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get("sync_state", key);
  return row?.value ?? null;
}

export async function setSyncState(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put("sync_state", { key, value });
}

// ---------------------------------------------------------------------------
// Wipe (logout)
// ---------------------------------------------------------------------------

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ["cards", "wechat_articles", "wechat_subscriptions", "favorites", "sync_state"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("cards").clear(),
    tx.objectStore("wechat_articles").clear(),
    tx.objectStore("wechat_subscriptions").clear(),
    tx.objectStore("favorites").clear(),
    tx.objectStore("sync_state").clear(),
  ]);
  await tx.done;
}
