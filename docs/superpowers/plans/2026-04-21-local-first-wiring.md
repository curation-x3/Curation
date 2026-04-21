# Local-First Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all inbox/card/favorite reads and writes through the already-built local SQLite + sync engine so the UI never waits on HTTP for business data.

**Architecture:** Rewrite React Query `queryFn`s to call Tauri `invoke()` against existing commands (`get_inbox_cards`, `search_cards`, `mark_read`, `toggle_favorite`, `run_sync`, …). Fill small Rust gaps only when a hook genuinely needs something not yet exposed. No schema changes. Server becomes sync peer only. Chat tables (`chat_sessions`, `chat_messages`) are left untouched — additive migrations only.

**Tech Stack:** React 19, TanStack Query v5, Tauri 2, Rust + rusqlite (encrypted), FTS5. Spec: `docs/superpowers/specs/2026-04-21-local-first-wiring-design.md`.

**Testing note:** `curation-app` has no automated UI test suite. Each task is verified by running `npm run tauri dev` and exercising the feature manually against a populated local DB. The plan specifies concrete manual-verification steps in place of unit tests.

---

### Task 0: Discovery pass — answer the four open questions

This is a read-only task to eliminate uncertainty before touching hooks. No commits.

**Files:**
- Read: `src-tauri/src/db.rs` (all)
- Read: `src-tauri/src/sync.rs` (all)
- Read: `src-tauri/src/commands.rs` (all)
- Read: `curation-server/server.py:1226-1330` (sync endpoint + related)
- Read: `curation-server/pg_database.py:1734-1820` (sync query)

- [ ] **Step 1: Resolve `useCardContent` fallback path**

In `src-tauri/src/db.rs`, confirm whether `cards` table has `content_md` column populated by sync. Check `sync.rs::pull_data` to see which server fields are written. Record findings as a comment to carry into Task 4:

- Does the sync engine write markdown content into `cards.content_md`? (YES/NO)
- Does `get_cached_article` return the right thing for a `card_id`? (YES/NO — if NO, note the Tauri command we'll need)

- [ ] **Step 2: Resolve discarded storage**

Search for `discarded` in `src-tauri/src/db.rs` and `src-tauri/src/sync.rs`. Record:

- Is there a `discarded_items` table locally? (YES/NO)
- If NO, is discarded data syncable from server? Check `/sync` response fields.
- Decision: add `discarded_items` table + command, or fall back to server fetch for the discarded view only.

- [ ] **Step 3: Resolve `queue_status` handling**

In `src-tauri/src/sync.rs`, check whether the synced `CachedCard` carries `queue_status`. It almost certainly doesn't (it's ephemeral server state). Confirm. Then decide between:

- (a) Keep a lightweight `/queue/status` poll with 10s `refetchInterval` inside `useInbox`, merging `{article_id → status}` onto local data.
- (b) Drop the list-spinner in v1 and rely on the existing WebSocket triggering sync on completion.

Record chosen option.

- [ ] **Step 4: Confirm sync progressivity**

In `src-tauri/src/sync.rs::pull_data`, confirm each cursor page is upserted in its own transaction (not accumulated client-side). If pages commit as they land, the "first 今天/昨天 then backfill" UX works for free. If not, note needed change.

- [ ] **Step 5: Summarize findings**

Write a 10-20 line comment block into the top of this plan file (under this task) recording the four answers. This comment is referenced by later tasks. Commit the annotated plan:

```bash
git add docs/superpowers/plans/2026-04-21-local-first-wiring.md
git commit -m "plan: record local-first discovery findings"
```

---

## Task 0 Findings

**Q1: useCardContent fallback**
- YES: `cards` table has `content_md` column (db.rs:117)
- YES: `sync.rs::pull_data` writes `card["content"]` → `content_md` via `upsert_cards` (sync.rs:128, db.rs:410)
- `get_cached_article` returns HTML only (db.rs:271, queries `articles.content_html`), not markdown
- **Bottom line:** NO — `getCachedArticle(cardId)` is wrong. Need Tauri command `get_card_content(card_id)` → `cards.content_md` from db.rs. Task 4 must add this.

**Q2: Discarded storage**
- NO: No `discarded_items` table in db.rs schema
- NO: `/sync` filters to `["ai_curation", "original_push"]` only (pg_database.py:1784), excludes `"discard"` routing
- NO: sync.rs does not upsert discarded locally
- **Bottom line:** NO — discarded unreachable locally. Minimum fix: add `discarded_items` table, sync endpoint param, query + upsert in apply_pull_result. Defer to Task 5; for v1 fall back to server fetch.

