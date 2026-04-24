use serde::Serialize;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, Mutex};

use agent_client_protocol::schema::{
    ContentBlock, ContentChunk, InitializeRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SessionUpdate,
};
use agent_client_protocol::{
    on_receive_notification, on_receive_request, Agent, Client, ConnectionTo, SessionMessage,
};
use agent_client_protocol_tokio::AcpAgent;

#[derive(Debug, Clone, Serialize)]
pub struct AgentConfig {
    pub name: String,
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub detected: bool,
}

/// Event emitted to the frontend via Tauri's event system during chat streaming.
#[derive(Debug, Clone, Serialize)]
pub struct ChatStreamEvent {
    pub session_id: String,
    pub event_type: String, // "text_chunk", "tool_call", "tool_call_update", "done", "error"
    pub content: String,
}

/// Returns the list of known agents with detection status.
pub fn detect_agents() -> Vec<AgentConfig> {
    let agents: Vec<(&str, &str, &str, &str, Vec<String>)> = vec![
        ("Claude Code", "claude-acp", "claude", "npx", vec![
            "@agentclientprotocol/claude-agent-acp@0.30.0".to_string(),
        ]),
        ("Codex CLI", "codex-acp", "codex", "npx", vec![
            "@zed-industries/codex-acp@0.11.1".to_string(),
        ]),
        ("Gemini CLI", "gemini-acp", "gemini", "gemini", vec![
            "--acp".to_string(),
        ]),
    ];

    agents
        .into_iter()
        .map(|(name, id, detect_cmd, launch_cmd, args)| {
            let detected = is_command_available(detect_cmd);
            AgentConfig {
                name: name.to_string(),
                id: id.to_string(),
                command: launch_cmd.to_string(),
                args,
                detected,
            }
        })
        .collect()
}

fn is_command_available(cmd: &str) -> bool {
    // macOS GUI-launched apps (incl. Tauri) inherit a minimal PATH that omits
    // user-level bin dirs where CLIs like `claude`, `node`, etc. typically live.
    // First try the native PATH via `which`/`where`; if that misses, probe
    // common bin directories directly.
    let native = if cfg!(target_os = "windows") {
        Command::new("where").arg(cmd).output()
    } else {
        Command::new("which").arg(cmd).output()
    };
    if let Ok(output) = native {
        if output.status.success() {
            return true;
        }
    }

    // Fallback: probe common install locations.
    let home = std::env::var_os("HOME");
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(h) = &home {
        let h = std::path::Path::new(h);
        for sub in [".local/bin", ".cargo/bin", ".bun/bin", ".volta/bin", ".npm-global/bin"] {
            candidates.push(h.join(sub).join(cmd));
        }
    }
    for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        candidates.push(std::path::PathBuf::from(p).join(cmd));
    }
    candidates.iter().any(|p| p.exists())
}

// ---------------------------------------------------------------------------
// Timing instrumentation — one-line stderr logs for startup/latency analysis
// ---------------------------------------------------------------------------

struct AcpTiming {
    session_id: String,
    start: Instant,
    last: Instant,
}

impl AcpTiming {
    fn new(session_id: &str) -> Self {
        let now = Instant::now();
        Self {
            session_id: session_id.to_string(),
            start: now,
            last: now,
        }
    }
    fn mark(&mut self, step: &str) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_millis();
        let total = now.duration_since(self.start).as_millis();
        eprintln!(
            "[acp-timing] session={} step={} elapsed=+{}ms total={}ms",
            self.session_id, step, elapsed, total
        );
        self.last = now;
    }
}

// ---------------------------------------------------------------------------
// ACP Manager — registry of alive ACP runtime sessions
// ---------------------------------------------------------------------------

use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;

