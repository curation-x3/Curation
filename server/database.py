import os
import sqlite3
from datetime import date
from pathlib import Path
from typing import Optional, Dict, List

# DB is in CURATION_DATA_DIR (env var) or falls back to server/ for dev
_data_dir = os.environ.get("CURATION_DATA_DIR", str(Path(__file__).parent))
DB_PATH = Path(_data_dir) / "articles.db"


class ArticleDB:
    def __init__(self, db_path: Path = None):
        self.db_path = db_path or DB_PATH
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def _init_schema(self):
        c = self.conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                biz TEXT UNIQUE NOT NULL,
                name TEXT,
                wxid TEXT,
                avatar_url TEXT,
                description TEXT,
                account_type TEXT,
                subscription_type TEXT DEFAULT 'subscribed',
                subscribed_at TEXT,
                deleted_at TIMESTAMP,
                last_monitored_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                url TEXT UNIQUE NOT NULL,
                title TEXT,
                author TEXT,
                account TEXT,
                publish_time TIMESTAMP,
                digest TEXT,
                cover_url TEXT,
                is_original BOOLEAN,
                html_path TEXT,
                markdown_path TEXT,
                serving_run_id INTEGER,
                read_status INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS analysis_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL REFERENCES articles(id),

                agent_commit_hash TEXT NOT NULL,
                agent_commit_message TEXT,
                backend TEXT NOT NULL,

                workspace_path TEXT,

                deconstruct_status  TEXT DEFAULT 'pending',
                deconstruct_elapsed_s REAL,
                evaluate_status     TEXT DEFAULT 'pending',
                evaluate_elapsed_s  REAL,
                synthesize_status   TEXT DEFAULT 'pending',
                synthesize_elapsed_s REAL,
                write_status        TEXT DEFAULT 'pending',
                write_elapsed_s     REAL,

                overall_status TEXT DEFAULT 'pending',
                error_msg TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS analysis_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER UNIQUE NOT NULL REFERENCES articles(id),
                request_count INTEGER DEFAULT 1,
                status TEXT DEFAULT 'pending',
                run_id INTEGER REFERENCES analysis_runs(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # Default settings
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_launch', 'true')")
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_concurrency', '2')")

        c.execute("""
            CREATE TABLE IF NOT EXISTS app_users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                authing_sub TEXT UNIQUE NOT NULL,
                email       TEXT UNIQUE,
                username    TEXT,
                role        TEXT NOT NULL DEFAULT 'user',
                is_active   BOOLEAN NOT NULL DEFAULT 1,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login  TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS invite_codes (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                code         TEXT UNIQUE NOT NULL,
                created_by   INTEGER REFERENCES app_users(id),
                used_by      INTEGER REFERENCES app_users(id),
                used_at      TIMESTAMP,
                expires_at   TIMESTAMP,
                is_active    BOOLEAN NOT NULL DEFAULT 1,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        c.execute("INSERT OR IGNORE INTO app_config (key, value) VALUES ('bootstrap_done', 'false')")

        self.conn.commit()

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    def get_accounts(self) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY name ASC")
        return [dict(r) for r in c.fetchall()]

    def get_account_by_biz(self, biz: str) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM accounts WHERE biz = ? AND deleted_at IS NULL", (biz,))
        row = c.fetchone()
        return dict(row) if row else None

    def save_account(self, biz: str, name: str, wxid: str = None,
                     avatar_url: str = None, description: str = None,
                     account_type: str = None,
                     subscription_type: str = "subscribed") -> int:
        # subscribed_at is set once when first becoming subscribed, never overwritten
        subscribed_at = date.today().isoformat() if subscription_type == "subscribed" else None
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO accounts (biz, name, wxid, avatar_url, description, account_type,
                                  subscription_type, subscribed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(biz) DO UPDATE SET
                name = excluded.name,
                wxid = COALESCE(excluded.wxid, wxid),
                avatar_url = COALESCE(excluded.avatar_url, avatar_url),
                description = COALESCE(excluded.description, description),
                account_type = COALESCE(excluded.account_type, account_type),
                subscription_type = excluded.subscription_type,
                subscribed_at = CASE
                    WHEN excluded.subscription_type = 'subscribed' AND subscribed_at IS NULL
                    THEN excluded.subscribed_at
                    ELSE subscribed_at
                END,
                deleted_at = NULL
        """, (biz, name, wxid, avatar_url, description, account_type,
              subscription_type, subscribed_at))
        self.conn.commit()
        c.execute("SELECT id FROM accounts WHERE biz = ?", (biz,))
        return c.fetchone()[0]

    # ------------------------------------------------------------------
    # Articles
    # ------------------------------------------------------------------

    def get_all_articles(self) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT a.* FROM articles a
            ORDER BY a.publish_time DESC
        """)
        return [dict(r) for r in c.fetchall()]

    def get_articles_by_account(self, account_id: int) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT * FROM articles
            WHERE account_id = ?
            ORDER BY publish_time DESC
        """, (account_id,))
        return [dict(r) for r in c.fetchall()]

    def get_article(self, url: str) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM articles WHERE url = ?", (url,))
        row = c.fetchone()
        return dict(row) if row else None

    def get_article_by_id(self, article_id: int) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM articles WHERE id = ?", (article_id,))
        row = c.fetchone()
        return dict(row) if row else None

    def update_markdown_path(self, article_id: int, markdown_path: str):
        c = self.conn.cursor()
        c.execute("UPDATE articles SET markdown_path = ? WHERE id = ?", (markdown_path, article_id))
        self.conn.commit()

    def save_article(self, url: str, title: str, author: str, account: str,
                     publish_time: str, markdown_path: str = None,
                     html_path: str = None, account_id: int = None,
                     digest: str = None, cover_url: str = None,
                     is_original: bool = False):
        c = self.conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO articles
              (url, title, author, account, publish_time, html_path, markdown_path,
               account_id, digest, cover_url, is_original)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (url, title, author, account, publish_time, html_path, markdown_path,
              account_id, digest, cover_url, is_original))
        self.conn.commit()

    def delete_article(self, article_id: int):
        c = self.conn.cursor()
        c.execute("DELETE FROM articles WHERE id = ?", (article_id,))
        self.conn.commit()

    def delete_account(self, account_id: int):
        c = self.conn.cursor()
        c.execute("UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", (account_id,))
        self.conn.commit()

    def get_article_count_by_account(self, account_id: int) -> int:
        c = self.conn.cursor()
        c.execute("SELECT COUNT(*) FROM articles WHERE account_id = ?", (account_id,))
        return c.fetchone()[0]

    def update_account_last_monitored(self, account_id: int):
        c = self.conn.cursor()
        c.execute("UPDATE accounts SET last_monitored_at = CURRENT_TIMESTAMP WHERE id = ?",
                  (account_id,))
        self.conn.commit()

    def set_serving_run(self, article_id: int, run_id):
        c = self.conn.cursor()
        c.execute("UPDATE articles SET serving_run_id = ? WHERE id = ?", (run_id, article_id))
        self.conn.commit()

    def update_read_status(self, article_id: int, status: int):
        c = self.conn.cursor()
        c.execute("UPDATE articles SET read_status = ? WHERE id = ?", (status, article_id))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Analysis runs
    # ------------------------------------------------------------------

    def create_run(self, article_id: int, agent_commit_hash: str,
                   agent_commit_message: str, backend: str,
                   workspace_path: str) -> int:
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO analysis_runs
              (article_id, agent_commit_hash, agent_commit_message, backend, workspace_path)
            VALUES (?, ?, ?, ?, ?)
        """, (article_id, agent_commit_hash, agent_commit_message, backend, workspace_path))
        self.conn.commit()
        return c.lastrowid

    def get_run(self, run_id: int) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM analysis_runs WHERE id = ?", (run_id,))
        row = c.fetchone()
        return dict(row) if row else None

    def get_runs_for_article(self, article_id: int) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT * FROM analysis_runs
            WHERE article_id = ?
            ORDER BY created_at DESC
        """, (article_id,))
        return [dict(r) for r in c.fetchall()]

    def update_stage(self, run_id: int, stage: str, status: str,
                     elapsed_s: float = None, error_msg: str = None):
        """Update a single stage's status and elapsed time."""
        c = self.conn.cursor()
        if elapsed_s is not None:
            c.execute(f"""
                UPDATE analysis_runs
                SET {stage}_status = ?, {stage}_elapsed_s = ?,
                    overall_status = 'running', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (status, elapsed_s, run_id))
        else:
            c.execute(f"""
                UPDATE analysis_runs
                SET {stage}_status = ?,
                    overall_status = 'running', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (status, run_id))
        if error_msg:
            c.execute("UPDATE analysis_runs SET error_msg = ? WHERE id = ?",
                      (error_msg, run_id))
        self.conn.commit()

    def set_overall_status(self, run_id: int, status: str, error_msg: str = None):
        c = self.conn.cursor()
        c.execute("""
            UPDATE analysis_runs
            SET overall_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (status, run_id))
        if error_msg:
            c.execute("UPDATE analysis_runs SET error_msg = ? WHERE id = ?",
                      (error_msg, run_id))
        self.conn.commit()


    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        c = self.conn.cursor()
        c.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = c.fetchone()
        return row[0] if row else default

    def set_setting(self, key: str, value: str):
        c = self.conn.cursor()
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
        self.conn.commit()

    # ------------------------------------------------------------------
    # Analysis queue
    # ------------------------------------------------------------------

    def enqueue_analysis(self, article_id: int) -> Dict:
        """Insert or increment request_count for an article. Returns the queue entry."""
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO analysis_queue (article_id, request_count)
            VALUES (?, 1)
            ON CONFLICT(article_id) DO UPDATE SET
                request_count = request_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('pending', 'failed')
        """, (article_id,))
        self.conn.commit()
        c.execute("SELECT * FROM analysis_queue WHERE article_id = ?", (article_id,))
        return dict(c.fetchone())

    def get_queue_entry(self, article_id: int) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM analysis_queue WHERE article_id = ?", (article_id,))
        row = c.fetchone()
        return dict(row) if row else None

    def get_queue_all(self) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT q.*, a.title as article_title
            FROM analysis_queue q
            JOIN articles a ON q.article_id = a.id
            ORDER BY q.request_count DESC, q.created_at ASC
        """)
        return [dict(r) for r in c.fetchall()]

    def get_pending_queue(self, limit: int = 10) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT * FROM analysis_queue
            WHERE status = 'pending'
            ORDER BY request_count DESC, created_at ASC
            LIMIT ?
        """, (limit,))
        return [dict(r) for r in c.fetchall()]

    def update_queue_entry(self, article_id: int, status: str, run_id: int = None):
        c = self.conn.cursor()
        if run_id is not None:
            c.execute("""
                UPDATE analysis_queue SET status = ?, run_id = ?,
                    updated_at = CURRENT_TIMESTAMP WHERE article_id = ?
            """, (status, run_id, article_id))
        else:
            c.execute("""
                UPDATE analysis_queue SET status = ?,
                    updated_at = CURRENT_TIMESTAMP WHERE article_id = ?
            """, (status, article_id))
        self.conn.commit()


    # ------------------------------------------------------------------
    # App users
    # ------------------------------------------------------------------

    def get_user_by_sub(self, authing_sub: str) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM app_users WHERE authing_sub = ?", (authing_sub,))
        row = c.fetchone()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM app_users WHERE id = ?", (user_id,))
        row = c.fetchone()
        return dict(row) if row else None

    def create_user(self, authing_sub: str, email: str = None,
                    username: str = None, role: str = "user") -> int:
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO app_users (authing_sub, email, username, role)
            VALUES (?, ?, ?, ?)
        """, (authing_sub, email, username, role))
        self.conn.commit()
        return c.lastrowid

    def update_user_last_login(self, user_id: int):
        c = self.conn.cursor()
        c.execute("UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user_id,))
        self.conn.commit()

    def update_user(self, user_id: int, role: str = None, is_active: bool = None):
        c = self.conn.cursor()
        if role is not None:
            c.execute("UPDATE app_users SET role = ? WHERE id = ?", (role, user_id))
        if is_active is not None:
            c.execute("UPDATE app_users SET is_active = ? WHERE id = ?", (is_active, user_id))
        self.conn.commit()

    def list_users(self) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM app_users ORDER BY created_at ASC")
        return [dict(r) for r in c.fetchall()]

    # ------------------------------------------------------------------
    # Invite codes
    # ------------------------------------------------------------------

    def get_invite_code(self, code: str) -> Optional[Dict]:
        c = self.conn.cursor()
        c.execute("SELECT * FROM invite_codes WHERE code = ?", (code,))
        row = c.fetchone()
        return dict(row) if row else None

    def create_invite_code(self, code: str, created_by: int,
                           expires_at: str = None):
        c = self.conn.cursor()
        c.execute("""
            INSERT INTO invite_codes (code, created_by, expires_at)
            VALUES (?, ?, ?)
        """, (code, created_by, expires_at))
        self.conn.commit()

    def use_invite_code(self, code: str, used_by: int):
        c = self.conn.cursor()
        c.execute("""
            UPDATE invite_codes
            SET used_by = ?, used_at = CURRENT_TIMESTAMP, is_active = 0
            WHERE code = ?
        """, (used_by, code))
        self.conn.commit()

    def deactivate_invite_code(self, code: str):
        c = self.conn.cursor()
        c.execute("UPDATE invite_codes SET is_active = 0 WHERE code = ?", (code,))
        self.conn.commit()

    def list_invite_codes(self) -> List[Dict]:
        c = self.conn.cursor()
        c.execute("""
            SELECT ic.*,
                   creator.email as creator_email,
                   user.email as used_by_email
            FROM invite_codes ic
            LEFT JOIN app_users creator ON ic.created_by = creator.id
            LEFT JOIN app_users user ON ic.used_by = user.id
            ORDER BY ic.created_at DESC
        """)
        return [dict(r) for r in c.fetchall()]

    # ------------------------------------------------------------------
    # App config
    # ------------------------------------------------------------------

    def get_app_config(self, key: str) -> Optional[str]:
        c = self.conn.cursor()
        c.execute("SELECT value FROM app_config WHERE key = ?", (key,))
        row = c.fetchone()
        return row[0] if row else None

    def set_app_config(self, key: str, value: str):
        c = self.conn.cursor()
        c.execute("INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", (key, value))
        self.conn.commit()


db = ArticleDB()
