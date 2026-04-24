mod acp;
mod chat_commands;
mod commands;
mod crypto;
mod db;
mod sync;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl};

fn server_process_url() -> String {
    std::env::var("CURATION_SERVER_PROCESS_URL").unwrap_or_else(|_| {
        "http://127.0.0.1:8889/process".to_string()
    })
}

#[derive(Serialize, Deserialize)]
struct ArticlePayload {
    title: String,
    author: String,
    account: String,
    date: String,
    url: String,
    html: String,
}

// JS injected before page scripts run.
const INIT_SCRIPT: &str = r#"
    window.__extractAndSend = async function() {
        try {
            const body = document.getElementById('js_content');
            if (!body) return false;
            const html  = body.innerHTML;
            if (html.length < 100) return false;

            const title = document.getElementById('activity-name')?.innerText?.trim()
                       || document.querySelector('.rich_media_title')?.innerText?.trim()
                       || document.title;
            const author = document.getElementById('js_author_name_text')?.innerText?.trim()
                        || document.querySelector('.rich_media_meta_text')?.innerText?.trim()
                        || "";
            const account = document.getElementById('js_name')?.innerText?.trim() || "Unknown Account";
            const date = document.getElementById('publish_time')?.innerText?.trim() || "";
            const url   = window.location.href;
            await window.__TAURI_INTERNALS__.invoke('receive_article', { title, author, account, date, url, html });
            return true;
        } catch(e) {
            console.error('[Curation] extract failed:', e);
            return false;
        }
    };

    // Auto-trigger loop
    (function() {
        const timer = setInterval(async () => {
            if (await window.__extractAndSend()) {
                console.log('[Curation] Auto-extracted successfully');
                clearInterval(timer);
            }
        }, 1000);
    })();
    console.log('[Curation] auto-extractor ready');
"#;