enum SessionCommand {
    SendPrompt {
        text: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Stop,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SessionRuntimeStatus {
    Starting,
    Idle,
    Running,
    Stopping,
    Errored { message: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeSnapshot {
    pub session_id: String,
    pub card_id: Option<String>,
    pub agent_id: String,
    pub status: SessionRuntimeStatus,
    pub last_active_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
pub struct AcpRuntimeEvent {
    pub session_id: String,
    pub card_id: Option<String>,
    pub agent_id: String,
    pub status: SessionRuntimeStatus,
}

struct RuntimeSession {
    session_id: String,
    card_id: Option<String>,
    agent_id: String,
    status: SessionRuntimeStatus,
    last_active: Instant,
    cmd_tx: mpsc::Sender<SessionCommand>,
}

pub struct AcpManager {
    sessions: Arc<Mutex<HashMap<String, RuntimeSession>>>,
    max_alive: Arc<AtomicUsize>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_alive: Arc::new(AtomicUsize::new(3)),
        }
    }

    pub fn set_max_alive(&self, n: usize) {
        self.max_alive.store(n.clamp(1, 5), Ordering::Relaxed);
    }

    pub async fn list_runtime(&self) -> Vec<RuntimeSnapshot> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .map(|s| RuntimeSnapshot {
                session_id: s.session_id.clone(),
                card_id: s.card_id.clone(),
                agent_id: s.agent_id.clone(),
                status: s.status.clone(),
                last_active_ms: s.last_active.elapsed().as_millis(),
            })
            .collect()
    }

    pub async fn stop(&self, session_id: &str, app: &tauri::AppHandle) {
        let tx = {
            let mut sessions = self.sessions.lock().await;
            sessions.get_mut(session_id).map(|s| {
                s.status = SessionRuntimeStatus::Stopping;
                s.cmd_tx.clone()
            })
        };
        if let Some(tx) = tx {
            // Emit stopping status outside the lock
            self.emit_status(session_id, SessionRuntimeStatus::Stopping, app)
                .await;
            let _ = tx.send(SessionCommand::Stop).await;
        }
    }

    pub async fn send_prompt(
        &self,
        session_id: &str,
        card_id: Option<&str>,
        agent: &AgentConfig,
        prompt: &str,
        app: &tauri::AppHandle,
    ) -> Result<String, String> {
        self.prune_errored().await;

        // Fast path: runtime exists and is Idle — reuse warm subprocess.
        let reuse_tx = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).and_then(|s| match &s.status {
                SessionRuntimeStatus::Idle => Some(s.cmd_tx.clone()),
                _ => None,
            })
        };

        if let Some(tx) = reuse_tx {
            self.mark_status(session_id, SessionRuntimeStatus::Running, app)
                .await;
            let result = Self::send_cmd(&tx, prompt).await;
            self.finalize_turn(session_id, &result, app).await;
            return result;
        }

        // Reject if busy (Running / Starting / Stopping)
        {
            let sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get(session_id) {
                if matches!(
                    s.status,
                    SessionRuntimeStatus::Running
                        | SessionRuntimeStatus::Starting
                        | SessionRuntimeStatus::Stopping
                ) {
                    return Err("ACP session is busy".to_string());
                }
            }
        }

        self.acquire_slot(session_id, app).await?;
        self.spawn_runtime(session_id, card_id, agent, app).await?;

        let tx = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .map(|s| s.cmd_tx.clone())
                .ok_or_else(|| "spawned session missing from registry".to_string())?
        };

