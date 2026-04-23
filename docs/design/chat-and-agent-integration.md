# Chat and Agent Integration

## 1. Overview

Users can chat with AI agents directly within the curation app while reading card content. The chat panel is embedded in the reader pane -- when a user sends a message, the card content and surrounding context are injected as a system prompt, and the agent can answer questions, summarize, or perform actions (like saving notes) on the user's behalf.

Communication between the Tauri desktop app and external AI agents (Claude Code, Codex CLI, Gemini CLI) uses the **Agent Communication Protocol (ACP)**. ACP is a standardized protocol for client-agent bidirectional messaging. The Rust backend spawns the agent as a subprocess and manages the ACP session lifecycle, while the React frontend handles UI rendering and user interaction.

### Component map

```
ReaderPane.tsx          -- Orchestrator: builds system prompt, wires chat hooks
  ChatInput.tsx         -- Text input, agent selector, status dot, action buttons
  ChatMessages.tsx      -- Message list with markdown rendering + streaming bubble
  CardFrame.tsx         -- Layout wrapper (shrinks card when chat is active)

useChat.ts              -- React hook: session state, message list, streaming buffer
useAgentDetection()     -- React hook: detects available agents on mount

lib/chat.ts             -- Tauri invoke() wrappers for all chat commands
chat_commands.rs        -- #[tauri::command] handlers bridging frontend to ACP
acp.rs                  -- AcpManager: subprocess lifecycle, ACP protocol handling
db.rs                   -- SQLite tables for chat_sessions and chat_messages
```

## 2. Agent Detection

On app startup, `useAgentDetection()` calls `detect_available_agents()` (Tauri command) which delegates to `acp::detect_agents()` in Rust.

### What it checks

Three agents are registered with detection commands:

| Agent | ID | Detection command | Launch command |
|-------|----|-------------------|----------------|
| Claude Code | `claude-acp` | `which claude` | `npx @agentclientprotocol/claude-agent-acp@0.30.0` |
| Codex CLI | `codex-acp` | `which codex` | `npx @zed-industries/codex-acp@0.11.1` |
| Gemini CLI | `gemini-acp` | `which gemini` | `gemini --acp` |

Detection uses `which` (macOS/Linux) or `where` (Windows) to check if the CLI binary exists on PATH. Because Tauri apps launched from the macOS dock inherit a minimal PATH, the detection also probes common install locations as a fallback:

- `~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`, `~/.volta/bin`, `~/.npm-global/bin`
- `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`

Each agent in the returned list has a `detected: boolean` field. The frontend auto-selects the first detected agent. Undetected agents appear in the dropdown but are disabled with a "(not installed)" label.

### What is ACP

ACP (Agent Communication Protocol) is a standardized protocol for client-to-agent communication. The Rust crate `agent_client_protocol` (with `agent_client_protocol_tokio` for async) provides the implementation. Key concepts:

- **Client** -- the app (curation-app) that initiates connections.
- **Agent** -- an external AI CLI tool spawned as a subprocess.
- **Session** -- a bidirectional conversation channel. The client sends prompts; the agent streams back content chunks, tool calls, and tool call updates as `SessionNotification` messages.
- **Permission requests** -- agents may request permission for actions (e.g., file writes). The app auto-approves the first offered option.

## 3. Session Management

### Session-per-card model

Each chat session is scoped to a single card, keyed by `card_id`. When the user navigates to a different card, the hook loads (or creates) a separate session. There is also a **home session** (where `card_id IS NULL`) for chatting without a specific card context.

```
useChat(cardId: string | null)
  cardId = "abc123"  -->  session for that card
  cardId = null       -->  home session (global)
```

### Session lifecycle

