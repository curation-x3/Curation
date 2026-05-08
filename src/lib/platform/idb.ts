// Web-only IndexedDB wrapper for the local cache. Mirrors the desktop's
// SQLite layer in src-tauri/src/db.rs: same row shapes, same /sync delta
// flow, same logout-clears-everything contract.
//
// All readers go through this module — UI components never call idb
// directly. Schema lives in idb-schema.ts; keep IndexedDB's native version for
// object-store shape only. Data invalidation lives in sync_state so a stale tab
// cannot block app startup during wipe-and-resync migrations.
import { openDB, type IDBPDatabase } from "idb";
import type { CachedCard, CachedFavorite, CachedAccount } from "../cache";
import {
  CACHE_DATA_VERSION,
  DB_NAME as BASE_DB_NAME,
  type ArticleContentRow,
  type CurationCacheSchema,
} from "./idb-schema";

let _dbPromise: Promise<IDBPDatabase<CurationCacheSchema>> | null = null;
let _migrationPromise: Promise<void> | null = null;
let _cacheUserScope: string | null = null;

const DATA_VERSION_KEY = "cache_data_version";
const BOOTSTRAP_COMPLETE_KEY = "sync_bootstrap_complete";
const CACHE_STORES = [
  "cards",
  "wechat_articles",
  "wechat_subscriptions",
  "favorites",
  "sync_state",
] as const;

function normalizeScope(scope: string | null | undefined): string | null {
  const trimmed = scope?.trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return safe.length > 0 ? safe : null;
}

function activeDbName(): string {
  return _cacheUserScope ? `${BASE_DB_NAME}__u_${_cacheUserScope}` : BASE_DB_NAME;
}

export function getCacheUserScopeKey(): string {
  return _cacheUserScope ?? "default";
}

export function setCacheUserScope(scope: string | null | undefined): void {
  const nextScope = normalizeScope(scope);
  if (nextScope === _cacheUserScope) return;

  const previousDb = _dbPromise;
  _cacheUserScope = nextScope;
  _dbPromise = null;
  _migrationPromise = null;

  previousDb
    ?.then((db) => db.close())
    .catch(() => {});
}

function closeForVersionChange(
  db: IDBPDatabase<CurationCacheSchema>,
  dbPromise: Promise<IDBPDatabase<CurationCacheSchema>>,
): void {
  db.addEventListener("versionchange", () => {
    db.close();
    if (_dbPromise === dbPromise) {
      _dbPromise = null;
      _migrationPromise = null;
    }
    console.warn("[cache.web] IndexedDB connection closed for versionchange");
  });
}

function openCacheDb(): Promise<IDBPDatabase<CurationCacheSchema>> {
  if (!_dbPromise) {
    const dbName = activeDbName();
    const dbPromise = openDB<CurationCacheSchema>(dbName, undefined, {
      upgrade(db, oldVersion) {
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
      },
      blocked(currentVersion, blockedVersion) {
        console.warn(
          `[cache.web] IndexedDB open blocked (${currentVersion} → ${blockedVersion}); waiting for old tab`,
        );
      },
      terminated() {
        if (_dbPromise === dbPromise) {
          _dbPromise = null;
          _migrationPromise = null;
        }
        console.warn("[cache.web] IndexedDB connection terminated");
      },
    })
      .then((db) => {
        closeForVersionChange(db, dbPromise);
        return db;
      })
      .catch((error) => {
        if (_dbPromise === dbPromise) {
          _dbPromise = null;
          _migrationPromise = null;
        }
        throw error;
      });
    _dbPromise = dbPromise;
  }
  return _dbPromise;
}

function parseVersion(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function getAppliedDataVersion(
  db: IDBPDatabase<CurationCacheSchema>,
): Promise<number> {
  const row = await db.get("sync_state", DATA_VERSION_KEY).catch(() => null);
  const markerVersion = parseVersion(row?.value);
  if (markerVersion != null) return Math.min(markerVersion, CACHE_DATA_VERSION);

  // Older builds used IndexedDB's native version number for wipe-only cache
  // migrations. Use it once as the bootstrap marker, then keep future data
  // invalidations inside sync_state so old tabs do not block first paint.
  return Math.min(db.version, CACHE_DATA_VERSION);
}

async function runDataMigrations(
  db: IDBPDatabase<CurationCacheSchema>,
): Promise<void> {
  const fromVersion = await getAppliedDataVersion(db);
  if (fromVersion >= CACHE_DATA_VERSION) return;

  const tx = db.transaction(CACHE_STORES, "readwrite");
  const clearStore = (
    name: "cards" | "wechat_articles" | "wechat_subscriptions" | "favorites",
  ) => tx.objectStore(name).clear();
  const resetSyncCursor = () => {
    tx.objectStore("sync_state").delete("last_sync_ts");
    tx.objectStore("sync_state").delete(BOOTSTRAP_COMPLETE_KEY);
  };

  if (fromVersion < 2) {
    clearStore("cards");
    clearStore("wechat_articles");
    clearStore("favorites");
    resetSyncCursor();
  }
  if (fromVersion < 3) {
    clearStore("cards");
    clearStore("wechat_articles");
    resetSyncCursor();
  }
  if (fromVersion < 4) {
    clearStore("cards");
    clearStore("wechat_articles");
    resetSyncCursor();
  }
  if (fromVersion < 5) {
    clearStore("cards");
    clearStore("wechat_articles");
    resetSyncCursor();
  }
  if (fromVersion < 6) {
    clearStore("cards");
    clearStore("wechat_articles");
    resetSyncCursor();
  }
  if (fromVersion < 7) {
    clearStore("cards");
    clearStore("wechat_articles");
    resetSyncCursor();
  }
  if (fromVersion < 8) {
    clearStore("favorites");
    resetSyncCursor();
  }
  if (fromVersion < 9) {
    clearStore("cards");
    resetSyncCursor();
  }

  tx.objectStore("sync_state").put({
    key: DATA_VERSION_KEY,
    value: String(CACHE_DATA_VERSION),
  });
  await tx.done;
  console.info(`[cache.web] migrated data cache ${fromVersion} → ${CACHE_DATA_VERSION}`);
}

async function ensureDataMigrations(
  db: IDBPDatabase<CurationCacheSchema>,
): Promise<void> {
  if (!_migrationPromise) {
    _migrationPromise = runDataMigrations(db).catch((error) => {
      _migrationPromise = null;
      throw error;
    });
  }
  return _migrationPromise;
}

async function getDb(): Promise<IDBPDatabase<CurationCacheSchema>> {
  const db = await openCacheDb();
  await ensureDataMigrations(db);
  return db;
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

export async function countVisibleCards(): Promise<number> {
  return (await readCards({})).length;
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

export async function deleteSyncState(key: string): Promise<void> {
  const db = await getDb();
  await db.delete("sync_state", key);
}

// ---------------------------------------------------------------------------
// Wipe (logout)
// ---------------------------------------------------------------------------

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    CACHE_STORES,
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("cards").clear(),
    tx.objectStore("wechat_articles").clear(),
    tx.objectStore("wechat_subscriptions").clear(),
    tx.objectStore("favorites").clear(),
    tx.objectStore("sync_state").clear(),
  ]);
  await tx.objectStore("sync_state").put({
    key: DATA_VERSION_KEY,
    value: String(CACHE_DATA_VERSION),
  });
  await tx.done;
}
