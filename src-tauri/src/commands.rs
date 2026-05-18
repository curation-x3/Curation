use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{Emitter, Manager, State};

use crate::db::{AccountRow, CacheDb, CardRow, FavoriteRow, SearchResult};
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
pub fn init_db_with_secret(state: State<'_, AppState>, secret: String) -> Result<(), String> {
    println!(
        "[cache] init_db_with_secret, db exists: {}",
        state.db_path.exists()
    );

    let db = if state.db_path.exists() {
        match CacheDb::open(&state.db_path, &secret) {
            Ok(db) => {
                println!("[cache] opened existing db with server secret");
                db
            }
            Err(e) => {
                println!(
                    "[cache] open failed ({}), recreating (one-time migration)",
                    e
                );
                let _ = std::fs::remove_file(&state.db_path);
                CacheDb::create(&state.db_path, &secret)?
            }
        }
    } else {
        if let Some(parent) = state.db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        CacheDb::create(&state.db_path, &secret)?
    };

    let mut db_guard = state.db.lock().map_err(|e| e.to_string())?;
    *db_guard = Some(db);
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
pub fn get_cards_by_ids(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<SearchResult>, String> {
    with_db(&state, |db| db.get_cards_by_ids(&ids))
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
pub fn set_card_content(
    state: State<'_, AppState>,
    card_id: String,
    content_md: String,
) -> Result<(), String> {
    with_db(&state, |db| db.set_card_content(&card_id, &content_md))
}

#[tauri::command]
pub fn get_cached_accounts(state: State<'_, AppState>) -> Result<Vec<AccountRow>, String> {
    with_db(&state, |db| db.get_cached_accounts())
}

#[tauri::command]
pub fn save_cached_accounts(
    state: State<'_, AppState>,
    accounts: Vec<serde_json::Value>,
) -> Result<usize, String> {
    with_db(&state, |db| db.upsert_accounts(&accounts))
}

#[tauri::command]
pub fn get_cached_discoverable_accounts(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    with_db(&state, |db| db.get_cached_discoverable_accounts())
}

#[tauri::command]
pub fn save_cached_discoverable_accounts(
    state: State<'_, AppState>,
    accounts: Vec<serde_json::Value>,
) -> Result<usize, String> {
    with_db(&state, |db| db.upsert_discoverable_accounts(&accounts))
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

#[tauri::command]
pub fn check_acp_environment() -> Result<Vec<crate::acp::AgentEnvironmentCheck>, String> {
    Ok(crate::acp::check_agent_environments())
}

#[tauri::command]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    frontend_logs_text: Option<String>,
    frontend_logs_json: Option<String>,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {}", e))?;
    let diagnostics_root = app_data_dir.join("diagnostics");
    std::fs::create_dir_all(&diagnostics_root).map_err(|e| e.to_string())?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let package_dir = diagnostics_root.join(format!("curation-diagnostics-{}", stamp));
    std::fs::create_dir_all(&package_dir).map_err(|e| e.to_string())?;

    let checks = crate::acp::check_agent_environments_quick();
    let manifest = serde_json::json!({
        "generated_at": chrono::Local::now().to_rfc3339(),
        "app_version": app.package_info().version.to_string(),
        "app_data_dir": app_data_dir.to_string_lossy(),
        "diagnostic_dir": package_dir.to_string_lossy(),
    });

    std::fs::write(
        package_dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        package_dir.join("environment.txt"),
        crate::acp::environment_report_text(),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        package_dir.join("acp_environment.json"),
        serde_json::to_string_pretty(&checks).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        package_dir.join("frontend_console.log"),
        frontend_logs_text.unwrap_or_else(|| "frontend console log was not provided".to_string()),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        package_dir.join("frontend_console.json"),
        frontend_logs_json.unwrap_or_else(|| "[]".to_string()),
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(
        package_dir.join("app_system.log"),
        collect_app_system_log().unwrap_or_else(|e| format!("failed to collect system log: {}", e)),
    )
    .map_err(|e| e.to_string())?;

    Ok(package_dir.to_string_lossy().to_string())
}

fn collect_app_system_log() -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Ok("system log collection is only available on macOS".to_string());
    }
    capture_command(
        "log",
        &[
            "show",
            "--style",
            "compact",
            "--last",
            "2h",
            "--predicate",
            r#"process == "Curation""#,
        ],
        2_500,
    )
}

fn capture_command(command: &str, args: &[&str], timeout_ms: u64) -> Result<String, String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child.wait_with_output().map_err(|e| e.to_string())?;
                let mut text = String::new();
                text.push_str(&String::from_utf8_lossy(&output.stdout));
                text.push_str(&String::from_utf8_lossy(&output.stderr));
                let text = text.trim().chars().take(120_000).collect::<String>();
                if output.status.success() {
                    return Ok(text);
                }
                return Err(if text.is_empty() {
                    format!("command exited with {}", output.status)
                } else {
                    text
                });
            }
            Ok(None) => {
                if start.elapsed().as_millis() > timeout_ms as u128 {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("timed out after {}ms", timeout_ms));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(e.to_string());
            }
        }
    }
}
