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
// ACP Manager — manages a single active ACP session at a time
// ---------------------------------------------------------------------------

enum SessionCommand {
    SendPrompt {
        text: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Stop,
}

struct ActiveSessionState {
    session_id: String,
    _agent_id: String,
    cmd_tx: mpsc::Sender<SessionCommand>,
}

pub struct AcpManager {
    active: Mutex<Option<ActiveSessionState>>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub async fn start_session(
        &self,
        agent: &AgentConfig,
        session_id: &str,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        self.stop_session().await;

        let mut timing = AcpTiming::new(session_id);

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);
        let session_id_owned = session_id.to_string();
        let agent_id = agent.id.clone();
        let app_handle = app.clone();

        let acp_agent = AcpAgent::from_args(
            std::iter::once(agent.command.clone()).chain(agent.args.iter().cloned()),
        )
        .map_err(|e| format!("Failed to create ACP agent: {}", e))?;
        timing.mark("b1 subprocess_spawned");

        let sid_for_task = session_id_owned.clone();
        let timing = Arc::new(Mutex::new(timing));

        tokio::spawn(async move {
            let result = run_acp_session(
                acp_agent,
                sid_for_task.clone(),
                app_handle.clone(),
                cmd_rx,
                timing,
            )
            .await;

            if let Err(e) = result {
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

        let mut guard = self.active.lock().await;
        *guard = Some(ActiveSessionState {
            session_id: session_id_owned,
            _agent_id: agent_id,
            cmd_tx,
        });

        Ok(())
    }

    pub async fn send_prompt(
        &self,
        text: &str,
        _app: &tauri::AppHandle,
    ) -> Result<String, String> {
        let guard = self.active.lock().await;
        let state = guard.as_ref().ok_or("No active ACP session")?;

        let (reply_tx, reply_rx) = oneshot::channel();
        state
            .cmd_tx
            .send(SessionCommand::SendPrompt {
                text: text.to_string(),
                reply: reply_tx,
            })
            .await
            .map_err(|_| "ACP session task has exited".to_string())?;

        drop(guard);

        reply_rx
            .await
            .map_err(|_| "ACP session task dropped the reply channel".to_string())?
    }

    pub async fn stop_session(&self) {
        let mut guard = self.active.lock().await;
        if let Some(state) = guard.take() {
            let _ = state.cmd_tx.send(SessionCommand::Stop).await;
        }
    }

    pub async fn active_session_id(&self) -> Option<String> {
        let guard = self.active.lock().await;
        guard.as_ref().map(|s| s.session_id.clone())
    }
}

async fn run_acp_session(
    acp_agent: AcpAgent,
    session_id: String,
    app: tauri::AppHandle,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    timing: Arc<Mutex<AcpTiming>>,
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
