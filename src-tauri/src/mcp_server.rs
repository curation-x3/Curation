use crate::db::CacheDb;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CardContext {
    pub card_id: String,
    pub title: String,
    pub content_md: String,
    pub article_html: Option<String>,
    pub account: String,
    pub author: Option<String>,
    pub article_date: Option<String>,
    pub url: String,
    pub routing: String,
}

pub struct CurationMcpServer {
    db: Arc<Mutex<Option<CacheDb>>>,
    current_context: Arc<Mutex<Option<CardContext>>>,
}

impl CurationMcpServer {
    pub fn new(
        db: Arc<Mutex<Option<CacheDb>>>,
        current_context: Arc<Mutex<Option<CardContext>>>,
    ) -> Self {
        Self { db, current_context }
    }

    fn with_db<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&CacheDb) -> Result<R, String>,
    {
        let guard = self.db.lock().map_err(|e| e.to_string())?;
        let db = guard.as_ref().ok_or("Database not initialized")?;
        f(db)
    }

    pub fn get_current_context(&self) -> Result<Value, String> {
        let ctx = self.current_context.lock().map_err(|e| e.to_string())?;
        match ctx.as_ref() {
            Some(c) => Ok(serde_json::to_value(c).map_err(|e| e.to_string())?),
            None => Ok(json!({"message": "No card is currently being viewed"})),
        }
    }

    pub fn search_cards(&self, query: &str) -> Result<Value, String> {
        self.with_db(|db| {
            let results = db.search_cards(query)?;
            Ok(serde_json::to_value(&results).map_err(|e| e.to_string())?)
        })
    }

    pub fn get_card_content(&self, card_id: &str) -> Result<Value, String> {
        self.with_db(|db| match db.get_card_content(card_id)? {
            Some(v) => Ok(v),
            None => Ok(json!({"error": "Card not found"})),
        })
    }

    pub fn get_favorites(&self) -> Result<Value, String> {
        self.with_db(|db| db.get_favorites_with_card_info())
    }
}
