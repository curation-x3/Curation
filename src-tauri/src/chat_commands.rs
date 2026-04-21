use tauri::{AppHandle, State};

use crate::acp::AgentConfig;
use crate::commands::AppState;
use crate::db::{ChatMessage, ChatSession};
use crate::mcp_server::CardContext;

// ---------------------------------------------------------------------------
// Helper: access db with the sync Mutex
// ---------------------------------------------------------------------------

fn with_db<F, T>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    F: FnOnce(&crate::db::CacheDb) -> Result<T, String>,
{
    let guard = state.db.lock().map_err(|e| e.to_string())?;
    let db = guard.as_ref().ok_or("database not initialized")?;
    f(db)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Returns the list of known ACP agents with detection status.
#[tauri::command]
pub fn detect_available_agents() -> Vec<AgentConfig> {
    crate::acp::detect_agents()
}

/// Update (or clear) the current card context shown to the ACP agent.
#[tauri::command]
pub fn set_current_card_context(
    state: State<'_, AppState>,
    context: Option<CardContext>,
) -> Result<(), String> {
    let mut guard = state
        .current_card_context
        .lock()
        .map_err(|e| e.to_string())?;
    *guard = context;
    Ok(())
}

/// Create a new chat session (generates UUID, persists to DB, returns the row).
#[tauri::command]
pub fn create_chat_session(
    state: State<'_, AppState>,
    card_id: Option<String>,
    agent_id: String,
) -> Result<ChatSession, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    with_db(&state, |db| {
        db.create_chat_session(&session_id, card_id.as_deref(), &agent_id)?;
        // Fetch the just-inserted row so we return the real timestamps.
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

/// Return the most recent session for the given card_id.
#[tauri::command]
pub fn get_session_for_card(
    state: State<'_, AppState>,
    card_id: String,
) -> Result<Option<ChatSession>, String> {
    with_db(&state, |db| db.get_latest_session_for_card(&card_id))
}

/// Return the most recent home session (no card_id).
#[tauri::command]
pub fn get_home_session(state: State<'_, AppState>) -> Result<Option<ChatSession>, String> {
    with_db(&state, |db| db.get_home_session())
}

/// Return all messages for a session, ordered oldest-first.
#[tauri::command]
pub fn get_chat_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ChatMessage>, String> {
    with_db(&state, |db| db.get_chat_messages(&session_id))
}

/// Send a user message, stream the agent reply via Tauri events, and persist both.
///
/// Lock discipline: all DB access is done in brief synchronous lock windows;
/// no Mutex guard is held across `.await` points.
#[tauri::command]
pub async fn send_chat_message(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    agent_id: String,
    message: String,
    system_prompt: String,
) -> Result<String, String> {
    // --- 1. Save user message (sync, lock dropped before await) ---
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "user", &message)?;
    }

    // --- 2. Ensure ACP session is active ---
    let active_sid = state.acp_manager.active_session_id().await;
    let is_new_session = active_sid.as_deref() != Some(&session_id);
    if is_new_session {
        // Find the matching AgentConfig by ID
        let agents = crate::acp::detect_agents();
        let agent_cfg = agents
            .into_iter()
            .find(|a| a.id == agent_id)
            .ok_or_else(|| format!("Unknown agent_id: {}", agent_id))?;

        state
            .acp_manager
            .start_session(
                &agent_cfg,
                &session_id,
                &app,
                state.db.clone(),
                state.current_card_context.clone(),
            )
            .await?;
    }

    // --- 3. Send prompt (async, no DB lock held) ---
    // For the first message in a new session, prepend the system prompt so
    // the agent gets context + user question in a single round.
    let prompt = if is_new_session && !system_prompt.is_empty() {
        format!("{}\n\n---\n\n用户提问：{}", system_prompt, message)
    } else {
        message.clone()
    };
    let response = state.acp_manager.send_prompt(&prompt, &app).await?;

    // --- 4. Save assistant message (sync, lock dropped before return) ---
    {
        let guard = state.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("database not initialized")?;
        db.insert_chat_message(&session_id, "assistant", &response)?;
    }

    Ok(response)
}

/// Stop the active ACP session (cancels any in-progress stream).
#[tauri::command]
pub async fn cancel_chat_stream(state: State<'_, AppState>) -> Result<(), String> {
    state.acp_manager.stop_session().await;
    Ok(())
}
