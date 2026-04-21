use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

use crate::crypto;
use crate::db::{CacheDb, CardRow, FavoriteRow, SearchResult};
use crate::sync::SyncClient;

pub struct AppState {
    pub db: Arc<Mutex<Option<CacheDb>>>,
    pub sync_client: SyncClient,
    pub auth_token: Mutex<Option<String>>,
    pub sync_client_base: Mutex<String>,
    pub db_path: PathBuf,
    pub acp_manager: crate::acp::AcpManager,
}

fn with_db<F, T>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    F: FnOnce(&CacheDb) -> Result<T, String>,
{
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("database not initialized")?;
    f(db)
}

#[tauri::command]
pub fn init_db_with_login(
    state: State<'_, AppState>,
    token: String,
    user_id: String,
) -> Result<(), String> {
    let hex_key = crypto::derive_key(&token, &user_id);
    println!("[cache] init_db_with_login called, db exists: {}", state.db_path.exists());

    let db = if state.db_path.exists() {
        match CacheDb::open(&state.db_path, &hex_key) {
            Ok(db) => {
                println!("[cache] opened existing db");
                db
            }
            Err(e) => {
                println!("[cache] key mismatch ({}), recreating db", e);
                CacheDb::create(&state.db_path, &hex_key)?
            }
        }
    } else {
        if let Some(parent) = state.db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        CacheDb::create(&state.db_path, &hex_key)?
    };

    let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
    *db_guard = Some(db);

    let mut token_guard = state.auth_token.lock().map_err(|e| e.to_string())?;
    *token_guard = Some(token);

    Ok(())
}

#[tauri::command]
pub fn set_auth_token(state: State<'_, AppState>, token: String) -> Result<(), String> {
    let mut guard = state.auth_token.lock().map_err(|e| e.to_string())?;
    *guard = Some(token);
    Ok(())
}

#[tauri::command]
pub fn set_api_base(state: State<'_, AppState>, api_base: String) -> Result<(), String> {
    let mut guard = state.sync_client_base.lock().map_err(|e| e.to_string())?;
    *guard = api_base;
    Ok(())
}

#[tauri::command]
pub fn get_inbox_cards(
    state: State<'_, AppState>,
    account: Option<String>,
    unread_only: Option<bool>,
) -> Result<Vec<CardRow>, String> {
    with_db(&state, |db| {
        db.get_inbox_cards(account.as_deref(), unread_only.unwrap_or(false))
    })
}

#[tauri::command]
pub fn get_favorites(state: State<'_, AppState>) -> Result<Vec<FavoriteRow>, String> {
    with_db(&state, |db| db.get_favorites())
}

#[tauri::command]
pub fn search_cards(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchResult>, String> {
    with_db(&state, |db| db.search_cards(&query))
}

#[tauri::command]
pub fn mark_read(state: State<'_, AppState>, card_id: String) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    with_db(&state, |db| db.mark_read(&card_id, &now))
}

#[tauri::command]
pub fn mark_unread(state: State<'_, AppState>, card_id: String) -> Result<(), String> {
    with_db(&state, |db| db.mark_unread(&card_id))
}

#[tauri::command]
pub fn mark_all_read(state: State<'_, AppState>, card_ids: Vec<String>) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    with_db(&state, |db| {
        for card_id in &card_ids {
            db.mark_read(card_id, &now)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn toggle_favorite(
    state: State<'_, AppState>,
    item_type: String,
    item_id: String,
    is_favorited: bool,
) -> Result<(), String> {
    with_db(&state, |db| {
        if is_favorited {
            db.remove_favorite(&item_type, &item_id)
        } else {
            db.add_favorite(&item_type, &item_id)
        }
    })
}

#[tauri::command]
pub fn get_card_content(
    state: State<'_, AppState>,
    card_id: String,
) -> Result<Option<String>, String> {
    with_db(&state, |db| db.get_card_content(&card_id))
}

#[tauri::command]
pub async fn run_sync(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    // Extract token and base URL (brief locks)
    let token = {
        state
            .auth_token
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("not authenticated")?
    };
    let base_url = {
        state
            .sync_client_base
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
    };

    // Read sync timestamp (brief lock)
    let sync_ts = with_db(&state, |db| db.get_sync_ts())?;

    // Read pending queue items (brief lock)
    let queue_items = with_db(&state, |db| db.get_sync_queue(50))?;

    // Push queued items to server (async, no db lock held)
    let push_results = state
        .sync_client
        .push_sync_queue(&base_url, &queue_items, &token)
        .await;

    // Apply push results to db (brief lock)
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        for (id, result) in &push_results {
            match result {
                Ok(()) => db.remove_sync_queue_item(*id)?,
                Err(_) => db.increment_sync_queue_retries(*id)?,
            }
        }
    }

    // Pull remote changes page by page, committing each page immediately and
    // emitting a Tauri event so the UI can invalidate queries progressively.
    // No MutexGuard is held across the async fetches — pull_and_commit
    // acquires and releases the lock around each synchronous page apply.
    let changed = state
        .sync_client
        .pull_and_commit(
            &base_url,
            &token,
            sync_ts.as_deref(),
            &state.db,
            |page_keys, cards, favorites| {
                let _ = app.emit(
                    "sync-page-committed",
                    serde_json::json!({
                        "changedKeys": page_keys,
                        "cards": cards,
                        "favorites": favorites,
                    }),
                );
            },
        )
        .await?;

    Ok(changed)
}
