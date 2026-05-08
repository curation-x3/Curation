// Web platform cache. Mirrors cache.tauri.ts surface but stores rows in
// IndexedDB instead of encrypted SQLite. The wire protocol with the server
// is identical: runSync() pulls /sync deltas using a cursor in
// sync_state.last_sync_ts and writes them into IDB; readers like
// getInboxCards read IDB only.
//
// See docs/superpowers/specs/2026-05-04-web-indexeddb-cache-design.md.

import type { CachedCard, CachedFavorite, SearchResult, CachedAccount } from "../cache";
import type { FavoriteItem } from "../../types";
import { apiFetch } from "../api";
import * as idb from "./idb";
import { resolveSyncSince } from "./sync-policy";

const SYNC_PAGE_EVENT = "sync-page-committed";

let syncBroadcast: BroadcastChannel | null = null;
let syncBroadcastName: string | null = null;

function syncChannelName(): string {
  return `curation-cache:${idb.getCacheUserScopeKey()}`;
}

function ensureSyncBroadcast(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const name = syncChannelName();
  if (syncBroadcast && syncBroadcastName === name) return syncBroadcast;

  syncBroadcast?.close();
  syncBroadcastName = name;
  syncBroadcast = new BroadcastChannel(name);
  syncBroadcast.onmessage = (event) => {
    const msg = event.data;
    if (msg?.type !== SYNC_PAGE_EVENT || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(SYNC_PAGE_EVENT, { detail: msg.detail }));
  };
  return syncBroadcast;
}

function emitSyncPageCommitted(detail: {
  changedKeys: string[];
  cards: number;
  favorites: number;
}): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNC_PAGE_EVENT, { detail }));
  }
  ensureSyncBroadcast()?.postMessage({ type: SYNC_PAGE_EVENT, detail });
}

export function initDbWithSecret(_secret: string): Promise<void> {
  return Promise.resolve();
}

export function setCacheUserScope(scope: string | null): Promise<void> {
  idb.setCacheUserScope(scope);
  ensureSyncBroadcast();
  return Promise.resolve();
}

export function setCacheAuthToken(_token: string): Promise<void> {
  return Promise.resolve();
}

export function setApiBase(_apiBase: string): Promise<void> {
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Reads — all hit IDB, never the network.
// ---------------------------------------------------------------------------

export async function getInboxCards(
  biz?: string | null,
  unreadOnly?: boolean,
): Promise<CachedCard[]> {
  const rows = await idb.readCards({ biz: biz ?? undefined, unreadOnly: unreadOnly ?? false });
  console.log(`[cache.web] getInboxCards(biz=${biz ?? "null"}, unread=${unreadOnly ?? false}) → ${rows.length} rows`);
  return rows;
}

export async function getFavorites(): Promise<CachedFavorite[]> {
  return idb.readFavorites();
}

export async function loadFavoriteItems(): Promise<FavoriteItem[]> {
  // Join across favorites + cards (no separate articles join needed since
  // CachedCard already has the article_meta fields denormalized).
  const [favs, allCards] = await Promise.all([
    idb.readFavorites(),
    idb.readCards({}),
  ]);
  const cardById = new Map(allCards.map((c) => [c.card_id, c]));
  const sorted = [...favs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return sorted.map((f): FavoriteItem => {
    const c = f.item_type === "card" ? cardById.get(f.item_id) : undefined;
    return {
      item_type: f.item_type,
      item_id: f.item_id,
      created_at: f.created_at,
      title: c?.title ?? null,
      description: c?.description ?? null,
      word_count: c?.word_count ?? null,
      reading_minutes: c?.reading_minutes ?? null,
      routing: (c?.routing as FavoriteItem["routing"]) ?? null,
      article_id: c?.article_id ?? null,
      article_title: c?.article_title ?? null,
      article_account: c?.account ?? null,
      article_meta: c
        ? {
            title: c.article_title ?? "",
            url: c.url ?? "",
            publish_time: c.publish_time,
            author: c.author,
            account: c.account ?? "",
            biz: c.biz,
            cover_url: c.cover_url,
            digest: c.digest,
          }
        : null,
    };
  });
}

export function searchCards(_query: string): Promise<SearchResult[]> {
  // No FTS in IndexedDB. Web search keeps hitting the server (see spec).
  return Promise.resolve([]);
}

export async function getCardContent(cardId: string): Promise<string | null> {
  // Direct PK lookup. content_md is populated by /sync so card opens are
  // local-cache reads.
  const card = await idb.getCardById(cardId);
  return card?.content_md ?? null;
}

export async function setCardContent(cardId: string, contentMd: string): Promise<void> {
  // Legacy fallback API kept for compatibility with older call sites.
  await idb.updateCardRow(cardId, { content_md: contentMd });
}

export async function getCachedAccounts(): Promise<CachedAccount[]> {
  // First-load fallback: if IDB is empty, prime it from /accounts.
  const local = await idb.readSubscriptions();
  if (local.length > 0) return local;
  const res = await apiFetch(`/accounts`);
  if (!res.ok) throw new Error(`GET /accounts failed: ${res.status}`);
  const data = await res.json();
  const rows: CachedAccount[] = data.status === "ok" ? data.data : [];
  if (rows.length > 0) await idb.writeSubscriptionDelta(rows);
  return rows;
}

export function saveCachedAccounts(_accounts: Record<string, unknown>[]): Promise<number> {
  return Promise.resolve(0);
}

export async function getCachedDiscoverableAccounts(): Promise<Record<string, unknown>[]> {
  // Discoverable accounts are a discovery-time list, not synced state — keep
  // them as a network call. They're not heavy.
  const res = await apiFetch(`/accounts/discoverable`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.status === "ok" ? data.data : [];
}

export function saveCachedDiscoverableAccounts(
  _accounts: Record<string, unknown>[],
): Promise<number> {
  return Promise.resolve(0);
}

// ---------------------------------------------------------------------------
// Mutations — server first, then mirror to IDB so the UI doesn't have to
// wait for a /sync round-trip to see the change.
// ---------------------------------------------------------------------------

export async function markCardRead(cardId: string): Promise<void> {
  const res = await apiFetch(`/cards/${encodeURIComponent(cardId)}/read`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`mark_read failed: ${res.status}`);
  await idb.updateCardRow(cardId, { read_at: new Date().toISOString() });
}

export async function markCardUnread(cardId: string): Promise<void> {
  const res = await apiFetch(`/cards/mark-unread`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_ids: [cardId] }),
  });
  if (!res.ok) throw new Error(`mark_unread failed: ${res.status}`);
  await idb.updateCardRow(cardId, { read_at: null });
}