        self.mark_status(session_id, SessionRuntimeStatus::Running, app)
            .await;
        let result = Self::send_cmd(&tx, prompt).await;
        self.finalize_turn(session_id, &result, app).await;
        result
    }

    async fn send_cmd(
        tx: &mpsc::Sender<SessionCommand>,
        prompt: &str,
    ) -> Result<String, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(SessionCommand::SendPrompt {
            text: prompt.to_string(),
            reply: reply_tx,
        })
        .await
        .map_err(|_| "ACP session task has exited".to_string())?;
        reply_rx
            .await
            .map_err(|_| "ACP session task dropped the reply channel".to_string())?
    }

    async fn prune_errored(&self) {
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, s| !matches!(s.status, SessionRuntimeStatus::Errored { .. }));
    }

    async fn acquire_slot(
        &self,
        new_session_id: &str,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let max = self.max_alive.load(Ordering::Relaxed);

        let victim: Option<(String, mpsc::Sender<SessionCommand>)> = {
            let sessions = self.sessions.lock().await;
            let alive = sessions
                .iter()
                .filter(|(k, _)| k.as_str() != new_session_id)
                .filter(|(_, s)| !matches!(s.status, SessionRuntimeStatus::Errored { .. }))
                .count();
            if alive < max {
                return Ok(());
            }
            sessions
                .iter()
                .filter(|(k, _)| k.as_str() != new_session_id)
                .filter(|(_, s)| matches!(s.status, SessionRuntimeStatus::Idle))
                .min_by_key(|(_, s)| s.last_active)
                .map(|(k, s)| (k.clone(), s.cmd_tx.clone()))
        };

        if let Some((victim_id, tx)) = victim {
            self.mark_status(&victim_id, SessionRuntimeStatus::Stopping, app)
                .await;
            let _ = tx.send(SessionCommand::Stop).await;
            for _ in 0..100 {
                {
                    let sessions = self.sessions.lock().await;
                    if !sessions.contains_key(&victim_id) {
                        return Ok(());
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            Err("timed out waiting for evicted session to shut down".to_string())
        } else {
            Err("all ACP sessions busy; close one or wait".to_string())
        }
    }

    async fn spawn_runtime(
        &self,
        session_id: &str,
        card_id: Option<&str>,
        agent: &AgentConfig,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let mut timing = AcpTiming::new(session_id);
        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);

        let session_id_owned = session_id.to_string();
        let card_id_owned = card_id.map(|s| s.to_string());
        let agent_id = agent.id.clone();
        let app_handle = app.clone();

        let acp_agent = AcpAgent::from_args(
            std::iter::once(agent.command.clone()).chain(agent.args.iter().cloned()),
        )
        .map_err(|e| format!("Failed to create ACP agent: {}", e))?;
        timing.mark("b1 subprocess_spawned");

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                session_id_owned.clone(),
                RuntimeSession {
                    session_id: session_id_owned.clone(),
                    card_id: card_id_owned.clone(),
                    agent_id: agent_id.clone(),
                    status: SessionRuntimeStatus::Starting,
                    last_active: Instant::now(),
                    cmd_tx: cmd_tx.clone(),
                },
            );
        }
        emit_runtime(
            app,
            &session_id_owned,
            &card_id_owned,
            &agent_id,
            &SessionRuntimeStatus::Starting,
        );

        let sid_for_task = session_id_owned.clone();
        let card_for_task = card_id_owned.clone();
        let agent_for_task = agent_id.clone();
        let timing = Arc::new(Mutex::new(timing));
        let sessions_for_task = self.sessions.clone();

        tokio::spawn(async move {
            let result = run_acp_session(
                acp_agent,
                sid_for_task.clone(),
                app_handle.clone(),
                cmd_rx,
                timing,
                sessions_for_task.clone(),
                card_for_task.clone(),
                agent_for_task.clone(),
            )
            .await;

            // Task exited — remove from map and emit terminal status.
            {
                let mut sessions = sessions_for_task.lock().await;
                sessions.remove(&sid_for_task);
            }

            if let Err(e) = result {
                emit_runtime(
                    &app_handle,
                    &sid_for_task,
                    &card_for_task,
                    &agent_for_task,
                    &SessionRuntimeStatus::Errored {
                        message: e.clone(),
                    },
                );
                let _ = app_handle.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        session_id: sid_for_task,
                        event_type: "error".to_string(),
                        content: format!("ACP session ended with error: {}", e),
                    },
                );
            }
        });

        // Wait for session to reach Idle (or fail/exit during startup).
        for _ in 0..200 {
            {
                let sessions = self.sessions.lock().await;
                match sessions.get(session_id).map(|s| &s.status) {
                    Some(SessionRuntimeStatus::Idle)
                    | Some(SessionRuntimeStatus::Running) => return Ok(()),
                    Some(SessionRuntimeStatus::Errored { message }) => {
                        return Err(message.clone())
                    }
                    None => return Err("runtime disappeared during startup".to_string()),
                    _ => {}
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        Err("timed out waiting for ACP session to start".to_string())
    }

    async fn mark_status(
        &self,
        session_id: &str,
        status: SessionRuntimeStatus,
        app: &tauri::AppHandle,
    ) {
        let meta = {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(session_id) {
                s.status = status.clone();
                s.last_active = Instant::now();
                Some((s.card_id.clone(), s.agent_id.clone()))
            } else {
                None
            }
        };
        if let Some((card_id, agent_id)) = meta {
            emit_runtime(app, session_id, &card_id, &agent_id, &status);
        }
    }

    async fn emit_status(
        &self,
        session_id: &str,
        status: SessionRuntimeStatus,
        app: &tauri::AppHandle,
    ) {
        let meta = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .map(|s| (s.card_id.clone(), s.agent_id.clone()))
        };
        if let Some((card_id, agent_id)) = meta {
            emit_runtime(app, session_id, &card_id, &agent_id, &status);
        }
    }

    async fn finalize_turn(
        &self,
        session_id: &str,
        result: &Result<String, String>,
        app: &tauri::AppHandle,
    ) {
        let status = match result {
            Ok(_) => SessionRuntimeStatus::Idle,
            Err(e) => SessionRuntimeStatus::Errored {
                message: e.clone(),
            },
        };
        self.mark_status(session_id, status, app).await;
    }
}

