use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

fn decode_string_array(raw: Option<String>) -> Option<Vec<String>> {
    let s = raw?;
    serde_json::from_str::<Vec<String>>(&s).ok()
}

fn encode_string_array(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(_) => Some(value.to_string()),
        _ => None,
    }
}

fn decode_json_value(raw: Option<String>) -> Option<serde_json::Value> {
    raw.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
}

fn encode_json_object(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(_) => Some(value.to_string()),
        _ => None,
    }
}

fn value_string_array(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        serde_json::Value::String(s) => serde_json::from_str::<Vec<String>>(s).unwrap_or_default(),
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardRow {
    pub card_id: String,
    pub article_id: String,
    pub kind: Option<String>,
    pub source_card_ids: Option<Vec<String>>,
    pub source_article_ids: Option<Vec<String>>,
    pub title: Option<String>,
    pub article_title: Option<String>,
    pub content_md: Option<String>,
    pub additional_content: Option<String>,
    pub description: Option<String>,
    pub routing: Option<String>,
    pub template: Option<String>,
    pub template_reason: Option<String>,
    pub card_date: Option<String>,
    pub account: Option<String>,
    pub author: Option<String>,
    pub url: Option<String>,
    pub read_at: Option<String>,
    pub updated_at: String,
    pub publish_time: Option<String>,
    pub account_id: Option<i64>,
    pub biz: Option<String>,
    pub cover_url: Option<String>,
    pub digest: Option<String>,
    pub word_count: Option<i64>,
    pub is_original: Option<i64>,
    /// JSON-encoded array of canonical entity name strings, e.g. `["Anthropic","Claude Mythos"]`.
    /// Stored as TEXT in SQLite; the frontend parses it back to `string[]`.
    pub entities: Option<String>,
    pub topic: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteRow {
    pub item_type: String,
    pub item_id: String,
    pub created_at: String,
    pub synced: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub card_id: String,
    pub title: Option<String>,
    pub article_id: String,
    pub account: Option<String>,
    pub card_date: Option<String>,
    pub highlight: String,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRow {
    pub id: i64,
    pub biz: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub description: Option<String>,
    pub last_monitored_at: Option<String>,
    pub article_count: Option<i64>,
    pub subscription_type: Option<String>,
    pub sync_count: Option<i64>,
}

pub struct SyncQueueItem {
    pub id: i64,
    pub action: String,
    pub payload: String,
    pub created_at: String,
    pub retries: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChatSession {
    pub session_id: String,
    pub card_id: Option<String>,
    pub agent_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// CacheDb
// ---------------------------------------------------------------------------

pub struct CacheDb {
    conn: Mutex<Connection>,
}

impl CacheDb {
    /// Open an existing encrypted database.
    pub fn open(path: &PathBuf, hex_key: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let pragma = format!("PRAGMA key = \"x'{}'\";", hex_key);
        conn.execute_batch(&pragma).map_err(|e| e.to_string())?;
        // Verify the key works
        conn.execute_batch("SELECT count(*) FROM sqlite_master;")
            .map_err(|e| format!("Failed to open encrypted DB (wrong key?): {}", e))?;
        Self::ensure_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Create a fresh encrypted database (deletes existing file first).
    pub fn create(path: &PathBuf, hex_key: &str) -> Result<Self, String> {
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Self::open(path, hex_key)
    }

    fn ensure_schema(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS cards (
                card_id TEXT PRIMARY KEY,
                article_id TEXT NOT NULL,
                kind TEXT,
                source_card_ids TEXT,
                source_article_ids TEXT,
                title TEXT,
                article_title TEXT,
                content_md TEXT,
                additional_content TEXT,
                description TEXT,
                routing TEXT,
                template TEXT,
                template_reason TEXT,
                card_date TEXT,
                account TEXT,
                author TEXT,
                url TEXT,
                read_at TEXT,
                updated_at TEXT NOT NULL,
                publish_time TEXT,
                account_id INTEGER,
                biz TEXT,
                cover_url TEXT,
                digest TEXT,
                word_count INTEGER,
                is_original INTEGER,
                entities TEXT,
                topic TEXT
            );
            CREATE TABLE IF NOT EXISTS wechat_articles (
                article_id TEXT PRIMARY KEY,
                content_html TEXT,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS favorites (
                item_type TEXT NOT NULL,
                item_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced INTEGER DEFAULT 0,
                PRIMARY KEY (item_type, item_id)
            );
            CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                retries INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sync_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS wechat_subscriptions (
                id INTEGER PRIMARY KEY,
                biz TEXT NOT NULL,
                name TEXT,
                avatar_url TEXT,
                description TEXT,
                last_monitored_at TEXT,
                article_count INTEGER,
                subscription_type TEXT DEFAULT 'subscribed',
                sync_count INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS discoverable_wechat_accounts (
                biz TEXT PRIMARY KEY,
                name TEXT,
                avatar_url TEXT,
                description TEXT,
                account_type TEXT,
                already_subscribed INTEGER DEFAULT 0
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
                title, content_md, content=cards, content_rowid=rowid,
                tokenize='unicode61'
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // Rename legacy table names to mirror the server's wechat_* schema.
        // Done before any of the column-level migrations below so probes that
        // still reference the old names will fail naturally; we want everything
        // downstream to see the new names.
        for (old_name, new_name) in [
            ("articles", "wechat_articles"),
            ("accounts", "wechat_subscriptions"),
            ("discoverable_accounts", "discoverable_wechat_accounts"),
        ] {
            let old_exists: bool = conn
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                    [old_name],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            let new_exists: bool = conn
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
                    [new_name],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            if old_exists && !new_exists {
                let sql = format!("ALTER TABLE {} RENAME TO {}", old_name, new_name);
                let _ = conn.execute(&sql, []);
            } else if old_exists && new_exists {
                // Both exist (CREATE TABLE IF NOT EXISTS already ran). Drop the
                // empty new one and rename the old one over it. CREATE just ran
                // above this code, so the new table is empty by construction.
                let drop_sql = format!("DROP TABLE {}", new_name);
                let _ = conn.execute(&drop_sql, []);
                let rename_sql = format!("ALTER TABLE {} RENAME TO {}", old_name, new_name);
                let _ = conn.execute(&rename_sql, []);
            }
        }

        // Add publish_time if missing (migration for existing DBs)
        let has_col = conn
            .prepare("SELECT publish_time FROM cards LIMIT 0")
            .is_ok();
        if !has_col {
            conn.execute("ALTER TABLE cards ADD COLUMN publish_time TEXT", [])
                .map_err(|e| e.to_string())?;
        }

        // Add article_title if missing (migration for existing DBs)
        let has_article_title = conn
            .prepare("SELECT article_title FROM cards LIMIT 0")
            .is_ok();
        if !has_article_title {
            conn.execute("ALTER TABLE cards ADD COLUMN article_title TEXT", [])
                .map_err(|e| e.to_string())?;
        }

        // Additive migrations for the 5 article fields added mid-project.
        // If any of these are still missing locally, add the column AND reset
        // the sync cursor so the next sync pulls the full dataset (server-side
        // /sync is cursor-filtered by updated_at; untouched rows otherwise
        // never backfill the new columns).
        let mut reset_cursor = false;
        for (name, ddl) in [
            (
                "account_id",
                "ALTER TABLE cards ADD COLUMN account_id INTEGER",
            ),
            ("biz", "ALTER TABLE cards ADD COLUMN biz TEXT"),
            ("cover_url", "ALTER TABLE cards ADD COLUMN cover_url TEXT"),
            ("digest", "ALTER TABLE cards ADD COLUMN digest TEXT"),
            (
                "word_count",
                "ALTER TABLE cards ADD COLUMN word_count INTEGER",
            ),
            (
                "is_original",
                "ALTER TABLE cards ADD COLUMN is_original INTEGER",
            ),
            ("template", "ALTER TABLE cards ADD COLUMN template TEXT"),
            (
                "template_reason",
                "ALTER TABLE cards ADD COLUMN template_reason TEXT",
            ),
            ("entities", "ALTER TABLE cards ADD COLUMN entities TEXT"),
            (
                "additional_content",
                "ALTER TABLE cards ADD COLUMN additional_content TEXT",
            ),
            ("kind", "ALTER TABLE cards ADD COLUMN kind TEXT"),
            (
                "source_card_ids",
                "ALTER TABLE cards ADD COLUMN source_card_ids TEXT",
            ),
            (
                "source_article_ids",
                "ALTER TABLE cards ADD COLUMN source_article_ids TEXT",
            ),
            ("topic", "ALTER TABLE cards ADD COLUMN topic TEXT"),
        ] {
            let probe = format!("SELECT {} FROM cards LIMIT 0", name);
            if !conn.prepare(&probe).is_ok() {
                conn.execute(ddl, []).map_err(|e| e.to_string())?;
                reset_cursor = true;
            }
        }
        // Drop the legacy `subtype` column if it lingers from a pre-2026-05-03
        // schema. Its values were copied into `template` by the server backfill;
        // for local dbs we just clear and re-sync (last_sync_ts already reset
        // above when the new column got added).
        if conn.prepare("SELECT subtype FROM cards LIMIT 0").is_ok() {
            // SQLite ≥3.25 supports DROP COLUMN; if it fails (very old build)
            // we fall back to ignoring it — the column is unused.
            let _ = conn.execute("ALTER TABLE cards DROP COLUMN subtype", []);
        }
        // One-shot rename: article_date → card_date (cards-redesign Phase 6 followup).
        // SQLite ≥3.25 supports RENAME COLUMN; if the column is already named
        // card_date (fresh install or already migrated) the statement silently
        // fails and we carry on.
        if conn
            .prepare("SELECT article_date FROM cards LIMIT 0")
            .is_ok()
        {
            let _ = conn.execute(
                "ALTER TABLE cards RENAME COLUMN article_date TO card_date",
                [],
            );
        }
        if reset_cursor {
            conn.execute("DELETE FROM sync_state WHERE key = 'last_sync_ts'", [])
                .ok();
        }

        // One-shot backfill for existing installs: some users had the columns
        // added in an earlier migration run but cursor never reset, so legacy
        // rows still have NULL cover_url/digest/etc. Detect and force a single
        // full re-pull using a marker in sync_state.
        const BACKFILL_MARKER: &str = "backfill_article_fields_v1";
        let already_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [BACKFILL_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !already_done {
            // Are there any rows that *could* benefit (cards exist, cover_url is null)?
            let stale: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM cards WHERE cover_url IS NULL",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if stale > 0 {
                conn.execute("DELETE FROM sync_state WHERE key = 'last_sync_ts'", [])
                    .ok();
            }
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [BACKFILL_MARKER],
            )
            .ok();
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id TEXT PRIMARY KEY,
                card_id TEXT,
                agent_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_card ON chat_sessions(card_id);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (session_id) REFERENCES chat_sessions(session_id)
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .map_err(|e| e.to_string())?;

        // 2026-05-04: server reassigned every card_id to a fresh ULID. Old
        // local references (cards.card_id, chat_sessions.card_id, favorites
        // for cards, fts content) now point at IDs that no longer exist on
        // the server. Detect via a marker and do a hard local reset:
        // wipe the card-side cache + chat (chat is local-only, but its
        // card_id column references would be orphans), then drop
        // last_sync_ts so the next /sync rebuilds everything.
        const ULID_MIGRATION_MARKER: &str = "card_id_format_v2_ulid";
        let ulid_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [ULID_MIGRATION_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !ulid_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM favorites WHERE item_type = 'card';
                 DELETE FROM chat_messages;
                 DELETE FROM chat_sessions;
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [ULID_MIGRATION_MARKER],
            )
            .ok();
        }

        // 2026-05-05: dedup visibility became cache-enforced. Older local
        // caches may still hold source cards that the server now supersedes.
        // Clear card-side state once so /sync rebuilds from current delivery
        // visibility and carries kind/source_* metadata.
        const DEDUP_CACHE_MARKER: &str = "dedup_cache_replacement_v1";
        let dedup_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [DEDUP_CACHE_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !dedup_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM favorites WHERE item_type = 'card';
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [DEDUP_CACHE_MARKER],
            )
            .ok();
        }

        // 2026-05-05: dedup reruns generate fresh aggregate card IDs. Older
        // local caches can retain the previous aggregate because /sync only
        // returns currently visible cards, not tombstones. Rebuild once; the
        // sync upsert below also prunes overlapping old deduped cards.
        const DEDUP_RERUN_MARKER: &str = "dedup_rerun_replacement_v1";
        let rerun_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [DEDUP_RERUN_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !rerun_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM favorites WHERE item_type = 'card';
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [DEDUP_RERUN_MARKER],
            )
            .ok();
        }

        // 2026-05-06: /sync now carries cards.additional_content so
        // original_content_with_* rows can render rich original HTML from
        // local SQLite. Rebuild card cache once so existing rows receive it.
        const ADDITIONAL_CONTENT_MARKER: &str = "additional_content_sync_v1";
        let additional_content_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [ADDITIONAL_CONTENT_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !additional_content_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [ADDITIONAL_CONTENT_MARKER],
            )
            .ok();
        }

        // 2026-05-06: /sync now carries card.content as cards.content_md.
        // Card body reads should be local-cache reads, not per-card lazy
        // network fetches. Rebuild once so existing rows receive content_md.
        const CONTENT_MD_SYNC_MARKER: &str = "content_md_sync_v1";
        let content_md_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [CONTENT_MD_SYNC_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !content_md_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [CONTENT_MD_SYNC_MARKER],
            )
            .ok();
        }

        // 2026-05-07: /sync now carries inline Atlas topic refs. Rebuild
        // local card rows once so the map can derive its taxonomy locally.
        const MAP_TOPIC_SYNC_MARKER: &str = "map_topic_sync_v1";
        let map_topic_done: bool = conn
            .query_row(
                "SELECT 1 FROM sync_state WHERE key = ?1",
                [MAP_TOPIC_SYNC_MARKER],
                |r| r.get::<_, i64>(0),
            )
            .is_ok();
        if !map_topic_done {
            let _ = conn.execute_batch(
                "DELETE FROM cards;
                 DELETE FROM cards_fts;
                 DELETE FROM wechat_articles;
                 DELETE FROM sync_state WHERE key = 'last_sync_ts';",
            );
            conn.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?1, '1')",
                [MAP_TOPIC_SYNC_MARKER],
            )
            .ok();
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    pub fn get_inbox_cards(
        &self,
        account: Option<&str>,
        unread_only: bool,
    ) -> Result<Vec<CardRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut sql = String::from(
            "SELECT card_id, article_id, kind, source_card_ids, source_article_ids,
                    title, article_title, content_md, additional_content, description, routing,
                    template, template_reason, card_date, account, author, url, read_at, updated_at, publish_time,
                    account_id, biz, cover_url, digest, word_count, is_original, entities, topic
             FROM cards WHERE routing IS NOT NULL",
        );
        if let Some(_) = account {
            sql.push_str(" AND account = ?1");
        }
        if unread_only {
            sql.push_str(" AND read_at IS NULL");
        }
        sql.push_str(" ORDER BY card_date DESC, publish_time DESC");

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        let rows = if let Some(acct) = account {
            stmt.query_map([acct], |row| {
                Ok(CardRow {
                    card_id: row.get(0)?,
                    article_id: row.get(1)?,
                    kind: row.get(2)?,
                    source_card_ids: decode_string_array(row.get::<_, Option<String>>(3)?),
                    source_article_ids: decode_string_array(row.get::<_, Option<String>>(4)?),
                    title: row.get(5)?,
                    article_title: row.get(6)?,
                    content_md: row.get(7)?,
                    additional_content: row.get(8)?,
                    description: row.get(9)?,
                    routing: row.get(10)?,
                    template: row.get(11)?,
                    template_reason: row.get(12)?,
                    card_date: row.get(13)?,
                    account: row.get(14)?,
                    author: row.get(15)?,
                    url: row.get(16)?,
                    read_at: row.get(17)?,
                    updated_at: row.get(18)?,
                    publish_time: row.get(19)?,
                    account_id: row.get(20)?,
                    biz: row.get(21)?,
                    cover_url: row.get(22)?,
                    digest: row.get(23)?,
                    word_count: row.get(24)?,
                    is_original: row.get(25)?,
                    entities: row.get(26)?,
                    topic: decode_json_value(row.get::<_, Option<String>>(27)?),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        } else {
            stmt.query_map([], |row| {
                Ok(CardRow {
                    card_id: row.get(0)?,
                    article_id: row.get(1)?,
                    kind: row.get(2)?,
                    source_card_ids: decode_string_array(row.get::<_, Option<String>>(3)?),
                    source_article_ids: decode_string_array(row.get::<_, Option<String>>(4)?),
                    title: row.get(5)?,
                    article_title: row.get(6)?,
                    content_md: row.get(7)?,
                    additional_content: row.get(8)?,
                    description: row.get(9)?,
                    routing: row.get(10)?,
                    template: row.get(11)?,
                    template_reason: row.get(12)?,
                    card_date: row.get(13)?,
                    account: row.get(14)?,
                    author: row.get(15)?,
                    url: row.get(16)?,
                    read_at: row.get(17)?,
                    updated_at: row.get(18)?,
                    publish_time: row.get(19)?,
                    account_id: row.get(20)?,
                    biz: row.get(21)?,
                    cover_url: row.get(22)?,
                    digest: row.get(23)?,
                    word_count: row.get(24)?,
                    is_original: row.get(25)?,
                    entities: row.get(26)?,
                    topic: decode_json_value(row.get::<_, Option<String>>(27)?),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        };

        Ok(rows)
    }

    pub fn get_favorites(&self) -> Result<Vec<FavoriteRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT item_type, item_id, created_at, synced FROM favorites ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FavoriteRow {
                    item_type: row.get(0)?,
                    item_id: row.get(1)?,
                    created_at: row.get(2)?,
                    synced: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn get_card_content(&self, card_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT content_md FROM cards WHERE card_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([card_id], |row| row.get::<_, Option<String>>(0))
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(content)) => Ok(content),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    /// Legacy fallback for manually patching card content. Normal card body
    /// reads are populated by /sync into content_md.
    pub fn set_card_content(&self, card_id: &str, content_md: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cards SET content_md = ?1 WHERE card_id = ?2",
            rusqlite::params![content_md, card_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_article_content(&self, article_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT content_html FROM wechat_articles WHERE article_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([article_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(html)) => Ok(Some(html)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn mark_read(&self, card_id: &str, read_at: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cards SET read_at = ?1 WHERE card_id = ?2",
            rusqlite::params![read_at, card_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_queue (action, payload, created_at) VALUES ('mark_read', ?1, ?2)",
            rusqlite::params![serde_json::json!({"card_id": card_id}).to_string(), read_at,],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_unread(&self, card_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE cards SET read_at = NULL WHERE card_id = ?1",
            rusqlite::params![card_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_queue (action, payload, created_at) VALUES ('mark_unread', ?1, ?2)",
            rusqlite::params![serde_json::json!({"card_id": card_id}).to_string(), now,],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_favorite(&self, item_type: &str, item_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO favorites (item_type, item_id, created_at, synced) VALUES (?1, ?2, ?3, 0)",
            rusqlite::params![item_type, item_id, now],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_queue (action, payload, created_at) VALUES ('add_favorite', ?1, ?2)",
            rusqlite::params![
                serde_json::json!({"item_type": item_type, "item_id": item_id}).to_string(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_favorite(&self, item_type: &str, item_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "DELETE FROM favorites WHERE item_type = ?1 AND item_id = ?2",
            rusqlite::params![item_type, item_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_queue (action, payload, created_at) VALUES ('remove_favorite', ?1, ?2)",
            rusqlite::params![
                serde_json::json!({"item_type": item_type, "item_id": item_id}).to_string(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn search_cards(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        // Sanitize FTS5 query: escape special chars, wrap in double quotes for phrase match
        let sanitized = query.replace('"', "\"\"");
        let fts_query = format!("\"{}\"", sanitized);

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT c.card_id, c.title, c.article_id, c.account, c.card_date,
                        snippet(cards_fts, 1, '<mark>', '</mark>', '...', 32),
                        CASE WHEN fav.item_id IS NOT NULL THEN 1 ELSE 0 END as is_fav
                 FROM cards_fts f
                 JOIN cards c ON c.rowid = f.rowid
                 LEFT JOIN favorites fav ON fav.item_type = 'card' AND fav.item_id = c.card_id
                 WHERE cards_fts MATCH ?1
                 ORDER BY is_fav DESC, rank
                 LIMIT 50",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&fts_query], |row| {
                Ok(SearchResult {
                    card_id: row.get(0)?,
                    title: row.get(1)?,
                    article_id: row.get(2)?,
                    account: row.get(3)?,
                    card_date: row.get(4)?,
                    highlight: row.get(5)?,
                    is_favorite: row.get::<_, i32>(6)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    // -----------------------------------------------------------------------
    // Accounts cache
    // -----------------------------------------------------------------------

    pub fn get_cached_accounts(&self) -> Result<Vec<AccountRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, biz, name, avatar_url, description, last_monitored_at,
                        article_count, subscription_type, sync_count
                 FROM wechat_subscriptions ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AccountRow {
                    id: row.get(0)?,
                    biz: row.get(1)?,
                    name: row.get(2)?,
                    avatar_url: row.get(3)?,
                    description: row.get(4)?,
                    last_monitored_at: row.get(5)?,
                    article_count: row.get(6)?,
                    subscription_type: row.get(7)?,
                    sync_count: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn upsert_accounts(&self, accounts: &[serde_json::Value]) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN TRANSACTION")
            .map_err(|e| e.to_string())?;
        // Replace all — server is source of truth
        conn.execute("DELETE FROM wechat_subscriptions", [])
            .map_err(|e| e.to_string())?;
        let mut count = 0usize;
        for acct in accounts {
            conn.execute(
                "INSERT INTO wechat_subscriptions (id, biz, name, avatar_url, description,
                 last_monitored_at, article_count, subscription_type, sync_count)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                rusqlite::params![
                    acct["id"].as_i64().unwrap_or(0),
                    acct["biz"].as_str().unwrap_or_default(),
                    acct["name"].as_str(),
                    acct["avatar_url"].as_str(),
                    acct["description"].as_str(),
                    acct["last_monitored_at"].as_str(),
                    acct["article_count"].as_i64(),
                    acct["subscription_type"].as_str().unwrap_or("subscribed"),
                    acct["sync_count"].as_i64(),
                ],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn get_cached_discoverable_accounts(&self) -> Result<Vec<serde_json::Value>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT biz, name, avatar_url, description, account_type, already_subscribed
                 FROM discoverable_wechat_accounts ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "biz": row.get::<_, String>(0)?,
                    "name": row.get::<_, Option<String>>(1)?,
                    "avatar_url": row.get::<_, Option<String>>(2)?,
                    "description": row.get::<_, Option<String>>(3)?,
                    "account_type": row.get::<_, Option<String>>(4)?,
                    "already_subscribed": row.get::<_, i64>(5)? != 0,
                }))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn upsert_discoverable_accounts(
        &self,
        accounts: &[serde_json::Value],
    ) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN TRANSACTION")
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM discoverable_wechat_accounts", [])
            .map_err(|e| e.to_string())?;
        let mut count = 0usize;
        for acct in accounts {
            conn.execute(
                "INSERT INTO discoverable_wechat_accounts (biz, name, avatar_url, description, account_type, already_subscribed)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                rusqlite::params![
                    acct["biz"].as_str().unwrap_or_default(),
                    acct["name"].as_str(),
                    acct["avatar_url"].as_str(),
                    acct["description"].as_str(),
                    acct["account_type"].as_str(),
                    if acct["already_subscribed"].as_bool().unwrap_or(false) { 1i64 } else { 0i64 },
                ],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        Ok(count)
    }

    // -----------------------------------------------------------------------
    // Sync helpers
    // -----------------------------------------------------------------------

    pub fn upsert_cards(&self, cards: &[serde_json::Value]) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN TRANSACTION")
            .map_err(|e| e.to_string())?;
        let mut count = 0usize;
        let mut superseded_source_ids: Vec<String> = Vec::new();
        for card in cards {
            let card_id = card["card_id"].as_str().unwrap_or_default();
            let source_card_ids_json = encode_string_array(&card["source_card_ids"]);
            let source_article_ids_json = encode_string_array(&card["source_article_ids"]);
            if card["kind"].as_str() == Some("deduped") {
                let source_ids = value_string_array(&card["source_card_ids"]);
                for source_id in &source_ids {
                    let mut stmt = conn
                        .prepare(
                            "SELECT card_id, rowid FROM cards
                             WHERE kind = 'deduped'
                               AND card_id <> ?1
                               AND source_card_ids LIKE ?2",
                        )
                        .map_err(|e| e.to_string())?;
                    let pattern = format!("%{}%", source_id.replace('%', "\\%").replace('_', "\\_"));
                    let old_rows = stmt
                        .query_map(rusqlite::params![card_id, pattern], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })
                        .map_err(|e| e.to_string())?
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?;
                    drop(stmt);
                    for (old_card_id, old_rowid) in old_rows {
                        conn.execute(
                            "DELETE FROM cards_fts WHERE rowid = ?1",
                            rusqlite::params![old_rowid],
                        )
                        .ok();
                        conn.execute("DELETE FROM cards WHERE card_id = ?1", [old_card_id])
                            .map_err(|e| e.to_string())?;
                    }
                }
                for source_id in source_ids {
                    if source_id != card_id {
                        superseded_source_ids.push(source_id);
                    }
                }
            }
            // Delete old FTS entry (get rowid first)
            if let Ok(rowid) = conn.query_row(
                "SELECT rowid FROM cards WHERE card_id = ?1",
                [card_id],
                |r| r.get::<_, i64>(0),
            ) {
                conn.execute(
                    "DELETE FROM cards_fts WHERE rowid = ?1",
                    rusqlite::params![rowid],
                )
                .ok();
            }
            // Server sends entities as a JSON array; we store the JSON-stringified
            // array as TEXT (frontend parses on the way out). Tolerate either an
            // already-stringified value or a real JSON array in the payload.
            let entities_json: Option<String> = match &card["entities"] {
                v => encode_string_array(v),
            };
            let topic_json = encode_json_object(&card["topic"]);
            // UPSERT. Server /sync owns content_md and additional_content;
            // both overwrite local values so card bodies and rich original
            // HTML are available from SQLite.
            conn.execute(
                "INSERT INTO cards
                 (card_id, article_id, kind, source_card_ids, source_article_ids,
                  title, article_title, content_md, additional_content, description, routing,
                  template, template_reason, card_date, account, author, url, read_at, updated_at, publish_time,
                  account_id, biz, cover_url, digest, word_count, is_original, entities, topic)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28)
                 ON CONFLICT(card_id) DO UPDATE SET
                   article_id      = excluded.article_id,
                   kind            = excluded.kind,
                   source_card_ids = excluded.source_card_ids,
                   source_article_ids = excluded.source_article_ids,
                   title           = excluded.title,
                   article_title   = excluded.article_title,
                   content_md      = excluded.content_md,
                   additional_content = excluded.additional_content,
                   description     = excluded.description,
                   routing         = excluded.routing,
                   template        = excluded.template,
                   template_reason = excluded.template_reason,
                   card_date       = excluded.card_date,
                   account         = excluded.account,
                   author          = excluded.author,
                   url             = excluded.url,
                   read_at         = excluded.read_at,
                   updated_at      = excluded.updated_at,
                   publish_time    = excluded.publish_time,
                   account_id      = excluded.account_id,
                   biz             = excluded.biz,
                   cover_url       = excluded.cover_url,
                   digest          = excluded.digest,
                   word_count      = excluded.word_count,
                   is_original     = excluded.is_original,
                   entities        = excluded.entities,
                   topic           = excluded.topic",
                rusqlite::params![
                    card_id,
                    card["article_id"].as_str().unwrap_or_default(),
                    card["kind"].as_str(),
                    source_card_ids_json,
                    source_article_ids_json,
                    card["title"].as_str(),
                    card["article_title"].as_str(),
                    card["content_md"].as_str(),
                    card["additional_content"].as_str(),
                    card["description"].as_str(),
                    card["routing"].as_str(),
                    card["template"].as_str(),
                    card["template_reason"].as_str(),
                    card["card_date"].as_str(),
                    card["account"].as_str(),
                    card["author"].as_str(),
                    card["url"].as_str(),
                    card["read_at"].as_str(),
                    card["updated_at"].as_str().unwrap_or_default(),
                    card["publish_time"].as_str(),
                    card["account_id"].as_i64(),
                    card["biz"].as_str(),
                    card["cover_url"].as_str(),
                    card["digest"].as_str(),
                    card["word_count"].as_i64(),
                    card["is_original"].as_bool().map(|b| if b { 1i64 } else { 0i64 }),
                    entities_json,
                    topic_json,
                ],
            )
            .map_err(|e| e.to_string())?;
            // Insert new FTS entry
            if let Ok(rowid) = conn.query_row(
                "SELECT rowid FROM cards WHERE card_id = ?1",
                [card_id],
                |r| r.get::<_, i64>(0),
            ) {
                conn.execute(
                    "INSERT INTO cards_fts (rowid, title, content_md) VALUES (?1, ?2, ?3)",
                    rusqlite::params![
                        rowid,
                        card["title"].as_str().unwrap_or_default(),
                        card["content_md"].as_str().unwrap_or_default(),
                    ],
                )
                .ok();
            }
            count += 1;
        }
        superseded_source_ids.sort();
        superseded_source_ids.dedup();
        for source_id in superseded_source_ids {
            if let Ok(rowid) = conn.query_row(
                "SELECT rowid FROM cards WHERE card_id = ?1",
                [source_id.as_str()],
                |r| r.get::<_, i64>(0),
            ) {
                conn.execute(
                    "DELETE FROM cards_fts WHERE rowid = ?1",
                    rusqlite::params![rowid],
                )
                .ok();
            }
            conn.execute("DELETE FROM cards WHERE card_id = ?1", [source_id.as_str()])
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn upsert_articles(&self, articles: &[serde_json::Value]) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut count = 0usize;
        for article in articles {
            conn.execute(
                "INSERT OR REPLACE INTO wechat_articles (article_id, content_html, updated_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    article["article_id"].as_str().unwrap_or_default(),
                    article["content_html"].as_str(),
                    article["updated_at"].as_str().unwrap_or_default(),
                ],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
        }
        Ok(count)
    }

    pub fn apply_favorites_sync(&self, favorites: &[serde_json::Value]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        for fav in favorites {
            let item_type = fav["item_type"].as_str().unwrap_or_default();
            let item_id = fav["item_id"].as_str().unwrap_or_default();
            if fav["deleted"].as_bool().unwrap_or(false) {
                conn.execute(
                    "DELETE FROM favorites WHERE item_type = ?1 AND item_id = ?2",
                    rusqlite::params![item_type, item_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                let created_at = fav["created_at"].as_str().unwrap_or_default();
                conn.execute(
                    "INSERT OR REPLACE INTO favorites (item_type, item_id, created_at, synced)
                     VALUES (?1, ?2, ?3, 1)",
                    rusqlite::params![item_type, item_id, created_at],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn get_sync_ts(&self) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM sync_state WHERE key = 'last_sync_ts'")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn set_sync_ts(&self, ts: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_sync_ts', ?1)",
            [ts],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_sync_queue(&self, limit: i32) -> Result<Vec<SyncQueueItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, action, payload, created_at, retries
                 FROM sync_queue WHERE retries < 5 ORDER BY id LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(SyncQueueItem {
                    id: row.get(0)?,
                    action: row.get(1)?,
                    payload: row.get(2)?,
                    created_at: row.get(3)?,
                    retries: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn remove_sync_queue_item(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sync_queue WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn increment_sync_queue_retries(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sync_queue SET retries = retries + 1 WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Return up to `limit` card_ids that have no content_md, ordered recent → older.
    pub fn get_cards_missing_content(&self, limit: i64) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT card_id FROM cards
                 WHERE content_md IS NULL
                 ORDER BY card_date DESC NULLS LAST, card_id
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// Write content_md for a card and update its FTS entry.
    pub fn update_card_content(
        &self,
        card_id: &str,
        content_md: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE cards SET content_md = ?1, updated_at = ?2 WHERE card_id = ?3",
            rusqlite::params![content_md, updated_at, card_id],
        )
        .map_err(|e| e.to_string())?;
        // Refresh FTS entry
        if let Ok(rowid) = conn.query_row(
            "SELECT rowid FROM cards WHERE card_id = ?1",
            [card_id],
            |r| r.get::<_, i64>(0),
        ) {
            conn.execute(
                "DELETE FROM cards_fts WHERE rowid = ?1",
                rusqlite::params![rowid],
            )
            .ok();
            let title: Option<String> = conn
                .query_row(
                    "SELECT title FROM cards WHERE card_id = ?1",
                    [card_id],
                    |r| r.get(0),
                )
                .ok()
                .flatten();
            conn.execute(
                "INSERT INTO cards_fts (rowid, title, content_md) VALUES (?1, ?2, ?3)",
                rusqlite::params![rowid, title.as_deref().unwrap_or_default(), content_md,],
            )
            .ok();
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Chat
    // -----------------------------------------------------------------------

    pub fn create_chat_session(
        &self,
        session_id: &str,
        card_id: Option<&str>,
        agent_id: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO chat_sessions (session_id, card_id, agent_id) VALUES (?1, ?2, ?3)",
            rusqlite::params![session_id, card_id, agent_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_latest_session_for_card(
        &self,
        card_id: &str,
    ) -> Result<Option<ChatSession>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id, card_id, agent_id, created_at, updated_at
                 FROM chat_sessions WHERE card_id = ?1 ORDER BY updated_at DESC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([card_id], |row| {
                Ok(ChatSession {
                    session_id: row.get(0)?,
                    card_id: row.get(1)?,
                    agent_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(session)) => Ok(Some(session)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn get_home_session(&self) -> Result<Option<ChatSession>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id, card_id, agent_id, created_at, updated_at
                 FROM chat_sessions WHERE card_id IS NULL ORDER BY updated_at DESC LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([], |row| {
                Ok(ChatSession {
                    session_id: row.get(0)?,
                    card_id: row.get(1)?,
                    agent_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(session)) => Ok(Some(session)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn insert_chat_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?1, ?2, ?3)",
            rusqlite::params![session_id, role, content],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE chat_sessions SET updated_at = datetime('now') WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, created_at
                 FROM chat_messages WHERE session_id = ?1 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn get_card_id_for_session(&self, session_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT card_id FROM chat_sessions WHERE session_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([session_id], |row| row.get::<_, Option<String>>(0))
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(v)) => Ok(v),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    // -----------------------------------------------------------------------
    // App settings
    // -----------------------------------------------------------------------

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([key], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            rusqlite::params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
