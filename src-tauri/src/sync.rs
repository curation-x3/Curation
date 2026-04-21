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
    pub async fn push_sync_queue(
        &self,
        base_url: &str,
        items: &[SyncQueueItem],
        token: &str,
    ) -> Vec<(i64, Result<(), String>)> {
        let mut results = Vec::new();
        for item in items {
            let res = self.push_one(base_url, item, token).await;
            results.push((item.id, res));
        }
        results
    }

    async fn push_one(&self, base_url: &str, item: &SyncQueueItem, token: &str) -> Result<(), String> {
        let payload: serde_json::Value =
            serde_json::from_str(&item.payload).map_err(|e| e.to_string())?;

        match item.action.as_str() {
            "mark_read" => {
                let card_id = payload["card_id"].as_str().unwrap_or_default();
                let url = format!("{}/cards/{}/read", base_url, card_id);
                let resp = self
                    .client
                    .post(&url)
                    .bearer_auth(token)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    return Err(format!("mark_read failed: {}", resp.status()));
                }
            }
            "mark_unread" => {
                let card_id = payload["card_id"].as_str().unwrap_or_default();
                let url = format!("{}/cards/{}/unread", base_url, card_id);
                let resp = self
                    .client
                    .post(&url)
                    .bearer_auth(token)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    return Err(format!("mark_unread failed: {}", resp.status()));
                }
            }
            "add_favorite" => {
                let url = format!("{}/favorites", base_url);
                let resp = self
                    .client
                    .post(&url)
                    .bearer_auth(token)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    return Err(format!("add_favorite failed: {}", resp.status()));
                }
            }
            "remove_favorite" => {
                let item_type = payload["item_type"].as_str().unwrap_or_default();
                let item_id = payload["item_id"].as_str().unwrap_or_default();
                let url = format!("{}/favorites/{}/{}", base_url, item_type, item_id);
                let resp = self
                    .client
                    .delete(&url)
                    .bearer_auth(token)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    return Err(format!("remove_favorite failed: {}", resp.status()));
                }
            }
            other => {
                return Err(format!("unknown sync action: {}", other));
            }
        }
        Ok(())
    }

    /// Fetch a single page from /sync.
    async fn fetch_page(
        &self,
        base_url: &str,
        token: &str,
        since: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let url = format!("{}/sync", base_url);
        let mut params: Vec<(&str, String)> = vec![("limit", "500".to_string())];
        if let Some(s) = since {
            params.push(("since", s.to_string()));
        }
        if let Some(c) = cursor {
            params.push(("cursor", c.to_string()));
        }
        let resp = self
            .client
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
        F: FnMut(&[String]) + Send,
    {
        let mut all_changed: HashSet<String> = HashSet::new();
        let mut cursor: Option<String> = None;

        loop {
            // Async fetch — no lock held here.
            let body = self
                .fetch_page(base_url, token, since, cursor.as_deref())
                .await?;

            let page = PullResult {
                cards: body["cards"].as_array().cloned().unwrap_or_default(),
                articles: body["articles"].as_array().cloned().unwrap_or_default(),
                favorites: body["favorites"].as_array().cloned().unwrap_or_default(),
                sync_ts: body["sync_ts"].as_str().map(|s| s.to_string()),
            };

            // Brief synchronous lock to apply the page.
            let changed = {
                let guard = db_arc.lock().map_err(|e| e.to_string())?;
                let db = guard.as_ref().ok_or("database not initialized")?;
                apply_pull_result(db, &page)?
            };

            for k in &changed {
                all_changed.insert(k.clone());
            }
            if !changed.is_empty() {
                on_page_committed(&changed);
            }

            if body["has_more"].as_bool().unwrap_or(false) {
                if let Some(c) = body["cursor"].as_i64() {
                    cursor = Some(c.to_string());
                } else if let Some(c) = body["cursor"].as_str() {
                    cursor = Some(c.to_string());
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        Ok(all_changed.into_iter().collect())
    }
}

struct PullResult {
    cards: Vec<serde_json::Value>,
    articles: Vec<serde_json::Value>,
    favorites: Vec<serde_json::Value>,
    sync_ts: Option<String>,
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
    if !pull.articles.is_empty() {
        db.upsert_articles(&pull.articles)?;
        changed.insert("articles".to_string());
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