/// Create a HIDDEN webview window to extract content.
#[tauri::command]
fn open_article(app: AppHandle, url: String) -> Result<(), String> {
    println!("[Curation] opening silent extractor: {}", url);
    let trimmed = url.trim();
    let parsed: url::Url = trimmed.parse().map_err(|e: url::ParseError| e.to_string())?;

    // If exists, just navigate
    if let Some(sub) = app.webview_windows().get("article-viewer") {
        sub.navigate(parsed).map_err(|e| e.to_string())?;
    } else {
        // Create HIDDEN
        tauri::WebviewWindowBuilder::new(&app, "article-viewer", WebviewUrl::External(parsed))
            .initialization_script(INIT_SCRIPT)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a URL in a visible browser-like window. Each call reuses the same "wechat-viewer" window.
#[tauri::command]
fn open_url_window(app: AppHandle, url: String) -> Result<(), String> {
    let parsed: url::Url = url.trim().parse().map_err(|e: url::ParseError| e.to_string())?;
    if let Some(w) = app.webview_windows().get("wechat-viewer") {
        w.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        tauri::WebviewWindowBuilder::new(&app, "wechat-viewer", WebviewUrl::External(parsed))
            .title("微信原文")
            .inner_size(900.0, 800.0)
            .build()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// No-op for compatibility with old frontend calls if any, or just remove.
#[tauri::command]
fn resize_webview() {}

#[tauri::command]
fn toggle_webview() {}

#[tauri::command]
fn trigger_extract() {}

/// Called by the injected script via Tauri IPC.
#[tauri::command]
async fn receive_article(
    app: AppHandle,
    title: String,
    author: String,
    account: String,
    date: String,
    url: String,
    html: String,
) -> Result<(), String> {
    let html_len = html.len();
    println!("[Curation] Rust received article: {} ({} chars)", title, html_len);

    // Close the extractor window immediately
    if let Some(sub) = app.webview_windows().get("article-viewer") {
        let _ = sub.close();
    }

    if let Some(main) = app.get_webview_window("main") {
        main.emit(
            "article-received",
            serde_json::json!({ "title": title, "url": url, "html_length": html_len }),
        )
        .map_err(|e| e.to_string())?;
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = ArticlePayload {
        title: title.clone(),
        author,
        account,
        date,
        url: url.clone(),
        html,
    };

    let url = server_process_url();
    match client.post(&url).json(&payload).send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                let body: serde_json::Value = resp.json().await.unwrap_or_default();
                if let Some(main) = app.get_webview_window("main") {
                    main.emit("server-response", body).map_err(|e| e.to_string())?;
                }
            } else {
                let text = resp.text().await.unwrap_or_default();
                if let Some(main) = app.get_webview_window("main") {
                    main.emit("server-response", serde_json::json!({
                        "status": "error",
                        "message": format!("Server returned {}: {}", status, text.chars().take(200).collect::<String>())
                    })).map_err(|e| e.to_string())?;
                }
            }
        }
        Err(e) => {
            if let Some(main) = app.get_webview_window("main") {
                main.emit(
                    "server-response",
                    serde_json::json!({ "status": "error", "message": format!("Server unreachable: {}", e) }),
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

/// Rebuild the process PATH so subprocesses see what the user's terminal sees.
///
/// Strategy (in order, each step merged in):
///   1. Ask the user's login shell (`$SHELL -ilc 'printf %s "$PATH"'`) what
///      its PATH is. This is authoritative — it matches the terminal exactly.
///      Guarded by a 2-second timeout; if the shell hangs, we move on.
///   2. The inherited (GUI-default) PATH, preserved so we never lose entries.
///   3. A static list of common user bin directories as belt-and-suspenders.
///
/// Entries are deduplicated while preserving order; earlier sources win.
fn init_user_path() {
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::path::PathBuf;

    fn probe_login_shell() -> Option<String> {
        use std::sync::mpsc;
        use std::time::Duration;
        let shell = std::env::var("SHELL").ok()?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let out = std::process::Command::new(&shell)
                .args(["-ilc", "printf '%s' \"$PATH\""])
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .output();
            let _ = tx.send(out);
        });
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(output)) if output.status.success() => {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            }
            _ => None,
        }
    }

    fn static_fallbacks() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            let h = std::path::Path::new(&home);
            for sub in [".local/bin", ".cargo/bin", ".bun/bin", ".volta/bin", ".npm-global/bin"] {
                out.push(h.join(sub));
            }
        }
        for p in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"] {
            out.push(PathBuf::from(p));
        }
        out
    }

    let shell_path = probe_login_shell();
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let fallbacks = static_fallbacks();

    let mut seen: HashSet<OsString> = HashSet::new();
    let mut merged: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf, seen: &mut HashSet<OsString>, merged: &mut Vec<PathBuf>| {
        let key = p.as_os_str().to_os_string();
        if seen.insert(key) {
            merged.push(p);
        }
    };

    if let Some(sp) = shell_path.as_deref() {
        for p in std::env::split_paths(sp) {
            push(p, &mut seen, &mut merged);
        }
    }
    for p in std::env::split_paths(&inherited) {
        push(p, &mut seen, &mut merged);
    }
    for p in fallbacks {
        push(p, &mut seen, &mut merged);
    }

    match std::env::join_paths(&merged) {
        Ok(joined) => {
            eprintln!(
                "[env] PATH initialized ({} entries, login-shell {})",
                merged.len(),
                if shell_path.is_some() { "OK" } else { "timeout/unavailable" },
            );
            std::env::set_var("PATH", joined);
        }
        Err(e) => eprintln!("[env] failed to join PATH: {}", e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // macOS Finder / Dock launches GUI apps with a minimal PATH that omits
    // common user bin directories. This breaks every subprocess spawn (ACP
    // agents, npm/npx, etc.). Rebuild PATH from the user's login shell
    // before Tauri boots so all downstream Command::new calls see it.
    init_user_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // --- Cache state ---
            let data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            let db_path = data_dir.join("cache.db");

            let state = commands::AppState {
                db: std::sync::Arc::new(std::sync::Mutex::new(None)),
                sync_client: sync::SyncClient::new(),
                auth_token: std::sync::Mutex::new(None),
                sync_client_base: std::sync::Mutex::new("http://127.0.0.1:8889".to_string()),
                db_path,
                acp_manager: crate::acp::AcpManager::new(),
            };
            app.manage(state);

            // --- Tray icon ---
            let show = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Curation")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_article,
            open_url_window,
            resize_webview,
            toggle_webview,
            trigger_extract,
            receive_article,
            commands::init_db_with_secret,
            commands::set_auth_token,
            commands::set_api_base,
            commands::get_inbox_cards,
            commands::get_favorites,
            commands::search_cards,
            commands::mark_read,
            commands::mark_unread,
            commands::mark_all_read,
            commands::toggle_favorite,
            commands::get_card_content,
            commands::get_cached_accounts,
            commands::save_cached_accounts,
            commands::get_cached_discoverable_accounts,
            commands::save_cached_discoverable_accounts,
            commands::run_sync,
            chat_commands::detect_available_agents,
            chat_commands::create_chat_session,
            chat_commands::get_session_for_card,
            chat_commands::get_home_session,
            chat_commands::get_chat_messages,
            chat_commands::send_chat_message,
            chat_commands::cancel_chat_stream,
            chat_commands::list_acp_runtime,
            chat_commands::set_acp_max_alive,
            chat_commands::get_acp_max_alive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
