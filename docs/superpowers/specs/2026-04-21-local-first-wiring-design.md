---
title: Local-First Wiring
date: 2026-04-21
status: draft
---

# Local-First Wiring

## Problem

App feels slow on open. Root cause is not missing infrastructure — it's that the UI never uses the infrastructure that already exists.

**What already works (untouched by this project):**

- Rust-side encrypted SQLite with `cards`, `articles`, `favorites`, `sync_queue`, `sync_state`, and `cards_fts` (FTS5) tables — `src-tauri/src/db.rs`
- Sync engine: `SyncClient::pull_data()` pulls `/sync?since=…` with cursor pagination; `push_sync_queue()` drains queued mutations — `src-tauri/src/sync.rs`
- Server `/sync?since=` endpoint returning upserts + soft deletes across cards/articles/favorites — `curation-server/server.py:1226`, `pg_database.py:1734`
- WebSocket `sync_available` push + 5-minute heartbeat fallback — `src/hooks/useSync.ts`
- Tauri commands exposed: `get_inbox_cards`, `get_favorites`, `search_cards`, `mark_read`, `toggle_favorite`, `get_cached_article`, `run_sync` — `src/lib/cache.ts`

**What is broken:**

Every read hook still calls the HTTP API directly and ignores local SQLite:

- `useInbox` → `fetchInbox()` HTTP (`src/hooks/useInbox.ts:16`)
- `useDiscarded` → `fetchDiscarded()` HTTP
- `useFavorites` → `fetchFavorites()` HTTP
- `useArticles`, `useCards`, card-content queries → HTTP
- Mutations (`mark read`, `mark unread`, `favorite`, `unfavorite`) bypass `sync_queue`; no optimistic update — a click waits on server round-trip

Cold start therefore always blocks on `/inbox` for the full dataset, and every card open blocks on `/cards/:id/content`. Local DB is populated (sync runs) but unread.

## Goal

Make reads instantaneous (always served from local SQLite) and writes non-blocking (optimistic → queue → background push). Server becomes a sync peer, not the UI's data source.

## Non-goals

- Admin surfaces stay server-first: `/queue`, `/runs/:id`, `/articles/:id/runs`, run stream logs, backend list. These are ops views, low traffic, not worth caching.
- No schema changes on server or Rust side. No new Tauri commands unless a gap surfaces during implementation.
- No eviction policy. SQLite keeps everything.
- No new sync strategies (WebSocket signal + heartbeat stays).

## Design

### Data flow (after)

```
UI hook ── read ──► Tauri invoke ──► SQLite (local)
                                       ▲
                                       │ upsert
WebSocket sync_available ─► run_sync() ─► /sync?since=T
                                       │
UI hook ── mutation ──► optimistic update ──► sync_queue ──► background push
                                                                   │
                                                                   ▼
                                                               server POST
```

One-way invariant: **UI never calls the server directly for read data**. The sync engine is the only HTTP client for business data.

### Hook rewrites

Each hook stays in place (same export signature, same return shape consumers already use) but its `queryFn` swaps HTTP for Tauri invoke. Projection to `InboxItem` / `DiscardedItem` / `FavoriteItem` happens in the hook so views don't change.

| Hook | New source | Notes |
|---|---|---|
| `useInbox(account, unreadOnly)` | `getInboxCards(account, unreadOnly)` | Project `CachedCard → InboxItem`; `queue_status` comes from a short-lived server probe only when a run is in flight (see below) |
| `useDiscarded()` | new Tauri command `get_discarded_items()` | Gap — add to `src-tauri/src/db.rs` + `src/lib/cache.ts`. Discarded is a stored server-side view; local needs its own table or joined query |
| `useFavorites()` | `getFavorites()` | Join against local cards for title/meta |
| `useCardContent(cardId)` | `getCachedArticle(cardId)` (or new `get_card_content`) | If null locally, fall back to `fetchCardContent` once and upsert on the way back — covers the "not yet synced" case |
| `useArticles()` / card lists by date | `get_inbox_cards` + client-side filter, or new `get_cards_by_date` if perf matters | Decide during implementation; keep SQL in Rust |

### Mutations (writes)

All four existing mutations move to the pattern:

1. Call local Tauri command (`mark_read`, `toggle_favorite`, …) — this updates SQLite and inserts into `sync_queue` atomically
2. Invalidate the relevant TanStack Query keys so the next read reflects the local change immediately
3. Background: sync engine drains `sync_queue` on next tick (already implemented in `push_sync_queue`)

No server POST from the UI thread. `markCardUnread`, `useMarkAllRead`, favorite add/remove all go through the queue. If the queue write itself fails (rare — local DB issue), surface an error toast; otherwise the UI trusts local.

Gaps to fill if missing: `mark_unread` Tauri command, `mark_all_read` batch command. Audit during implementation.

### Bootstrap sequence (app open)

```
1. Read auth token from keychain
2. openDbFromKeychain()               ◄── blocks UI shell render on this only
3. Render UI (hooks read local DB — instant, even if DB is empty the first time)
4. Start useSync (WS + heartbeat)
5. Trigger run_sync() once on mount
6. As sync upserts land, TanStack Query keys get invalidated → UI re-reads from local
```

First-ever launch (empty DB): UI renders an empty inbox immediately with a subtle top banner "首次同步中…"; groups and items fade in as the cursor-paginated sync lands. No full-screen spinner. This matches the user's "加载一部分就显示" ask.

### Search UI

FTS5 index exists. Add a search input in the inbox header (already present for title filter) that, when non-empty and length ≥ 2, switches the list from `getInboxCards` to `searchCards(query)` results. Project `SearchResult → InboxItem` for rendering. Highlight rendering can be deferred.

Debounce 150ms. No server call.

### Queue-status freshness (edge case)

`queue_status` on an `InboxItem` signals "analyzing" (spinner in list). That field is not synced — it's server-side ephemeral queue state. Keep the current 10-second `refetchInterval` from `useInbox`, but redirect it to a light-weight `/queue/status` poll that returns only `{article_id, status}` pairs for in-flight runs, and merge onto local data in the hook. Or accept a simpler v1: no queue spinner in list until the card is synced with its final routing. Decide during implementation; user-visible delta is small.

### Consistency with server

After `run_sync()` completes, any local row whose `updated_at` is older than the server's returned value gets overwritten. Single-user + single-active-device assumption makes this safe — no conflict resolution needed. Tombstones (soft-delete on `Favorite.deleted`) are honored by the sync engine already.

## Files expected to change

- `src/hooks/useInbox.ts` — rewrite `useInbox`, `useDiscarded`, all three mark-* mutations
- `src/hooks/useFavorites.ts` — rewrite fetch and mutations
- `src/hooks/useArticles.ts`, `src/hooks/useCards.ts` — rewrite read paths; leave admin-specific article endpoints alone
- `src/lib/cache.ts` — add any missing bindings (e.g. `mark_unread`, `get_discarded_items`)
- `src-tauri/src/db.rs` — add gap commands if `cache.ts` surfaces any
- `src/components/InboxList.tsx` — hook into `searchCards` when query non-empty (small addition; most logic stays)
- `src/App.tsx` — verify bootstrap sequence matches the 6-step list above

No changes in: `curation-server/*`, `curation-agent/*`, Rust sync client, WebSocket wiring, appearance system.

## Risks / open questions

1. **`queue_status` handling** — resolve during implementation (simple v1 vs. dedicated poll endpoint). Mark as decision point.
2. **`useCardContent` fallback** — is there a local table for markdown bodies today? If not, either extend `cards` with a `content_md` (already present per `CachedCard.content_md`) and ensure the sync engine populates it, or keep a lazy server fetch. Verify during first implementation step.
3. **Discarded items** — confirm whether these land in the `cards` table or need their own storage. Answer determines whether `get_discarded_items` is a filter or a new table.
4. **Mass data backfill** — on first launch the cursor-paginated sync may take minutes for an account with many cards. Acceptable per the "加载一部分就显示" direction, but confirm the sync engine emits progressive upserts (not one big commit at the end).

Each of these is answered by reading the current code during the first implementation task, not by further design.

## Success criteria

- Cold start: inbox list visible < 300ms (no HTTP in the critical path)
- Opening any already-synced card: content visible < 100ms
- Marking read / toggling favorite: UI updates in the same frame; no spinner
- Offline (server unreachable): reads still work, writes queue up, UI shows a subtle sync-paused indicator
- Search: local FTS results < 50ms for multi-hundred-card corpus