**Q3: Queue status**
- NO: `CachedCard` (CardRow in db.rs:11-24) has no `queue_status` field
- NO: `/sync` response (pg_database.py:1850) returns no queue_status (only cards, articles, favorites, cursor, has_more, sync_ts)
- YES: `/queue` endpoint exists (server.py:1661) returning full queue state via `db.get_queue_all()`; NO lightweight `/queue/status` endpoint
- **Bottom line:** For v1, choose option (b): drop list spinner, rely on WebSocket + sync completion to update. Cheap poll (option a) feasible in Task 8 only if `/queue/status` endpoint added server-side (out of scope here).

**Q4: Sync progressivity**
- NO: `pull_data` accumulates all pages in memory (sync.rs:96-98 `all_cards/articles/favorites`), then `apply_pull_result` commits once at end (sync.rs:171-194)
- Each cursor page does NOT commit separately
- Frontend cannot see per-page progress; only single callback on full completion
- **Bottom line:** Progressivity deferred — pages batch-commit at end. UX impact: inbox won't show "today's" items first while older backfill runs; entire sync-result appears together. Acceptable for v1 (most users have < 500 pending items). To improve: refactor `apply_pull_result` to split cards/articles/favs per page and commit within the loop (sync.rs ~175).

---

### Task 1: Rewrite `useInbox` to read from local SQLite

**Files:**
- Modify: `src/hooks/useInbox.ts`
- Modify: `src/lib/cache.ts` (only if Task 0 Step 3 chose option (a) and a new helper is needed)

- [ ] **Step 1: Add a projection helper**

In `src/hooks/useInbox.ts`, add a pure function near the top (below imports):

```ts
import type { CachedCard } from "../lib/cache";

function cachedToInbox(c: CachedCard): InboxItem {
  return {
    card_id: c.card_id,
    article_id: c.article_id,
    title: c.title ?? "",
    description: c.description,
    routing: (c.routing as InboxItem["routing"]) ?? null,
    article_date: c.article_date,
    read_at: c.read_at,
    queue_status: null, // populated by queue-status overlay, see Task 8
    article_meta: {
      account: c.account ?? "",
      author: c.author,
      publish_time: null, // not stored locally today; acceptable for v1
      url: c.url,
    },
  };
}
```

- [ ] **Step 2: Swap `useInbox` queryFn to local read**

Replace lines 12-28 of `src/hooks/useInbox.ts`:

```ts
import { getInboxCards } from "../lib/cache";

export function useInbox(accountId?: number | null, unreadOnly?: boolean) {
  return useQuery<InboxItem[]>({
    queryKey: ["inbox", "local", accountId ?? "all", unreadOnly ?? false],
    queryFn: async () => {
      // account filter currently works by account_id (numeric) on server;
      // local uses account name string. For v1 we ignore accountId filter
      // and filter client-side in the view if needed. See Task 8 for details.
      const rows = await getInboxCards(null, unreadOnly ?? false);
      return rows.map(cachedToInbox);
    },
    staleTime: 0,
    refetchInterval: false, // progress updates arrive via sync invalidation
  });
}
```

Note: the `staleTime: 0` is intentional — local reads are cheap and we want invalidations (from sync) to re-run instantly.

- [ ] **Step 3: Manually verify**

Run `npm run tauri dev`. Open app. Confirm:

- Inbox renders in < 300ms on a cold start (after DB open)
- Date groups (今天/昨天/本周/…) populate correctly
- No `/inbox` HTTP request appears in the network tab (DevTools → Network, filter `inbox`)

If date-grouping breaks because `article_date` is null, that indicates a sync gap — note and fix in sync.rs, not here.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useInbox.ts
git commit -m "feat(inbox): read list from local SQLite via Tauri"
```

---

### Task 2: Route inbox mutations through `sync_queue`

**Files:**
- Modify: `src/hooks/useInbox.ts` (mutations at lines 41-75)
- Modify: `src/lib/cache.ts` (add missing bindings if needed)
- Modify: `src-tauri/src/commands.rs` (add `mark_unread` and `mark_all_read` Tauri commands if missing)

- [ ] **Step 1: Audit existing Rust commands**

In `src-tauri/src/commands.rs`, grep for `mark_read`, `mark_unread`, `mark_all_read`, `toggle_favorite`. Record which exist. Example result: "mark_read and toggle_favorite exist; mark_unread and mark_all_read missing."

- [ ] **Step 2: Add missing Rust commands (if any)**

If `mark_unread` is missing, add to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub async fn mark_unread(
    state: tauri::State<'_, AppState>,
    card_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.set_read_at(&card_id, None).map_err(|e| e.to_string())?;
    db.enqueue_sync("mark_unread", &card_id).map_err(|e| e.to_string())?;
    Ok(())
}
```

