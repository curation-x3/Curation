use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewBuilder};

const SERVER_URL: &str = "http://127.0.0.1:8889/process";

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
            console.error('[wechat-reader] extract failed:', e);
            return false;
        }
    };

    // Auto-trigger loop
    (function() {
        const timer = setInterval(async () => {
            if (await window.__extractAndSend()) {
                console.log('[wechat-reader] Auto-extracted successfully');
                clearInterval(timer);
            }
        }, 1000);
    })();
    console.log('[wechat-reader] auto-extractor ready');
"#;

/// Create a HIDDEN webview window to extract content.
#[tauri::command]
fn open_article(app: AppHandle, url: String) -> Result<(), String> {
    println!("[wechat-reader] opening silent extractor: {}", url);
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
    println!("[wechat-reader] Rust received article: {} ({} chars)", title, html_len);

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

    match client.post(SERVER_URL).json(&payload).send().await {
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
        .invoke_handler(tauri::generate_handler![
            open_article,
            resize_webview,
            toggle_webview,
            trigger_extract,
            receive_article
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