export async function markAllCardsRead(cardIds: string[]): Promise<void> {
  const res = await apiFetch(`/cards/mark-all-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card_ids: cardIds }),
  });
  if (!res.ok) throw new Error(`mark_all_read failed: ${res.status}`);
  const now = new Date().toISOString();
  await Promise.all(cardIds.map((id) => idb.updateCardRow(id, { read_at: now })));
}

export async function toggleFavoriteLocal(
  itemType: string,
  itemId: string,
  isFavorited: boolean,
): Promise<void> {
  // `isFavorited` is the CURRENT state — toggling means flipping it.
  if (itemType === "card") {
    const res = await apiFetch(`/cards/${encodeURIComponent(itemId)}/favorite`, {
      method: isFavorited ? "DELETE" : "POST",
    });
    if (!res.ok) throw new Error(`toggle_favorite failed: ${res.status}`);
    if (isFavorited) {
      await idb.deleteFavorite("card", itemId);
    } else {
      await idb.writeFavoriteDelta([
        {
          item_type: "card",
          item_id: itemId,
          created_at: new Date().toISOString(),
          synced: 1,
        },
      ]);
    }
    return;
  }

  const endpoint = isFavorited ? `/favorites/batch-delete` : `/favorites/batch`;
  const res = await apiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ item_type: itemType, item_id: itemId }] }),
  });
  if (!res.ok) throw new Error(`toggle_favorite failed: ${res.status}`);
  if (isFavorited) {
    await idb.deleteFavorite(itemType as "card" | "article", itemId);
  } else {
    await idb.writeFavoriteDelta([
      {
        item_type: itemType as "card" | "article",
        item_id: itemId,
        created_at: new Date().toISOString(),
        synced: 1,
      },
    ]);
  }
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

const LAST_SYNC_TS_KEY = "last_sync_ts";
const BOOTSTRAP_COMPLETE_KEY = "sync_bootstrap_complete";
const FIRST_PAGE_SIZE = 50;
const FOLLOWUP_PAGE_SIZE = 200;

interface SyncBatch {
  cards?: CachedCard[];
  favorites?: Array<{ item_type: string; item_id: string; created_at: string; deleted: boolean }>;
  cursor?: number | null;
  has_more?: boolean;
  sync_ts?: string;
}

export async function runSync(): Promise<string[]> {
  return withSyncLock(runSyncUnlocked);
}

interface LockManagerLike {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withLocalStorageLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof localStorage === "undefined") return fn();

  const key = `curation:${name}:lock`;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const ttlMs = 30_000;
  const waitUntil = Date.now() + 10_000;

  while (Date.now() < waitUntil) {
    const now = Date.now();
    const raw = localStorage.getItem(key);
    let locked = false;
    if (raw) {
      try {
        locked = JSON.parse(raw).expiresAt > now;
      } catch {
        locked = false;
      }
    }

    if (!locked) {
      localStorage.setItem(key, JSON.stringify({ token, expiresAt: now + ttlMs }));
      try {
        if (JSON.parse(localStorage.getItem(key) ?? "{}").token === token) {
          return await fn();
        }
      } finally {
        const latest = localStorage.getItem(key);
        if (latest) {
          try {
            if (JSON.parse(latest).token === token) localStorage.removeItem(key);
          } catch {
            localStorage.removeItem(key);
          }
        }
      }
    }

    await delay(120);
  }

  console.warn("[sync] lock wait timed out; proceeding without exclusive localStorage lock");
  return fn();
}

async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const name = `curation-sync:${idb.getCacheUserScopeKey()}`;
  const lockManager = typeof navigator !== "undefined"
    ? (navigator as Navigator & { locks?: LockManagerLike }).locks
    : undefined;
  if (lockManager?.request) {
    return lockManager.request(name, { mode: "exclusive" }, fn);
  }
  return withLocalStorageLock(name, fn);
}

async function runSyncUnlocked(): Promise<string[]> {
  const lastSyncTs = await idb.getSyncState(LAST_SYNC_TS_KEY);
  const localVisibleCardCount = await idb.countVisibleCards();
  const bootstrapComplete = (await idb.getSyncState(BOOTSTRAP_COMPLETE_KEY)) === "1";
  const since = resolveSyncSince({
    lastSyncTs,
    localVisibleCardCount,
    bootstrapComplete,
  });
  const changed = new Set<string>();
  let syncUntil: string | null = null;
  let cardsReceived = 0;

  const fetchPage = async (cursor: number | null): Promise<SyncBatch> => {
    const params = new URLSearchParams();
    params.set("limit", String(cursor == null ? FIRST_PAGE_SIZE : FOLLOWUP_PAGE_SIZE));
    if (since) params.set("since", since);
    if (syncUntil) params.set("until", syncUntil);
    if (cursor != null) params.set("cursor", String(cursor));
    const res = await apiFetch(`/sync?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`/sync failed: ${res.status}`);
    }
    return res.json();
  };

  const commitPage = async (data: SyncBatch): Promise<string[]> => {
    const pageChanged = new Set<string>();

    if (data.cards && data.cards.length > 0) {
      cardsReceived += data.cards.length;
      await idb.writeCardDelta(data.cards);
      changed.add("cards");
      pageChanged.add("cards");

      // Card favorites live in card_deliveries.favorited_at on the server.
      // Mirror that inline state into the local favorites store so Favorites,
      // ReaderPane, search, and Atlas all read one local shape.
      for (const card of data.cards) {
        if (!card.card_id || !("favorited_at" in card)) continue;
        if (card.favorited_at) {
          await idb.writeFavoriteDelta([
            {
              item_type: "card",
              item_id: card.card_id,
              created_at: card.favorited_at,
              synced: 1,
            },
          ]);
        } else {
          await idb.deleteFavorite("card", card.card_id);
        }
      }
      changed.add("favorites");
      pageChanged.add("favorites");
    }

    if (data.favorites && data.favorites.length > 0) {
      // Server returns deletions inline as { deleted: true }; split apart.
      const live = data.favorites.filter((f) => !f.deleted);
      const dead = data.favorites.filter((f) => f.deleted);
      if (live.length > 0) {
        await idb.writeFavoriteDelta(
          live.map((f) => ({
            item_type: f.item_type as "card" | "article",
            item_id: f.item_id,
            created_at: f.created_at,
            synced: 1,
          })),
        );
      }
      for (const f of dead) {
        await idb.deleteFavorite(f.item_type as "card" | "article", f.item_id);
      }
      changed.add("favorites");
      pageChanged.add("favorites");
    }

    const keys = Array.from(pageChanged);
    if (keys.length > 0) {
      emitSyncPageCommitted({
        changedKeys: keys,
        cards: data.cards?.length ?? 0,
        favorites: data.favorites?.length ?? 0,
      });
    }
    return keys;
  };

  let cursor: number | null = null;
  let pageCount = 0;

  do {
    const data = await fetchPage(cursor);
    if (!syncUntil) {
      if (!data.sync_ts) {
        throw new Error("/sync response missing sync_ts");
      }
      syncUntil = data.sync_ts;
    }
    await commitPage(data);
    pageCount += 1;

    const nextCursor = typeof data.cursor === "number" ? data.cursor : null;
    if (data.has_more === true && nextCursor == null) {
      throw new Error("/sync returned has_more without cursor");
    }
    if (nextCursor != null && nextCursor === cursor) {
      throw new Error(`/sync cursor did not advance: ${cursor}`);
    }
    cursor = data.has_more === true ? nextCursor : null;
  } while (cursor != null);

  if (pageCount > 1) {
    console.log(`[sync] completed ${pageCount} pages`);
  }
  if (syncUntil) {
    await idb.setSyncState(LAST_SYNC_TS_KEY, syncUntil);
    if (since == null && cardsReceived === 0) {
      await idb.setSyncState(BOOTSTRAP_COMPLETE_KEY, "1");
    } else if (cardsReceived > 0) {
      await idb.deleteSyncState(BOOTSTRAP_COMPLETE_KEY);
    }
  }

  return Array.from(changed);
}