If `mark_all_read` is missing, add an analogous batch command taking `Vec<String>`. Register both in `lib.rs::run()` alongside the existing `mark_read` registration.

On the Rust DB side, ensure `set_read_at` and `enqueue_sync` exist in `db.rs` — if not, add them following the pattern of the existing `mark_read` path. The sync engine at `sync.rs` must know how to push `mark_unread` (map to `POST /cards/:id/unread`). Add the mapping in `push_sync_queue`.

- [ ] **Step 3: Bind new commands in `cache.ts`**

Add to `src/lib/cache.ts`:

```ts
export function markCardUnread(cardId: string): Promise<void> {
  return invoke("mark_unread", { cardId });
}

export function markAllCardsRead(cardIds: string[]): Promise<void> {
  return invoke("mark_all_read", { cardIds });
}
```

- [ ] **Step 4: Rewrite mutations to local-first**

Replace `useMarkCardReadSingle`, `useMarkCardUnread`, `useMarkAllRead` in `src/hooks/useInbox.ts`:

```ts
import { markCardRead, markCardUnread as markUnreadLocal, markAllCardsRead as markAllLocal } from "../lib/cache";

export function useMarkCardReadSingle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => markCardRead(cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}

export function useMarkCardUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => markUnreadLocal(cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardIds: string[]) => markAllLocal(cardIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox", "local"] });
    },
  });
}
```

Delete the now-unused `apiFetch` and `markAllCardsRead` imports from `src/lib/api.ts` at the top of the file if nothing else uses them.

- [ ] **Step 5: Manually verify**

Run `npm run tauri dev`. Confirm:

- Clicking a card marks it read in the UI **in the same frame** (no spinner)
- Right-click → "标为未读" works instantly
- 分组 header → "全部已读" updates the whole bucket instantly
- Network tab shows zero `/cards/.../read` calls from the UI; the background sync worker makes the POST a moment later
- If you kill the server before clicking, the UI still marks read; restart the server and the change propagates

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useInbox.ts src/lib/cache.ts src-tauri/src/commands.rs src-tauri/src/db.rs src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "feat(inbox): route read/unread mutations through local sync_queue"
```

Only stage the Rust files you actually modified. Use explicit paths, not `git add -A`.

---

### Task 3: Rewrite `useFavorites` to local-first

**Files:**
- Modify: `src/hooks/useFavorites.ts`
- Modify: `src/lib/cache.ts` (confirm `toggleFavoriteLocal` exists; it does per cache.ts:67)

- [ ] **Step 1: Read current shape**

Read `src/hooks/useFavorites.ts` and `src/types.ts` around `FavoriteItem` (types.ts:190-201) to see what the UI consumes.

- [ ] **Step 2: Rewrite fetch**

Replace the `useFavorites` body with a local read that joins cached favorites against cached cards:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFavorites, getInboxCards, toggleFavoriteLocal, type CachedFavorite } from "../lib/cache";
import type { FavoriteItem } from "../types";

export function useFavorites() {
  return useQuery<FavoriteItem[]>({
    queryKey: ["favorites", "local"],
    queryFn: async () => {
      const [favs, cards] = await Promise.all([getFavorites(), getInboxCards(null, false)]);
      const cardsById = new Map(cards.map((c) => [c.card_id, c]));
      return favs.map((f: CachedFavorite) => {
        const c = f.item_type === "card" ? cardsById.get(f.item_id) : undefined;
        return {
          item_type: f.item_type,
          item_id: f.item_id,
          created_at: f.created_at,
          title: c?.title ?? "",
          article_meta: c
            ? { account: c.account ?? "", author: c.author, publish_time: null, url: c.url }
            : { account: "", author: null, publish_time: null, url: null },
          deleted: false,
        };
      });
    },
    staleTime: 0,
  });
}
```

Adjust the projection fields to match your actual `FavoriteItem` shape (read `types.ts` first).

- [ ] **Step 3: Rewrite mutations**

