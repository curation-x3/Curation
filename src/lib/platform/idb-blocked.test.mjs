// Run: npm exec --yes tsx --test src/lib/platform/idb-blocked.test.mjs
//
// Reproduces a production failure mode where an older tab keeps the current
// IndexedDB connection open while a newly deployed bundle tries to bump the
// cache DB version for a wipe-only migration. The UI must not wait forever.
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CACHE_DATA_VERSION, DB_NAME } from "./idb-schema.ts";

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteCacheDb() {
  const request = indexedDB.deleteDatabase(DB_NAME);
  await requestToPromise(request);
}

function createStores(db, tx) {
  const cards = db.createObjectStore("cards", { keyPath: "card_id" });
  cards.createIndex("by_routing", "routing");
  cards.createIndex("by_card_date", "card_date");
  cards.createIndex("by_updated", "updated_at");

  db.createObjectStore("wechat_articles", { keyPath: "article_id" });
  db.createObjectStore("wechat_subscriptions", { keyPath: "id" });

  const favorites = db.createObjectStore("favorites", {
    keyPath: ["item_type", "item_id"],
  });
  favorites.createIndex("by_created", "created_at");

  db.createObjectStore("sync_state", { keyPath: "key" });

  tx.objectStore("cards").put({
    card_id: "old-card",
    article_id: "old-article",
    title: "Old cached card",
    article_title: "Old article",
    content_md: null,
    additional_content: null,
    description: null,
    routing: "ai_curation",
    template: null,
    template_reason: null,
    card_date: "2026-05-08",
    account: null,
    author: null,
    url: null,
    read_at: null,
    updated_at: "2026-05-08T00:00:00Z",
    publish_time: null,
    account_id: null,
    biz: null,
    cover_url: null,
    digest: null,
    word_count: null,
    is_original: null,
    entities: null,
  });
}

async function openOldSchemaConnection() {
  const request = indexedDB.open(DB_NAME, CACHE_DATA_VERSION - 1);
  request.onupgradeneeded = () => createStores(request.result, request.transaction);
  return requestToPromise(request);
}

test("readCards settles when a stale connection blocks a wipe-only version bump", async () => {
  await deleteCacheDb();
  const staleConnection = await openOldSchemaConnection();
  try {
    const idb = await import("./idb.ts");
    const rows = await Promise.race([
      idb.readCards({}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("readCards timed out")), 250)),
    ]);

    assert.deepEqual(rows.map((row) => row.card_id), []);
  } finally {
    staleConnection.close();
  }
});