fn emit_runtime(
    app: &tauri::AppHandle,
    session_id: &str,
    card_id: &Option<String>,
    agent_id: &str,
    status: &SessionRuntimeStatus,
) {
    let _ = app.emit(
        "acp-runtime",
        AcpRuntimeEvent {
            session_id: session_id.to_string(),
            card_id: card_id.clone(),
            agent_id: agent_id.to_string(),
            status: status.clone(),
        },
    );
}

async fn run_acp_session(
    acp_agent: AcpAgent,
    session_id: String,
    app: tauri::AppHandle,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    timing: Arc<Mutex<AcpTiming>>,
    sessions: Arc<Mutex<HashMap<String, RuntimeSession>>>,
    card_id: Option<String>,
    agent_id: String,
) -> Result<(), String> {
    let first_notification_seen = Arc::new(AtomicBool::new(false));
    let chunk_tx: Arc<Mutex<Option<mpsc::UnboundedSender<StreamChunk>>>> =
        Arc::new(Mutex::new(None));
    let chunk_tx_for_handler = chunk_tx.clone();

    let session_id_for_handler = session_id.clone();
    let app_for_handler = app.clone();

    let session_id_for_connect = session_id.clone();
    let app_for_connect = app.clone();

    let result = Client
        .builder()
        .name("curation-app")
        .on_receive_notification({
            let timing = timing.clone();
            let first_notification_seen = first_notification_seen.clone();
            async move |notification: SessionNotification, _cx| {
                if !first_notification_seen.swap(true, Ordering::SeqCst) {
                    timing.lock().await.mark("b5 first_notification");
                }
                let guard = chunk_tx_for_handler.lock().await;
                if let Some(tx) = guard.as_ref() {
                    let chunk = match &notification.update {
                        SessionUpdate::AgentMessageChunk(ContentChunk {
                            content: ContentBlock::Text(text),
                            ..
                        }) => Some(StreamChunk::Text(text.text.clone())),
                        SessionUpdate::ToolCall(_) => Some(StreamChunk::ToolCall),
                        SessionUpdate::ToolCallUpdate(_) => Some(StreamChunk::ToolCallUpdate),
                        _ => None,
                    };
                    if let Some(c) = chunk {
                        let _ = tx.send(c);
                    }
                }
                let event = match &notification.update {
                    SessionUpdate::AgentMessageChunk(ContentChunk {
                        content: ContentBlock::Text(text),
                        ..
                    }) => Some(ChatStreamEvent {
                        session_id: session_id_for_handler.clone(),
                        event_type: "text_chunk".to_string(),
                        content: text.text.clone(),
                    }),
                    SessionUpdate::ToolCall(tc) => Some(ChatStreamEvent {
                        session_id: session_id_for_handler.clone(),
                        event_type: "tool_call".to_string(),
                        content: tc.title.clone(),
                    }),
                    SessionUpdate::ToolCallUpdate(tcu) => Some(ChatStreamEvent {
                        session_id: session_id_for_handler.clone(),
                        event_type: "tool_call_update".to_string(),
                        content: tcu
                            .fields
                            .title
                            .clone()
                            .unwrap_or_else(|| format!("{}", tcu.tool_call_id)),
                    }),
                    _ => None,
                };
                if let Some(evt) = event {
                    let _ = app_for_handler.emit("chat-stream", evt);
                }
                Ok(())
            }},
            on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let option_id = request.options.first().map(|opt| opt.option_id.clone());
                if let Some(id) = option_id {
                    responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)),
                    ))
                } else {
                    responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ))
                }
            },
            on_receive_request!(),
        )
        .connect_with(acp_agent, {
            let timing = timing.clone();
            let sessions = sessions.clone();
            let session_id_init = session_id.clone();
            let card_id_init = card_id.clone();
            let agent_id_init = agent_id.clone();
            let app_for_init = app.clone();
            async move |cx: ConnectionTo<Agent>| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            timing.lock().await.mark("b2 initialize_done");

            let cwd =
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
            let mut session = cx
                .build_session(cwd)
                .block_task()
                .start_session()
                .await?;
            timing.lock().await.mark("b3 session_started");

            // Mark the session Idle so the spawn_runtime wait loop proceeds.
            {
                let mut map = sessions.lock().await;
                if let Some(s) = map.get_mut(&session_id_init) {
                    s.status = SessionRuntimeStatus::Idle;
                    s.last_active = Instant::now();
                }
            }
            emit_runtime(
                &app_for_init,
                &session_id_init,
                &card_id_init,
                &agent_id_init,
                &SessionRuntimeStatus::Idle,
            );

            loop {
                let cmd = match cmd_rx.recv().await {
                    Some(cmd) => cmd,
                    None => break,
                };

                match cmd {
                    SessionCommand::SendPrompt { text, reply } => {
                        let result = handle_prompt(
                            &mut session,
                            &chunk_tx,
                            &text,
                            &session_id_for_connect,
                            &app_for_connect,
                        )
                        .await;
                        let _ = reply.send(result);
                    }
                    SessionCommand::Stop => break,
                }
            }

            Ok(())
        }})
        .await;

    result.map_err(|e| format!("ACP connection error: {}", e))
}

