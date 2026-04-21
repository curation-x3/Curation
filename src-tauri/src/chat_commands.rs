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
    // 1. Save user message
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "user", &message)?;
    }

    // 2. Ensure ACP session is active
    let active_sid = state.acp_manager.active_session_id().await;
    let is_new_session = active_sid.as_deref() != Some(&session_id);
    if is_new_session {
        let agents = crate::acp::detect_agents();
        let agent_cfg = agents
            .into_iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| format!("Unknown agent_id: {}", agent_id))?;

        state
            .acp_manager
            .start_session(&agent_cfg, &session_id, &app)
            .await?;
    }

    // 3. Send prompt — prepend system prompt for first message
    let prompt = if is_new_session && !system_prompt.is_empty() {
        format!("{}\n\n---\n\n用户提问：{}", system_prompt, message)
    } else {
        message.clone()
    };
    let response = state.acp_manager.send_prompt(&prompt, &app).await?;

    // 4. Save assistant message
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "assistant", &response)?;
    }

    Ok(response)
}

#[tauri::command]
pub async fn cancel_chat_stream(state: State<'_, AppState>) -> Result<(), String> {
    state.acp_manager.stop_session().await;
    Ok(())
}