```ts
export function useAddFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: "card" | "article"; itemId: string }) =>
      toggleFavoriteLocal(itemType, itemId, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites", "local"] }),
  });
}

export function useRemoveFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemType, itemId }: { itemType: "card" | "article"; itemId: string }) =>
      toggleFavoriteLocal(itemType, itemId, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites", "local"] }),
  });
}
```

Match the existing mutation signatures exactly — do not change the call sites yet.

- [ ] **Step 4: Manually verify**

`npm run tauri dev`. In the favorites panel:

- Favorites appear instantly on open
- Clicking ★ on an inbox card adds/removes favorite with no network round-trip
- Removing a favorite from the favorites panel propagates to the star indicator in inbox within the same frame

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFavorites.ts
git commit -m "feat(favorites): read and mutate through local SQLite"
```

---

### Task 4: Card content — local read with lazy server fallback

**Files:**
- Modify: `src/hooks/useCards.ts` (card-content query)
- Modify: `src/lib/cache.ts` (add `getCardContent` if `getCachedArticle` is the wrong shape)

This task depends on Task 0 Step 1's answer.

- [ ] **Step 1: Identify the existing card-content hook**

Grep `src/hooks/useCards.ts` and `src/hooks/*.ts` for `fetchCardContent`. Record the hook name (e.g. `useCardContent(cardId)`) and the data shape it returns (markdown string, object with `content` + `card_id`, etc.).

- [ ] **Step 2: Decide local-read API**

If Task 0 Step 1 found that `cards.content_md` is populated by sync and `getCachedArticle(cardId)` returns it correctly, use that. Otherwise add a Rust command:

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub async fn get_card_content(
    state: tauri::State<'_, AppState>,
    card_id: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock().await;
    db.get_card_content(&card_id).map_err(|e| e.to_string())
}
```

…with a matching `get_card_content` in `db.rs` that selects `content_md` from `cards` where `card_id = ?`. Register in `lib.rs`. Add binding to `cache.ts`:

```ts
export function getCardContent(cardId: string): Promise<string | null> {
  return invoke("get_card_content", { cardId });
}
```

- [ ] **Step 3: Rewrite the hook**

In `src/hooks/useCards.ts` (or wherever `useCardContent` lives), replace the HTTP `queryFn` with:

```ts
import { getCardContent } from "../lib/cache";
import { fetchCardContent } from "../lib/api";

export function useCardContent(cardId: string | null) {
  return useQuery({
    queryKey: ["card-content", cardId],
    enabled: !!cardId,
    staleTime: Infinity,
    queryFn: async () => {
      if (!cardId) return null;
      const local = await getCardContent(cardId);
      if (local) return { card_id: cardId, content: local };
      // Fallback: not yet synced — fetch once, cache will be populated on next sync tick
      const remote = await fetchCardContent(cardId);
      return remote;
    },
  });
}
```

Keep the return shape identical to what the caller expects. If the caller expects the full card object, shape it accordingly.

- [ ] **Step 4: Manually verify**

- Opening a synced card: content appears in < 100ms with zero network requests
- Opening a very fresh card (synced meta but content not yet pulled — rare window): content appears after one HTTP round-trip, then next open is instant
- Closing the server and opening previously-seen cards: still works

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCards.ts src/lib/cache.ts src-tauri/src/commands.rs src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(reader): serve card content from local cache with lazy fallback"
```

---

### Task 5: Discarded items — local read

**Files:**
- Depends on Task 0 Step 2 answer.
- Modify: `src/hooks/useInbox.ts` (`useDiscarded`)
- Possibly modify: `src-tauri/src/db.rs`, `commands.rs`, `sync.rs`, `lib.rs`

- [ ] **Step 1: Branch on Task 0 finding**

- If **discarded items already flow through `/sync`** and live locally: add a `get_discarded_items` Tauri command that queries the appropriate table/view, bind it in `cache.ts`, and rewrite `useDiscarded` to use it (same pattern as Task 1).
- If **discarded items are NOT synced**: leave `useDiscarded` calling `fetchDiscarded()` but document it in the hook as "server-only for now; low-priority to localize". No code changes beyond a short comment.

Execute whichever branch Task 0 selected.

- [ ] **Step 2: Manually verify or document**

If rewritten: switch to the discarded view and confirm instant load. If deferred: confirm the view still works as before (no regression from earlier changes), add the comment, move on.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useInbox.ts  # plus any Rust files
git commit -m "feat(discarded): read from local cache"   # or "chore(discarded): document deferred localization"
```

---

### Task 6: Bootstrap sequence audit

**Files:**
- Read/Modify: `src/App.tsx`
- Read: `src/hooks/useSync.ts`
- Read: `src/lib/cache.ts::openDbFromKeychain`, `initDbWithLogin`

- [ ] **Step 1: Trace current boot order**

Open `src/App.tsx`. Identify the order in which the following happen during boot:

1. Auth token restored from keychain
2. `openDbFromKeychain()` / `initDbWithLogin()` called
3. React Query provider mounted
4. Hooks start querying
5. `useSync` mounted (WebSocket + `run_sync()` called)

Write the current order out as a 5-line note.

- [ ] **Step 2: Verify shell renders before sync**

The goal from the spec:

```
1. Read auth token from keychain
2. openDbFromKeychain()          ◄── blocks shell
3. Render UI (instant local reads)
4. Start useSync (WS + heartbeat)
5. Trigger run_sync() once on mount
6. Sync upserts land → query invalidation → UI re-reads
```

Adjust `App.tsx` only if the actual order blocks on HTTP (e.g. an `await fetchInbox()` in a top-level effect). Small reorder if needed; do not restructure.

- [ ] **Step 3: Add "首次同步中…" banner for empty-DB case**

In the top-level layout (likely `App.tsx` or a header component), add a one-line banner that appears when:

- The first-ever sync is in progress
- AND the local card count is 0

Use a lightweight signal — e.g. a `useQuery(["sync", "first-run"])` that reads a `sync_state` flag, or a simpler React state set when `run_sync()` is kicked off before any local rows exist.

Style: subtle, top-of-content, italic — fits the "Typesetter" aesthetic already established. Example:

```tsx
{isFirstSync && (
  <div className="sync-banner">首次同步中…内容会陆续出现。</div>
)}
```

Add matching CSS in `App.css` next to the other header styles. Small, unobtrusive.

- [ ] **Step 4: Manually verify**

- Simulate first run by clearing the local SQLite (`rm -rf ~/Library/Application\ Support/<bundle>/*.db` or equivalent — confirm the actual path before running). Open app. Confirm UI shell renders immediately with banner, and items stream in.
- Subsequent open: banner does not appear, UI is instant.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(bootstrap): render shell before sync, add first-run banner"
```

---

### Task 7: Inbox local search (FTS5)

**Files:**
- Modify: `src/components/InboxList.tsx`
- Modify: `src/hooks/useInbox.ts` (add `useInboxSearch` hook)

- [ ] **Step 1: Add the search hook**

Append to `src/hooks/useInbox.ts`:

```ts
import { searchCards, type SearchResult } from "../lib/cache";

export function useInboxSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<SearchResult[]>({
    queryKey: ["inbox-search", trimmed],
    enabled: trimmed.length >= 2,
    queryFn: () => searchCards(trimmed),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Wire the existing search input to FTS**

In `src/components/InboxList.tsx`, the component already has a `search` state (lines 150, 174-182). Currently that filter runs client-side against the already-loaded list. Extend it to:

- When `search.trim().length >= 2`: call `useInboxSearch(search)`, map results through a projection that matches the row renderer (title, account, article_date, card_id), and render that list instead of the grouped view.
- When search is empty or 1 char: render the existing grouped view.

Debounce the input with a 150ms `useDeferredValue` or a manual `setTimeout` — pick whichever matches existing patterns in the codebase.

```ts
const deferredSearch = useDeferredValue(search);
const { data: searchHits } = useInboxSearch(deferredSearch);

const isSearching = deferredSearch.trim().length >= 2;
```

Render branch:

```tsx
{isSearching ? (
  <div className="list-content">
    {(searchHits ?? []).map((hit) => (
      <InboxItemRow
        key={hit.card_id}
        item={searchResultToInbox(hit)}
        isSelected={selectedId === hit.card_id}
        isFavorite={hit.is_favorite}
        onSelect={() => onSelect(hit.card_id, "card")}
        onContextMenu={() => {}}
      />
    ))}
  </div>
) : (
  /* existing grouped render */
)}
```

Add `searchResultToInbox` as a small helper above the component.

- [ ] **Step 3: Manually verify**

- Type 2+ Chinese chars or English words that appear in card titles → list switches to ranked search results
- Clear the input → grouped view returns
- Search across content body (not just title) — FTS5 index covers body per `db.rs`

- [ ] **Step 4: Commit**

```bash
git add src/components/InboxList.tsx src/hooks/useInbox.ts
git commit -m "feat(inbox): local FTS5 search"
```

---

### Task 8: Queue status handling

Execute the branch decided in Task 0 Step 3.

**Files (option a — light poll overlay):**
- Modify: `src/hooks/useInbox.ts`
- Add: new thin `fetchQueueStatus()` in `src/lib/api.ts` if not already present

**Files (option b — no list spinner in v1):**
- No code changes; just verify analyzing-state UI still works from sync. Skip the task.

- [ ] **Step 1 (option a only): Add a status endpoint caller**

```ts
// src/lib/api.ts
export async function fetchQueueStatus(): Promise<Array<{ article_id: string; status: "pending" | "running" }>> {
  const r = await apiFetch("/queue/status");
  const j = await r.json();
  return j.data ?? [];
}
```

Confirm the endpoint exists or create a thin one server-side (out of scope if it exists already — check first).

- [ ] **Step 2 (option a): Overlay onto `useInbox`**

In `src/hooks/useInbox.ts`:

```ts
import { fetchQueueStatus } from "../lib/api";

