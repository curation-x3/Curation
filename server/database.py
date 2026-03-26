import sqlite3
import os
from pathlib import Path
from typing import Optional, Dict

DB_PATH = Path(__file__).parent / "articles.db"

class ArticleDB:
    def __init__(self):
        self.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_table()

    def _create_table(self):
        cursor = self.conn.cursor()
        # Create accounts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                biz TEXT UNIQUE NOT NULL,
                name TEXT,
                wxid TEXT,
                avatar_url TEXT,
                description TEXT,
                account_type TEXT,
                last_monitored_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create articles table with additional fields
        cursor.execute("""
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
                read_status INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            )
        """)
        
        # Migration: Add missing columns to articles if they don't exist
        # SQLite doesn't support multi-column ADD COLUMN in one statement
        columns_to_add = [
            ("account_id", "INTEGER"),
            ("publish_time", "TIMESTAMP"),
            ("digest", "TEXT"),
            ("cover_url", "TEXT"),
            ("is_original", "BOOLEAN"),
            ("read_status", "INTEGER DEFAULT 0")
        ]
        
        cursor.execute("PRAGMA table_info(articles)")
        existing_columns = [row['name'] for row in cursor.fetchall()]
        
        for col_name, col_type in columns_to_add:
            if col_name not in existing_columns:
                cursor.execute(f"ALTER TABLE articles ADD COLUMN {col_name} {col_type}")
                
        self.conn.commit()

    def get_accounts(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM accounts ORDER BY name ASC")
        return [dict(row) for row in cursor.fetchall()]

    def get_articles_by_account(self, account_id: int):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM articles WHERE account_id = ? ORDER BY publish_time DESC", (account_id,))
        return [dict(row) for row in cursor.fetchall()]

    def get_all_articles(self):
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM articles ORDER BY publish_time DESC")
        return [dict(row) for row in cursor.fetchall()]

    def get_article(self, url: str) -> Optional[Dict]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM articles WHERE url = ?", (url,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def save_account(self, biz: str, name: str, wxid: str = None, avatar_url: str = None, description: str = None, account_type: str = None):
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO accounts (biz, name, wxid, avatar_url, description, account_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (biz, name, wxid, avatar_url, description, account_type))
        self.conn.commit()
        return cursor.lastrowid

    def save_article(self, url: str, title: str, author: str, account: str, publish_time: str, html_path: str, markdown_path: str, 
                     account_id: int = None, digest: str = None, cover_url: str = None, is_original: bool = False):
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO articles (url, title, author, account, publish_time, html_path, markdown_path, account_id, digest, cover_url, is_original)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (url, title, author, account, publish_time, html_path, markdown_path, account_id, digest, cover_url, is_original))
        self.conn.commit()

    def delete_article(self, article_id: int):
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM articles WHERE id = ?", (article_id,))
        self.conn.commit()

    def update_read_status(self, article_id: int, status: int):
        cursor = self.conn.cursor()
        cursor.execute("UPDATE articles SET read_status = ? WHERE id = ?", (status, article_id))
        self.conn.commit()

db = ArticleDB()

if __name__ == "__main__":
    # Test
    db.save_article("test_url", "Test Title", "Author", "Account", "2026-03-26", "path/to/html", "path/to/md")
    print(db.get_article("test_url"))
