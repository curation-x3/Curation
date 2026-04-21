use crate::db::{CacheDb, SyncQueueItem};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

pub struct SyncClient {
    client: reqwest::Client,
}

impl SyncClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("failed to build reqwest client");
        Self { client }
    }

    /// Push pending local changes to the server.
    ///
    /// Groups consecutive items with the same action into a single batch HTTP
    /// request each, reducing N POSTs to at most one per action-run.
    pub async fn push_sync_queue(
        &self,
        base_url: &str,
        items: &[SyncQueueItem],
        token: &str,
    ) -> Vec<(i64, Result<(), String>)> {
        let mut results: Vec<(i64, Result<(), String>)> = Vec::with_capacity(items.len());
        let mut i = 0;
        while i < items.len() {
            let action = items[i].action.as_str();
            // Find the end of the contiguous run of the same action.
            let mut j = i + 1;
            while j < items.len() && items[j].action == action {
                j += 1;
            }
            let run = &items[i..j];
            let run_results = self.push_run(base_url, action, run, token).await;
            results.extend(run_results);
            i = j;
        }
        results
    }

    /// Dispatch a run of same-action items to the appropriate batch helper.
    async fn push_run(
        &self,
        base_url: &str,
        action: &str,
        run: &[SyncQueueItem],
        token: &str,
    ) -> Vec<(i64, Result<(), String>)> {
        match action {
            "mark_read" | "mark_unread" => {
                self.push_card_batch(base_url, action, run, token).await
            }
            "add_favorite" | "remove_favorite" => {
                self.push_favorite_batch(base_url, action, run, token).await
            }
            other => run
                .iter()
                .map(|it| (it.id, Err(format!("unknown sync action: {}", other))))
                .collect(),
        }
    }

    /// Batch-push card read/unread actions.
    ///
    /// `mark_read`   → POST /cards/mark-all-read  (returns `{ok: true}`)
    /// `mark_unread` → POST /cards/mark-unread    (returns `{results: [{id, ok, error?}]}`)
    async fn push_card_batch(
        &self,
        base_url: &str,
        action: &str,
        run: &[SyncQueueItem],
        token: &str,
    ) -> Vec<(i64, Result<(), String>)> {
        // Parse payloads; items that fail to parse are immediately marked Err
        // and excluded from the batch body.
        let mut card_ids: Vec<String> = Vec::with_capacity(run.len());
        let mut item_ids: Vec<i64> = Vec::with_capacity(run.len());
        let mut pre_errors: Vec<(i64, Result<(), String>)> = Vec::new();

        for item in run {
            match serde_json::from_str::<serde_json::Value>(&item.payload) {
                Ok(v) => {
                    let cid = v["card_id"].as_str().unwrap_or_default().to_string();
                    card_ids.push(cid);
                    item_ids.push(item.id);
                }
                Err(e) => {
                    pre_errors.push((item.id, Err(e.to_string())));
                }
            }
        }

        // If every item failed to parse, return early.
        if card_ids.is_empty() {
            return pre_errors;
        }

        let path = if action == "mark_read" {
            "/cards/mark-all-read"
        } else {
            "/cards/mark-unread"
        };
        let url = format!("{}{}", base_url, path);
        let body = serde_json::json!({ "card_ids": card_ids });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await;

        // Compute per-item results for the successfully-parsed batch.
        let batch_results: Vec<(i64, Result<(), String>)> = match resp {
            Ok(r) if r.status().is_success() => {
                let json_body: serde_json::Value = match r.json().await {
                    Ok(v) => v,
                    Err(e) => {
                        let msg = e.to_string();
                        // Return pre_errors + all-fail for batch items.
                        let mut out = pre_errors;
                        out.extend(item_ids.iter().map(|id| (*id, Err(msg.clone()))));
                        return out;
                    }
                };

                if action == "mark_read" {
                    // /cards/mark-all-read returns {ok: true} — treat all as success.
                    item_ids.iter().map(|id| (*id, Ok(()))).collect()
                } else {
                    // /cards/mark-unread returns {results: [{id, ok, error?}]}.
                    let results_arr =
                        json_body["results"].as_array().cloned().unwrap_or_default();
                    let mut by_cid: std::collections::HashMap<String, Result<(), String>> =
                        std::collections::HashMap::new();
                    for r in results_arr {
                        let cid = r["id"].as_str().unwrap_or_default().to_string();
                        let ok = r["ok"].as_bool().unwrap_or(false);
                        let err = r["error"].as_str().unwrap_or("").to_string();
                        by_cid.insert(cid, if ok { Ok(()) } else { Err(err) });
                    }
                    card_ids
                        .iter()
                        .zip(item_ids.iter())
                        .map(|(cid, iid)| {
                            (*iid, by_cid.remove(cid).unwrap_or(Ok(())))
                        })
                        .collect()
                }
            }
            Ok(r) => {
                let status = r.status();
                item_ids
                    .iter()
                    .map(|iid| (*iid, Err(format!("batch {} status {}", path, status))))
                    .collect()
            }
            Err(e) => {
                let msg = e.to_string();
                item_ids.iter().map(|iid| (*iid, Err(msg.clone()))).collect()
            }
        };

        // The early-return above moves pre_errors when needed; here we only
        // reach if pre_errors was NOT moved, so we can safely extend and return.
        let mut out = pre_errors;
        out.extend(batch_results);
        out
    }

    /// Batch-push favorites add/remove actions.
    ///
    /// `add_favorite`    → POST /favorites/batch        (returns `{results: [{id: item_id, ok, error?}]}`)
    /// `remove_favorite` → POST /favorites/batch-delete (same shape)
    async fn push_favorite_batch(
        &self,
        base_url: &str,
        action: &str,
        run: &[SyncQueueItem],
        token: &str,
    ) -> Vec<(i64, Result<(), String>)> {
        // Parse payloads; items that fail to parse are immediately marked Err.
        let mut items_body: Vec<serde_json::Value> = Vec::with_capacity(run.len());
        let mut item_ids: Vec<i64> = Vec::with_capacity(run.len());
        // Parallel vec of item_id strings for result mapping (order-preserving).
        let mut fav_ids: Vec<String> = Vec::with_capacity(run.len());
        let mut pre_errors: Vec<(i64, Result<(), String>)> = Vec::new();

        for item in run {
            match serde_json::from_str::<serde_json::Value>(&item.payload) {
                Ok(v) => {
                    let item_type = v["item_type"].as_str().unwrap_or_default().to_string();
                    let item_id = v["item_id"].as_str().unwrap_or_default().to_string();
                    fav_ids.push(item_id.clone());
                    items_body.push(serde_json::json!({
                        "item_type": item_type,
                        "item_id": item_id,
                    }));
                    item_ids.push(item.id);
                }
                Err(e) => {
                    pre_errors.push((item.id, Err(e.to_string())));
                }
            }
        }

        if items_body.is_empty() {
            return pre_errors;
        }

        let path = if action == "add_favorite" {
            "/favorites/batch"
        } else {
            "/favorites/batch-delete"
        };
        let url = format!("{}{}", base_url, path);
        let body = serde_json::json!({ "items": items_body });

        let resp = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await;

        let batch_results: Vec<(i64, Result<(), String>)> = match resp {
            Ok(r) if r.status().is_success() => {
                let body: serde_json::Value = match r.json().await {
                    Ok(v) => v,
                    Err(e) => {
                        let msg = e.to_string();
                        return item_ids
                            .iter()
                            .map(|id| (*id, Err(msg.clone())))
                            .collect();
                    }
                };
                // Results keyed by item_id string.
                let results_arr =
                    body["results"].as_array().cloned().unwrap_or_default();
                let mut by_fav_id: std::collections::HashMap<String, Result<(), String>> =
                    std::collections::HashMap::new();
                for r in results_arr {
                    let fid = r["id"].as_str().unwrap_or_default().to_string();
                    let ok = r["ok"].as_bool().unwrap_or(false);
                    let err = r["error"].as_str().unwrap_or("").to_string();
                    by_fav_id.insert(fid, if ok { Ok(()) } else { Err(err) });
                }
                fav_ids
                    .iter()
                    .zip(item_ids.iter())
                    .map(|(fid, iid)| {
                        (*iid, by_fav_id.remove(fid).unwrap_or(Ok(())))
                    })
                    .collect()
            }
            Ok(r) => {
                let status = r.status();
                item_ids
                    .iter()
                    .map(|iid| (*iid, Err(format!("batch {} status {}", path, status))))
                    .collect()
            }
            Err(e) => {
                let msg = e.to_string();
                item_ids.iter().map(|iid| (*iid, Err(msg.clone()))).collect()
            }
        };

        pre_errors.extend(batch_results);
        pre_errors
    }

    /// Pull remote changes since the given timestamp, committing each page to
    /// `db_arc` immediately and emitting a `sync-page-committed` Tauri event so
    /// the UI can invalidate queries without waiting for all pages.
    ///
    /// `db_arc` is `Arc<Mutex<Option<CacheDb>>>` so no guard is held across the
    /// async fetch — the lock is acquired and released around each page apply.
    ///
    /// Returns the union of changed keys across all pages.
    pub async fn pull_and_commit<F>(
        &self,
        base_url: &str,
        token: &str,
        since: Option<&str>,
        db_arc: &Arc<Mutex<Option<CacheDb>>>,
        mut on_page_committed: F,
    ) -> Result<Vec<String>, String>
    where
        F: FnMut(&[String], usize, usize) + Send,
    {
        let mut all_changed: HashSet<String> = HashSet::new();

        // Pass 1: pipelined pull — 2 page fetches in flight concurrently.
        // Server cursor is offset-based (returns `cursor + limit`) so we can
        // predict the next cursor without waiting for the server response,
        // letting us prefetch page N+1 while we're applying page N.
        {
            let base = base_url.to_string();
            let tok = token.to_string();
            let since_s = since.map(|s| s.to_string());
            let client = self.client.clone();

            // Kick off page 1 (cursor = None) and, speculatively, page 2
            // (cursor = PAGE_SIZE). If the dataset only has one page, page 2
            // simply returns empty — harmless.
            let spawn = |cur: Option<String>| {
                let c = client.clone();
                let b = base.clone();
                let t = tok.clone();
                let s = since_s.clone();
                tokio::spawn(async move {
                    fetch_page_raw(&c, &b, &t, s.as_deref(), cur.as_deref()).await
                })
            };

            let mut in_flight: std::collections::VecDeque<tokio::task::JoinHandle<Result<serde_json::Value, String>>> =
                std::collections::VecDeque::new();
            in_flight.push_back(spawn(None));
            in_flight.push_back(spawn(Some(PAGE_SIZE.to_string())));
            let mut next_cursor: i64 = PAGE_SIZE * 2;
            let mut stop_scheduling = false;

            while let Some(handle) = in_flight.pop_front() {
                let body = handle.await.map_err(|e| e.to_string())??;
                let has_more = body["has_more"].as_bool().unwrap_or(false);

                // Schedule the next fetch BEFORE applying current page so the
                // network round-trip overlaps with the DB apply + emit.
                if has_more && !stop_scheduling {
                    in_flight.push_back(spawn(Some(next_cursor.to_string())));
                    next_cursor += PAGE_SIZE;
                } else if !has_more {
                    stop_scheduling = true;
                }

                let page = PullResult {
                    cards: body["cards"].as_array().cloned().unwrap_or_default(),
                    favorites: body["favorites"].as_array().cloned().unwrap_or_default(),
                    sync_ts: body["sync_ts"].as_str().map(|s| s.to_string()),
                };

                let changed = {
                    let guard = db_arc.lock().map_err(|e| e.to_string())?;
                    let db = guard.as_ref().ok_or("database not initialized")?;
                    apply_pull_result(db, &page)?
                };
                for k in &changed {
                    all_changed.insert(k.clone());
                }
                if !changed.is_empty() {
                    on_page_committed(&changed, page.cards.len(), page.favorites.len());
                }

                // If we decided to stop scheduling, drain any already-in-flight
                // speculative fetch, then break out of the loop. This ensures
                // the speculative page 2 fired when there was actually only 1
                // page doesn't leak — we still process its (empty) result.
                if stop_scheduling && in_flight.is_empty() {
                    break;
                }
            }
        }

        // Pass 2: backfill content_md for cards missing it, recent → older, batches of 50
        loop {
            // Read next batch of card_ids missing content_md (brief lock)
            let pending: Vec<String> = {
                let guard = db_arc.lock().map_err(|e| e.to_string())?;
                let db = guard.as_ref().ok_or("database not initialized")?;
                db.get_cards_missing_content(50)?
            };
            if pending.is_empty() {
                break;
            }

            let body = serde_json::json!({ "card_ids": pending });
            let url = format!("{}/cards/content", base_url);
            let resp = self.client.post(&url).bearer_auth(token).json(&body).send().await;

            let contents: serde_json::Map<String, serde_json::Value> = match resp {
                Ok(r) if r.status().is_success() => {
                    let j: serde_json::Value = match r.json().await {
                        Ok(v) => v,
                        Err(e) => { eprintln!("[sync] Pass2 parse: {}", e); continue; }
                    };
                    j["contents"].as_object().cloned().unwrap_or_default()
                }
                Ok(r) => { eprintln!("[sync] Pass2 batch status {}", r.status()); continue; }
                Err(e) => { eprintln!("[sync] Pass2 batch fetch: {}", e); continue; }
            };

            let now = chrono::Utc::now().to_rfc3339();
            let mut batch_success: usize = 0;
            {
                let guard = db_arc.lock().map_err(|e| e.to_string())?;
                let db = guard.as_ref().ok_or("database not initialized")?;
                for card_id in &pending {
                    if let Some(c) = contents.get(card_id).and_then(|v| v.as_str()) {
                        db.update_card_content(card_id, c, &now)?;
                        batch_success += 1;
                    }
                }
            }

            if batch_success > 0 {
                on_page_committed(&["cards".to_string()], batch_success, 0);
                all_changed.insert("cards".to_string());
            }
        }

        Ok(all_changed.into_iter().collect())
    }
}

