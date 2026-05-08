// Run: node --import tsx --test src/lib/platform/idb.test.mjs
//
// Tests the IDB wrapper against fake-indexeddb (no browser needed). Vitest
// isn't set up in this repo, so we use the built-in node:test runner with a
// tsx loader to import the .ts module directly.
import "fake-indexeddb/auto";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const idb = await import("./idb.ts");
const {
  setCacheUserScope,
  readCards,
  writeCardDelta,
  updateCardRow,
  readArticleContent,
  writeArticleContent,
  readSubscriptions,
  writeSubscriptionDelta,
  readFavorites,
  writeFavoriteDelta,
  deleteFavorite,
  getSyncState,
  setSyncState,
  clearAll,
} = idb;

function card(card_id, overrides = {}) {
  return {
    card_id,
    article_id: "art-" + card_id,
    title: null,
    article_title: null,
    content_md: null,
    additional_content: null,
    description: null,
    routing: "ai_curation",
    template: null,
    template_reason: null,
    card_date: "2026-05-04",
    account: null,
    author: null,
    url: null,
    read_at: null,
    updated_at: "2026-05-04T10:00:00Z",
    publish_time: null,
    account_id: null,
    biz: null,
    cover_url: null,
    digest: null,
    word_count: null,
    is_original: null,
    entities: null,
    ...overrides,
  };
}

beforeEach(async () => {
  if (typeof setCacheUserScope === "function") {
    setCacheUserScope(null);
  }
  await clearAll();
});

test("cards: write + read round-trip", async () => {
  await writeCardDelta([card("01H1")]);
  const rows = await readCards({});
  assert.deepEqual(rows.map((r) => r.card_id), ["01H1"]);
});