enum StreamChunk {
    Text(String),
    ToolCall,
    ToolCallUpdate,
}

async fn handle_prompt(
    session: &mut agent_client_protocol::ActiveSession<'static, Agent>,
    chunk_tx: &Arc<Mutex<Option<mpsc::UnboundedSender<StreamChunk>>>>,
    text: &str,
    session_id: &str,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<StreamChunk>();
    {
        let mut guard = chunk_tx.lock().await;
        *guard = Some(stream_tx);
    }

    eprintln!("[acp-timing] session={} step=b4 prompt_sent", session_id);
    session
        .send_prompt(text)
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    let mut accumulated = String::new();

    loop {
        let update = session
            .read_update()
            .await
            .map_err(|e| format!("Error reading response: {}", e))?;

        match update {
            SessionMessage::SessionMessage(_dispatch) => {
                while let Ok(chunk) = stream_rx.try_recv() {
                    if let StreamChunk::Text(t) = chunk {
                        accumulated.push_str(&t);
                    }
                }
            }
            SessionMessage::StopReason(_stop) => {
                while let Ok(chunk) = stream_rx.try_recv() {
                    if let StreamChunk::Text(t) = chunk {
                        accumulated.push_str(&t);
                    }
                }

                let _ = app.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        session_id: session_id.to_string(),
                        event_type: "done".to_string(),
                        content: String::new(),
                    },
                );
                break;
            }
            _ => {}
        }
    }

    {
        let mut guard = chunk_tx.lock().await;
        *guard = None;
    }

    Ok(accumulated)
}
