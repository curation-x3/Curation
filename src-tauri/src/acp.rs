use serde::Serialize;
use std::process::Command;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, Mutex};

use agent_client_protocol::mcp_server::McpServer;
use agent_client_protocol::schema::{
    ContentBlock, ContentChunk, InitializeRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionNotification, SessionUpdate,
};
use agent_client_protocol::{
    on_receive_notification, on_receive_request, tool_fn, Agent, Client, ConnectionTo,
    SessionMessage,
};
use agent_client_protocol_tokio::AcpAgent;

use crate::db::CacheDb;
use crate::mcp_server::{CardContext, CurationMcpServer};

// ---------------------------------------------------------------------------
// MCP tool input types
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct EmptyInput {}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct SearchInput {
    /// 搜索关键词
    query: String,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct CardIdInput {
    /// 卡片 ID
    card_id: String,
}

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
/// Detection checks the actual CLI tool; launch uses the ACP adapter (via npx where needed).
pub fn detect_agents() -> Vec<AgentConfig> {
    // (display_name, id, detect_cmd, launch_cmd, launch_args)
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
    let check = if cfg!(target_os = "windows") {
        Command::new("where").arg(cmd).output()
    } else {
        Command::new("which").arg(cmd).output()
    };
    match check {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// ACP Manager — manages a single active ACP session at a time
// ---------------------------------------------------------------------------

/// Internal command sent from Tauri commands to the ACP connection loop.
enum SessionCommand {
    SendPrompt {
        text: String,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Stop,
}

/// Tracks the active connection's communication channel and metadata.
struct ActiveSessionState {
    session_id: String,
    agent_id: String,
    cmd_tx: mpsc::Sender<SessionCommand>,
}

/// Manages ACP agent sessions. Holds at most one active session at a time.
///
/// The ACP SDK's `connect_with` closure pattern means the entire agent connection
/// (initialize, create session, send prompts, read responses) must happen inside a
/// single async block. To bridge this with Tauri's per-command async model, we spawn
/// the connection as a background tokio task and communicate via channels.
pub struct AcpManager {
    active: Mutex<Option<ActiveSessionState>>,
}

impl AcpManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    /// Start a new ACP session with the given agent. If one is already running,
    /// it will be stopped first.
    ///
    /// `system_prompt` is sent as the first prompt to establish context.
    pub async fn start_session(
        &self,
        agent: &AgentConfig,
        session_id: &str,
        system_prompt: &str,
        app: &tauri::AppHandle,
        db: Arc<std::sync::Mutex<Option<CacheDb>>>,
        current_context: Arc<std::sync::Mutex<Option<CardContext>>>,
    ) -> Result<(), String> {
        // Stop any existing session
        self.stop_session().await;

        let (cmd_tx, cmd_rx) = mpsc::channel::<SessionCommand>(32);
        let session_id_owned = session_id.to_string();
        let agent_id = agent.id.clone();
        let system_prompt_owned = system_prompt.to_string();
        let app_handle = app.clone();

        // Build the AcpAgent from the agent config
        let acp_agent = AcpAgent::from_args(
            std::iter::once(agent.command.clone()).chain(agent.args.iter().cloned()),
        )
        .map_err(|e| format!("Failed to create ACP agent: {}", e))?;

        let sid_for_task = session_id_owned.clone();

        // Spawn the ACP connection as a background task
        tokio::spawn(async move {
            let result = run_acp_session(
                acp_agent,
                sid_for_task.clone(),
                system_prompt_owned,
                app_handle.clone(),
                cmd_rx,
                db,
                current_context,
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

        // Store state
        let mut guard = self.active.lock().await;
        *guard = Some(ActiveSessionState {
            session_id: session_id_owned,
            agent_id,
            cmd_tx,
        });

        Ok(())
    }

    /// Send a prompt to the active session. Streams response chunks as
    /// "chat-stream" Tauri events and returns the full accumulated response text.
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

        drop(guard); // Release lock while waiting for response

        reply_rx
            .await
            .map_err(|_| "ACP session task dropped the reply channel".to_string())?
    }

    /// Stop the active session, killing the agent subprocess.
    pub async fn stop_session(&self) {
        let mut guard = self.active.lock().await;
        if let Some(state) = guard.take() {
            let _ = state.cmd_tx.send(SessionCommand::Stop).await;
            // Channel drop will cause the background task to exit
        }
    }

    /// Returns the active session ID, if any.
    pub async fn active_session_id(&self) -> Option<String> {
        let guard = self.active.lock().await;
        guard.as_ref().map(|s| s.session_id.clone())
    }

    /// Returns the active agent ID, if any.
    #[allow(dead_code)]
    pub async fn active_agent_id(&self) -> Option<String> {
        let guard = self.active.lock().await;
        guard.as_ref().map(|s| s.agent_id.clone())
    }
}

/// The core ACP connection loop that runs in a background task.
///
/// This function:
/// 1. Spawns the agent subprocess via AcpAgent
/// 2. Initializes the ACP connection
/// 3. Creates a session
/// 4. Sends the system prompt
/// 5. Loops waiting for prompt commands from the channel
/// 6. For each prompt, sends it and streams response chunks as Tauri events
async fn run_acp_session(
    acp_agent: AcpAgent,
    session_id: String,
    system_prompt: String,
    app: tauri::AppHandle,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    db: Arc<std::sync::Mutex<Option<CacheDb>>>,
    current_context: Arc<std::sync::Mutex<Option<CardContext>>>,
) -> Result<(), String> {
    // We need to use Arc for shared state between the notification handler and the main loop.
    // The notification handler receives streaming chunks from the agent asynchronously.
    let chunk_tx: Arc<Mutex<Option<mpsc::UnboundedSender<StreamChunk>>>> =
        Arc::new(Mutex::new(None));
    let chunk_tx_for_handler = chunk_tx.clone();

    // Flag to suppress frontend emission during system prompt phase
    let emit_enabled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let emit_enabled_for_handler = emit_enabled.clone();

    let session_id_for_handler = session_id.clone();
    let app_for_handler = app.clone();

    let session_id_for_connect = session_id.clone();
    let system_prompt_for_connect = system_prompt;
    let app_for_connect = app.clone();

    // Run the ACP client connection. This blocks until the connection ends.
    let result = Client
        .builder()
        .name("curation-app")
        // Handle streaming session notifications (text chunks, tool calls, etc.)
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                let guard = chunk_tx_for_handler.lock().await;
                if let Some(tx) = guard.as_ref() {
                    let chunk = match &notification.update {
                        SessionUpdate::AgentMessageChunk(ContentChunk {
                            content: ContentBlock::Text(text),
                            ..
                        }) => Some(StreamChunk::Text(text.text.clone())),
                        SessionUpdate::ToolCall(tc) => {
                            Some(StreamChunk::ToolCall(tc.title.clone()))
                        }
                        SessionUpdate::ToolCallUpdate(tcu) => {
                            let title = tcu
                                .fields
                                .title
                                .clone()
                                .unwrap_or_else(|| format!("{}", tcu.tool_call_id));
                            Some(StreamChunk::ToolCallUpdate(title))
                        }
                        _ => None,
                    };
                    if let Some(c) = chunk {
                        let _ = tx.send(c);
                    }
                }
                // Only emit to frontend when not in system prompt phase
                if !emit_enabled_for_handler.load(std::sync::atomic::Ordering::Relaxed) {
                    return Ok(());
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
            },
            on_receive_notification!(),
        )
        // Auto-approve all permission requests (YOLO mode for now)
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
        .connect_with(acp_agent, async move |cx: ConnectionTo<Agent>| {
            let emit_enabled = emit_enabled; // move into closure
            // Step 1: Initialize the ACP connection
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            // Step 2: Build MCP server with curation tools
            let mcp_server = {
                let db1 = db.clone();
                let ctx1 = current_context.clone();
                let db2 = db.clone();
                let ctx2 = current_context.clone();
                let db3 = db.clone();
                let ctx3 = current_context.clone();
                let db4 = db.clone();
                let ctx4 = current_context.clone();

                McpServer::<Agent, _>::builder("curation".to_string())
                    .instructions("Curation 本地数据查询工具。可以获取用户当前阅读的卡片、搜索卡片、获取卡片内容、查看收藏列表。")
                    .tool_fn(
                        "get_current_context",
                        "获取用户当前正在阅读的卡片内容和来源信息",
                        {
                            let db = db1;
                            let ctx = ctx1;
                            async move |_input: EmptyInput, _cx| {
                                let server = CurationMcpServer::new(db.clone(), ctx.clone());
                                server.get_current_context().map_err(|e| {
                                    agent_client_protocol::Error::internal_error().data(e)
                                })
                            }
                        },
                        tool_fn!(),
                    )
                    .tool_fn(
                        "search_cards",
                        "根据关键词搜索卡片（标题、内容）",
                        {
                            let db = db2;
                            let ctx = ctx2;
                            async move |input: SearchInput, _cx| {
                                let server = CurationMcpServer::new(db.clone(), ctx.clone());
                                server.search_cards(&input.query).map_err(|e| {
                                    agent_client_protocol::Error::internal_error().data(e)
                                })
                            }
                        },
                        tool_fn!(),
                    )
                    .tool_fn(
                        "get_card_content",
                        "根据 card_id 获取单张卡片的完整内容",
                        {
                            let db = db3;
                            let ctx = ctx3;
                            async move |input: CardIdInput, _cx| {
                                let server = CurationMcpServer::new(db.clone(), ctx.clone());
                                server.get_card_content(&input.card_id).map_err(|e| {
                                    agent_client_protocol::Error::internal_error().data(e)
                                })
                            }
                        },
                        tool_fn!(),
                    )
                    .tool_fn(
                        "get_favorites",
                        "获取用户收藏的卡片列表",
                        {
                            let db = db4;
                            let ctx = ctx4;
                            async move |_input: EmptyInput, _cx| {
                                let server = CurationMcpServer::new(db.clone(), ctx.clone());
                                server.get_favorites().map_err(|e| {
                                    agent_client_protocol::Error::internal_error().data(e)
                                })
                            }
                        },
                        tool_fn!(),
                    )
                    .build()
            };

            // Step 3: Create a session with MCP server attached
            let cwd =
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
            let mut session = cx
                .build_session(cwd)
                .with_mcp_server(mcp_server)?
                .block_task()
                .start_session()
                .await?;

            // Step 3: Send the system prompt to establish context
            if !system_prompt_for_connect.is_empty() {
                let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<StreamChunk>();
                {
                    let mut guard = chunk_tx.lock().await;
                    *guard = Some(stream_tx);
                }

                session.send_prompt(&system_prompt_for_connect)?;

                // Read until done (system prompt response — we don't emit to frontend)
                loop {
                    let update = session.read_update().await?;
                    match update {
                        SessionMessage::StopReason(_) => break,
                        _ => {
                            // Drain any chunks from the notification handler
                            while stream_rx.try_recv().is_ok() {}
                        }
                    }
                }

                // Clear the chunk sender so notifications aren't buffered
                {
                    let mut guard = chunk_tx.lock().await;
                    *guard = None;
                }
            }

            // Enable frontend emission now that system prompt is done
            emit_enabled.store(true, std::sync::atomic::Ordering::Relaxed);

            // Step 4: Enter the command loop — wait for prompts from the Tauri side
            loop {
                let cmd = match cmd_rx.recv().await {
                    Some(cmd) => cmd,
                    None => break, // Channel closed, session manager dropped
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
        })
        .await;

    result.map_err(|e| format!("ACP connection error: {}", e))
}

/// Internal enum for streaming chunks collected during a prompt.
enum StreamChunk {
    Text(String),
    ToolCall(String),
    ToolCallUpdate(String),
}

/// Handle a single prompt: send it, collect streaming chunks, emit events, return full text.
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

    session
        .send_prompt(text)
        .map_err(|e| format!("Failed to send prompt: {}", e))?;

    let mut accumulated = String::new();

    // Read updates from the session until StopReason
    loop {
        let update = session
            .read_update()
            .await
            .map_err(|e| format!("Error reading response: {}", e))?;

        match update {
            SessionMessage::SessionMessage(_dispatch) => {
                // The notification handler already emitted events to the frontend.
                // Drain the stream_rx to collect text for the accumulated response.
                while let Ok(chunk) = stream_rx.try_recv() {
                    if let StreamChunk::Text(t) = chunk {
                        accumulated.push_str(&t);
                    }
                }
            }
            SessionMessage::StopReason(_stop) => {
                // Drain any remaining chunks
                while let Ok(chunk) = stream_rx.try_recv() {
                    if let StreamChunk::Text(t) = chunk {
                        accumulated.push_str(&t);
                    }
                }

                // Emit done event
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
            _ => {
                // Future SessionMessage variants — ignore gracefully
            }
        }
    }

    // Clear the chunk sender
    {
        let mut guard = chunk_tx.lock().await;
        *guard = None;
    }

    Ok(accumulated)
}
