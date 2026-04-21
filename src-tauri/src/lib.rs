mod acp;
mod commands;
mod crypto;
mod db;
mod mcp_server;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // --- Cache state ---
            let data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            let db_path = data_dir.join("cache.db");

            let state = commands::AppState {
                db: std::sync::Mutex::new(None),
                sync_client: sync::SyncClient::new(),
                auth_token: std::sync::Mutex::new(None),
                sync_client_base: std::sync::Mutex::new("http://127.0.0.1:8889".to_string()),
                db_path,
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
            commands::open_db_from_keychain,
            commands::init_db_with_login,
            commands::set_auth_token,
            commands::set_api_base,
            commands::get_inbox_cards,
            commands::get_favorites,
            commands::search_cards,
            commands::mark_read,
            commands::toggle_favorite,
            commands::get_cached_article,
            commands::run_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