1. **Load on navigation**: When `cardId` changes, `useChat` queries the local DB for the most recent session for that card (`get_latest_session_for_card`). If the card has no session yet, the `session` state is null and `messages` is empty.
2. **Create on first message**: A session is lazily created only when the user sends their first message. `createChatSession()` generates a UUID and inserts a row into `chat_sessions`.
3. **Clear session**: The "Clear" button creates a brand-new session for the same card, effectively starting a fresh conversation. The old session remains in the DB but is superseded (the query always picks the most recent by `updated_at`).

### Storage

Sessions and messages are stored in the local encrypted SQLite database (same DB used for card cache, managed by Rust).

**chat_sessions table:**
```sql
CREATE TABLE chat_sessions (
    session_id TEXT PRIMARY KEY,
    card_id TEXT,              -- NULL for home session
    agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_sessions_card ON chat_sessions(card_id);
```

**chat_messages table:**
```sql
CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,         -- "user" or "assistant"
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id)
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
```

Messages are persisted on both sides: user messages are saved before sending to ACP, and assistant responses are saved after the full response is accumulated.

## 4. System Prompt Construction

The system prompt is built by `buildSystemPrompt()` in `ReaderPane.tsx` and passed to the Tauri command on each message send. It is only prepended to the ACP prompt for the **first message** of a new session (i.e., when `is_new_session` is true in `chat_commands.rs`).

### What gets injected

The prompt includes these sections:

1. **App context**: Explains that the user is reading a card in the Curation app and describes what Curation does (AI news curation from WeChat public accounts).

2. **CLI tool instructions**: Documents the `curation` CLI that the agent can use to query and operate on the user's card library. Key commands: `curation card list --range today`, `curation card show <card_id>`. Instructs the agent to run `curation help` first rather than guessing usage.

3. **Notes path**: If the user has configured a notes directory in settings (`localStorage.getItem("notesPath")`), it is included so the agent knows where to save files.

4. **Current card content**: The full markdown content of the card the user is reading, including the article title and account name.

### Format (simplified)

```
你正在通过 Curation 应用与用户对话。用户正在阅读一张卡片...

## 可用工具（curation CLI）
你可以通过终端执行 `curation` 命令...
使用前先运行 `curation help`...

用户的笔记路径：/path/to/notes    <-- only if configured

## 当前上下文
用户正在阅读「Article Title」（Account Name）：

<full card markdown content>
```

### How it reaches the agent

In `chat_commands.rs`, `send_chat_message()` prepends the system prompt to the user's message for new sessions:

```rust
let prompt = if is_new_session && !system_prompt.is_empty() {
    format!("{}\n\n---\n\n用户提问：{}", system_prompt, message)
} else {
    message.clone()
};
```

On subsequent messages within the same session, only the raw user message is sent (the agent retains conversation context via the ACP session).

## 5. Streaming

### Data flow

```
User types message
  --> ChatInput.onSend(text)
    --> ReaderPane.handleSend(text)
      --> useChat.sendMessage(text, agentId, systemPrompt)
        --> Tauri invoke("send_chat_message", ...)
          --> chat_commands.rs: save user msg to DB, ensure ACP session, send prompt
            --> acp.rs: AcpManager.send_prompt()
              --> ACP protocol: session.send_prompt(text)
                --> Agent subprocess processes and streams back

Agent streams response:
  SessionNotification(AgentMessageChunk) --> on_receive_notification handler
    --> app.emit("chat-stream", { event_type: "text_chunk", content: "..." })
      --> Tauri event system --> frontend listen("chat-stream")
        --> useChat event handler: buffers chunks

  SessionMessage(StopReason) --> handle_prompt loop
    --> app.emit("chat-stream", { event_type: "done" })
      --> useChat: typing timer flushes buffer, reloads messages from DB
```

### Event types

The `chat-stream` Tauri event carries a `ChatStreamEvent` with these event types:

| event_type | Meaning | content |
|------------|---------|---------|
| `text_chunk` | Incremental text from agent | The text fragment |
| `tool_call` | Agent invoked a tool | Tool title |
| `tool_call_update` | Tool execution progress | Updated title or tool_call_id |
| `done` | Response complete | Empty string |
| `error` | ACP session error | Error message |