const PAGE_SIZE: i64 = 50;

struct PullResult {
    cards: Vec<serde_json::Value>,
    favorites: Vec<serde_json::Value>,
    sync_ts: Option<String>,
}

/// Free-function variant so it can be called from `tokio::spawn` futures
/// (which require 'static captures — can't borrow &self).
async fn fetch_page_raw(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    since: Option<&str>,
    cursor: Option<&str>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/sync", base_url);
    let mut params: Vec<(&str, String)> = vec![("limit", PAGE_SIZE.to_string())];
    if let Some(s) = since {
        params.push(("since", s.to_string()));
    }
    if let Some(c) = cursor {
        params.push(("cursor", c.to_string()));
    }
    let resp = client
        .get(&url)
        .query(&params)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("sync pull failed: {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Apply a single page of pull results to the local DB. Returns changed keys.
fn apply_pull_result(
    db: &CacheDb,
    pull: &PullResult,
) -> Result<Vec<String>, String> {
    let mut changed: HashSet<String> = HashSet::new();

    if !pull.cards.is_empty() {
        db.upsert_cards(&pull.cards)?;
        changed.insert("cards".to_string());
    }
    if !pull.favorites.is_empty() {
        db.apply_favorites_sync(&pull.favorites)?;
        changed.insert("favorites".to_string());
    }
    if let Some(ref ts) = pull.sync_ts {
        db.set_sync_ts(ts)?;
    }

    Ok(changed.into_iter().collect())
}
