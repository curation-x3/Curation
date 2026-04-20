use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::crypto;
use crate::db::{CacheDb, CardRow, FavoriteRow, SearchResult};
use crate::sync::{self, SyncClient};

pub struct AppState {
    pub db: Mutex<Option<CacheDb>>,
    pub sync_client: SyncClient,
    pub auth_token: Mutex<Option<String>>,
    pub db_path: PathBuf,
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
pub fn open_db_from_keychain(state: State<'_, AppState>) -> Result<bool, String> {
    let hex_key = match crypto::load_key()? {
        Some(k) => k,
        None => return Ok(false),
    };
    if !state.db_path.exists() {
        return Ok(false);
    }
    let db = CacheDb::open(&state.db_path, &hex_key)?;
    let mut guard = state.db.lock().map_err(|e| e.to_string())?;
    *guard = Some(db);
    Ok(true)
}

#[tauri::command]
pub fn init_db_with_login(
    state: State<'_, AppState>,
    token: String,
    user_id: String,
) -> Result<(), String> {
    let new_key = crypto::derive_key(&token, &user_id);

    // Try to open existing DB with old key, then rekey
    let db = if state.db_path.exists() {
        if let Some(old_key) = crypto::load_key()? {
            match CacheDb::open(&state.db_path, &old_key) {
                Ok(existing) => {
                    existing.rekey(&new_key)?;
                    existing
                }
                Err(_) => CacheDb::create(&state.db_path, &new_key)?,
            }
        } else {
            CacheDb::create(&state.db_path, &new_key)?
        }
    } else {
        // Ensure parent directory exists
        if let Some(parent) = state.db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        CacheDb::create(&state.db_path, &new_key)?
    };

    crypto::store_key(&new_key)?;

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
pub fn get_cached_article(
    state: State<'_, AppState>,
    article_id: String,
) -> Result<Option<String>, String> {
    with_db(&state, |db| db.get_article_content(&article_id))
}

#[tauri::command]
pub async fn run_sync(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    // Extract token (brief lock)
    let token = {
        state
            .auth_token
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("not authenticated")?
    };

    // Read sync timestamp (brief lock)
    let sync_ts = with_db(&state, |db| db.get_sync_ts())?;

    // Read pending queue items (brief lock)
    let queue_items = with_db(&state, |db| db.get_sync_queue(50))?;

    // Push queued items to server (async, no db lock held)
    let push_results = state
        .sync_client
        .push_sync_queue(&queue_items, &token)
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

    // Pull remote changes (async, no db lock held)
    let pull_result = state
        .sync_client
        .pull_data(&token, sync_ts.as_deref())
        .await?;

    // Apply pull results to db (brief lock)
    let changed = with_db(&state, |db| sync::apply_pull_result(db, &pull_result))?;

    Ok(changed)
}