### Typing animation buffer

Raw chunks from ACP arrive in bursts. To provide a smooth typing effect, `useChat` implements a character-level animation buffer:

1. **Incoming chunks** are appended to `bufferRef` (not displayed immediately).
2. **A 20ms interval timer** (50fps) reveals characters from the buffer at a dynamic rate: `max(1, min(8, ceil(pending / 10)))` characters per tick. More buffered text means faster reveal.
3. **On `done` event**: `doneRef` is set to true. The timer continues flushing remaining buffer, then finalizes -- clears streaming state, reloads messages from DB, resets all refs.
4. **On `error` event**: Timer is immediately cleared, all buffers reset, status set to `"error"`.

### Auto-scroll

Auto-scrolling during streaming uses `requestAnimationFrame` throttling to avoid layout thrashing:

```typescript
useEffect(() => {
    if (!chat.isStreaming || !chat.streamingContent) return;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        rafRef.current = null;
    });
}, [chat.streamingContent, chat.isStreaming]);
```

This ensures at most one scroll per animation frame, even if `streamingContent` updates many times between frames.

### Waiting indicator

When `isStreaming` is true but `streamingContent` is still empty (agent hasn't started responding yet), `ChatMessages` shows a random waiting message like "Waking up {agent}..." with animated dots.

## 6. Save to Notes

The "Save to Notes" button in `ChatInput` triggers a prompt injection flow rather than direct file I/O:

1. User clicks the bookmark icon ("Save to Notes" button).
2. `ReaderPane.handleSaveToNotes()` constructs a message asking the agent to save content to notes.
3. This message is sent through the normal `sendMessage()` path with the full system prompt (which includes the notes path from settings).
4. The agent (e.g., Claude Code) uses its file system tools to write the content to the user's configured notes directory.

The prompt varies by context:
- **Card view**: "Please save the current card content to my notes. The card content is already in context, use it directly."
- **Home view**: "Please save the key points from our conversation to my notes."

This design delegates file operations to the agent, which already has CLI/filesystem access, rather than implementing a separate save mechanism in the app.

## 7. Connection Status

### States

Connection status is tracked as a four-state enum in `useChat`:

| Status | Meaning | Trigger |
|--------|---------|---------|
| `disconnected` | No active stream | Initial state, after `done` event, after cancel |
| `connecting` | Message sent, waiting for first chunk | Set when `sendMessage()` is called |
| `connected` | Receiving chunks from agent | Set on first `text_chunk` event |
| `error` | ACP session error | Set on `error` event |

### Display

`ChatInput` renders a colored status dot next to the agent selector:

| Status | Color | Label |
|--------|-------|-------|
| `connected` | Green (`--accent-green`) | "Connected" |
| `connecting` | Gold (`--accent-gold`) | "Connecting..." |
| `disconnected` | Muted (`--text-muted`) | "Ready" |
| `error` | Red (`--accent-red`) | "Disconnected" |

A special case: if the selected agent is not installed (`detected: false`), the status shows red with "Not installed" regardless of connection state.

### ACP session lifecycle on the Rust side

The `AcpManager` maintains at most one active ACP session at a time:

1. **Start**: `start_session()` stops any existing session, spawns a new agent subprocess via `AcpAgent::from_args()`, initializes the ACP protocol (`InitializeRequest`), and starts an ACP session. A background tokio task runs the session loop.
2. **Send**: `send_prompt()` sends a `SessionCommand::SendPrompt` through an mpsc channel to the session task. The task calls `session.send_prompt()` and reads updates in a loop until `StopReason`.
3. **Stop**: `stop_session()` sends `SessionCommand::Stop` through the channel, ending the session loop and dropping the subprocess.
4. **Session reuse**: Within a single chat session (same `session_id`), the ACP session is reused across multiple prompts. A new ACP session is only started when the chat session changes (navigating to a different card or clearing the session).