test("cards: filters non-inbox routings", async () => {
  await writeCardDelta([
    card("01A", { routing: "ai_curation" }),
    card("01B", { routing: "discard" }),
  ]);
  const rows = await readCards({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_id, "01A");
});

test("cards: filters by biz", async () => {
  await writeCardDelta([
    card("01A", { biz: "biz-1" }),
    card("01B", { biz: "biz-2" }),
  ]);
  const rows = await readCards({ biz: "biz-1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_id, "01A");
});

test("cards: filters unread", async () => {
  await writeCardDelta([
    card("01A", { read_at: null }),
    card("01B", { read_at: "2026-05-04T11:00:00Z" }),
  ]);
  const rows = await readCards({ unreadOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_id, "01A");
});

test("cards: sorts by card_date desc", async () => {
  await writeCardDelta([
    card("oldA", { card_date: "2026-05-01" }),
    card("newB", { card_date: "2026-05-04" }),
    card("midC", { card_date: "2026-05-03" }),
  ]);
  const rows = await readCards({});
  assert.deepEqual(rows.map((r) => r.card_id), ["newB", "midC", "oldA"]);
});

test("cards: deduped delta replaces source cards and keeps source metadata", async () => {
  await writeCardDelta([
    card("srcA", { title: "source A" }),
    card("srcB", { title: "source B" }),
  ]);
  await writeCardDelta([
    card("dedupC", {
      kind: "deduped",
      source_card_ids: ["srcA", "srcB"],
      source_article_ids: ["art-srcA", "art-srcB"],
      title: "deduped",
    }),
  ]);

  const rows = await readCards({});
  assert.deepEqual(rows.map((r) => r.card_id), ["dedupC"]);
  assert.equal(rows[0].kind, "deduped");
  assert.deepEqual(rows[0].source_card_ids, ["srcA", "srcB"]);
  assert.deepEqual(rows[0].source_article_ids, ["art-srcA", "art-srcB"]);
});

test("updateCardRow: patches existing row", async () => {
  await writeCardDelta([card("01A", { read_at: null })]);
  await updateCardRow("01A", { read_at: "2026-05-04T12:00:00Z" });
  const rows = await readCards({});
  assert.equal(rows[0].read_at, "2026-05-04T12:00:00Z");
});

test("cards: additional_content round-trip and delta overwrite", async () => {
  await writeCardDelta([card("01A", {
    routing: "original_content_with_pre_card",
    additional_content: "<div>old</div>",
  })]);
  await writeCardDelta([card("01A", {
    routing: "original_content_with_pre_card",
    additional_content: "<div>new</div>",
  })]);
  const rows = await readCards({});
  assert.equal(rows[0].additional_content, "<div>new</div>");
});

test("cards: content_md round-trip and delta overwrite", async () => {
  await writeCardDelta([card("01A", { content_md: "old body" })]);
  await writeCardDelta([card("01A", { content_md: "new body" })]);
  const rows = await readCards({});
  assert.equal(rows[0].content_md, "new body");
});

test("updateCardRow: silent no-op for missing card_id", async () => {
  await updateCardRow("ghost", { read_at: "x" });
  assert.deepEqual(await readCards({}), []);
});

test("article content: round-trip", async () => {
  await writeArticleContent({
    article_id: "art-1",
    content_html: "<p>hi</p>",
    updated_at: "2026-05-04T10:00:00Z",
  });
  const got = await readArticleContent("art-1");
  assert.equal(got?.content_html, "<p>hi</p>");
});

test("article content: returns null when missing", async () => {
  assert.equal(await readArticleContent("ghost"), null);
});

test("subscriptions: write + read", async () => {
  await writeSubscriptionDelta([
    {
      id: 1,
      biz: "biz-1",
      name: "Test",
      avatar_url: null,
      description: null,
      last_monitored_at: null,
      article_count: 0,
      subscription_type: "subscribed",
      sync_count: 0,
    },
  ]);
  const rows = await readSubscriptions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].biz, "biz-1");
});

test("favorites: write, read, delete", async () => {
  await writeFavoriteDelta([
    { item_type: "card", item_id: "c1", created_at: "2026-05-04", synced: 1 },
    { item_type: "article", item_id: "a1", created_at: "2026-05-04", synced: 1 },
  ]);
  let rows = await readFavorites();
  assert.equal(rows.length, 2);
  await deleteFavorite("card", "c1");
  rows = await readFavorites();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item_type, "article");
});

test("sync_state: round-trip + null on miss", async () => {
  assert.equal(await getSyncState("missing"), null);
  await setSyncState("last_sync_ts", "2026-05-04T10:00:00Z");
  assert.equal(await getSyncState("last_sync_ts"), "2026-05-04T10:00:00Z");
});

test("cache scope: cards and sync cursor are isolated per user", async () => {
  assert.equal(typeof setCacheUserScope, "function");

  setCacheUserScope("user-a");
  await clearAll();
  await writeCardDelta([card("card-a")]);
  await setSyncState("last_sync_ts", "2026-05-08T01:00:00Z");

  setCacheUserScope("user-b");
  await clearAll();
  assert.deepEqual(await readCards({}), []);
  assert.equal(await getSyncState("last_sync_ts"), null);
  await writeCardDelta([card("card-b")]);
  await setSyncState("last_sync_ts", "2026-05-08T02:00:00Z");

  setCacheUserScope("user-a");
  assert.deepEqual((await readCards({})).map((row) => row.card_id), ["card-a"]);
  assert.equal(await getSyncState("last_sync_ts"), "2026-05-08T01:00:00Z");

  setCacheUserScope("user-b");
  assert.deepEqual((await readCards({})).map((row) => row.card_id), ["card-b"]);
  assert.equal(await getSyncState("last_sync_ts"), "2026-05-08T02:00:00Z");
});

test("clearAll: wipes every store", async () => {
  await writeCardDelta([card("01A")]);
  await writeArticleContent({ article_id: "art-1", content_html: "x", updated_at: "..." });
  await setSyncState("foo", "bar");
  await writeFavoriteDelta([{ item_type: "card", item_id: "c", created_at: "x", synced: 1 }]);
  await clearAll();
  assert.deepEqual(await readCards({}), []);
  assert.equal(await readArticleContent("art-1"), null);
  assert.equal(await getSyncState("foo"), null);
  assert.deepEqual(await readFavorites(), []);
});

test("writeCardDelta: empty array is no-op", async () => {
  await writeCardDelta([]);
  assert.deepEqual(await readCards({}), []);
});
