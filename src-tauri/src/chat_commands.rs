use tauri::{AppHandle, State};

use crate::acp::AgentConfig;
use crate::commands::AppState;
use crate::db::{ChatMessage, ChatSession};

fn with_db<F, T>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    F: FnOnce(&crate::db::CacheDb) -> Result<T, String>,
{
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("database not initialized")?;
    f(db)
}

#[tauri::command]
pub fn detect_available_agents() -> Vec<AgentConfig> {
    crate::acp::detect_agents()
}

#[tauri::command]
pub fn create_chat_session(
    state: State<'_, AppState>,
    card_id: Option<String>,
    agent_id: String,
) -> Result<ChatSession, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    with_db(&state, |db| {
        db.create_chat_session(&session_id, card_id.as_deref(), &agent_id)?;
        match card_id.as_deref() {
            Some(cid) => db
                .get_latest_session_for_card(cid)?
                .ok_or_else(|| "Session not found after insert".to_string()),
            None => db
                .get_home_session()?
                .ok_or_else(|| "Home session not found after insert".to_string()),
        }
    })
}

#[tauri::command]
pub fn get_session_for_card(
    state: State<'_, AppState>,
    card_id: String,
) -> Result<Option<ChatSession>, String> {
    with_db(&state, |db| db.get_latest_session_for_card(&card_id))
}

#[tauri::command]
pub fn get_home_session(state: State<'_, AppState>) -> Result<Option<ChatSession>, String> {
    with_db(&state, |db| db.get_home_session())
}

#[tauri::command]
pub fn get_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ChatMessage>, String> {
    with_db(&state, |db| db.get_chat_messages(&session_id))
}

#[tauri::command]
pub async fn send_chat_message(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    agent_id: String,
    message: String,
    system_prompt: String,
) -> Result<String, String> {
    // 1. Look up card binding + detect first turn (no prior messages) before inserting.
    let (card_id, is_first_turn) = {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        let prior = db.get_chat_messages(&session_id)?;
        let card = db.get_card_id_for_session(&session_id)?;
        (card, prior.is_empty())
    };

    // 2. Save user message
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "user", &message)?;
    }

    // 3. Resolve agent config
    let agents = crate::acp::detect_agents();
    let agent_cfg = agents
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| format!("Unknown agent_id: {}", agent_id))?;

    // 4. Send prompt — prepend system prompt for first turn
    let prompt = if is_first_turn && !system_prompt.is_empty() {
        format!("{}\n\n---\n\n用户提问：{}", system_prompt, message)
    } else {
        message.clone()
    };
    let response = state
        .acp_manager
        .send_prompt(&session_id, card_id.as_deref(), &agent_cfg, &prompt, &app)
        .await?;

    // 5. Save assistant message
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "assistant", &response)?;
    }

    Ok(response)
}

#[tauri::command]
pub async fn cancel_chat_stream(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    state.acp_manager.stop(&session_id, &app).await;
    Ok(())
}

#[tauri::command]
pub async fn list_acp_runtime(
    state: State<'_, AppState>,
) -> Result<Vec<crate::acp::RuntimeSnapshot>, String> {
    Ok(state.acp_manager.list_runtime().await)
}

#[tauri::command]
pub async fn set_acp_max_alive(
    state: State<'_, AppState>,
    n: usize,
) -> Result<(), String> {
    state.acp_manager.set_max_alive(n);
    with_db(&state, |db| db.set_setting("acp.max_alive_sessions", &n.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn get_acp_max_alive(state: State<'_, AppState>) -> Result<usize, String> {
    with_db(&state, |db| {
        let v = db.get_setting("acp.max_alive_sessions")?;
        let n: usize = v
            .and_then(|s| s.parse().ok())
            .unwrap_or(3)
            .clamp(1, 5);
        Ok(n)
    })
}