function useQueueStatusMap() {
  const { data } = useQuery({
    queryKey: ["queue-status"],
    queryFn: fetchQueueStatus,
    refetchInterval: 10_000,
  });
  return new Map((data ?? []).map((e) => [e.article_id, e.status]));
}
```

Compose in `useGroupedInbox`:

```ts
export function useGroupedInbox(accountId?: number | null, unreadOnly?: boolean) {
  const { data: items, ...rest } = useInbox(accountId, unreadOnly);
  const statusMap = useQueueStatusMap();
  const annotated = useMemo(() => {
    if (!items) return [];
    return items.map((i) => ({ ...i, queue_status: statusMap.get(i.article_id) ?? null }));
  }, [items, statusMap]);
  const groups = useMemo(() => groupByDateBucket(annotated), [annotated]);
  return { groups, items: annotated, ...rest };
}
```

- [ ] **Step 3: Manually verify**

Trigger an analysis run on an article. Confirm the list row gets the spinner tag within ~10s and loses it when the run finishes.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useInbox.ts src/lib/api.ts
git commit -m "feat(inbox): overlay queue status from lightweight poll"
```

---

### Task 9: End-to-end smoke test

**Files:** none modified. Verification only.

- [ ] **Step 1: Full matrix check**

With `npm run tauri dev` running against the real server:

| Scenario | Expected |
|---|---|
| Cold open (populated DB) | Inbox visible < 300ms, no `/inbox` HTTP call |
| Card open (synced) | Content < 100ms, no HTTP |
| Mark read | UI updates same frame |
| Favorite toggle | UI updates same frame |
| Search "测试" | FTS results < 50ms |
| Server killed, click around | All reads work, mutations queue up |
| Server restarted | Queued mutations push within 60s (heartbeat) |
| Fresh install (delete DB) | Shell renders immediately, banner appears, items stream in |
| Chat feature | Opens existing sessions, sends messages, persists — unchanged |

- [ ] **Step 2: Chat regression check**

Specifically confirm that after this entire plan is merged:

- Previous chat sessions are still in the DB (open a card that had chat history → history appears)
- New chat works
- `chat_sessions.card_id` still resolves to the right card after all the re-reads

If any check fails, stop and diagnose — do not proceed to release.

- [ ] **Step 3: Final commit (docs only)**

If any small cleanup notes emerged (dead imports, obsolete `api.ts` exports now unused), do one cleanup commit:

```bash
git add src/lib/api.ts  # etc
git commit -m "chore: remove now-unused server-first inbox client calls"
```

---

## Self-Review

- **Spec coverage:** Goal & data flow → Task 1-5. Mutations via sync_queue → Task 2, 3. Bootstrap sequence → Task 6. Search UI → Task 7. Queue status edge case → Task 8. Chat protection → explicit check in Task 9 + every Rust migration step is additive only. All four open questions resolved in Task 0. Non-goals respected (no server changes, no new sync strategy, no eviction).
- **Placeholder scan:** No TBDs. Every code block is concrete. Task 0 findings feed concrete branches in Tasks 4, 5, 8. Task 5 explicitly offers two outcomes, both of which are actionable.
- **Type consistency:** `CachedCard`, `CachedFavorite`, `SearchResult`, `InboxItem`, `FavoriteItem` are consistent across tasks. `queueKey` strings unified to `["inbox", "local", …]` for invalidation.
- **Testing:** This codebase has no unit test infra; manual verification steps included in every task. Chat regression check in Task 9 is the key safety net.
