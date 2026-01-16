// ABOUTME: Query history management with SQLite storage.
// ABOUTME: Provides full-text search and filtering capabilities for executed queries.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePool, Row};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub database: String,
    pub schema: String,
    pub query: String,
    pub timestamp: DateTime<Utc>,
    pub execution_time_ms: u64,
    pub row_count: usize,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryFilter {
    pub connection_id: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub success_only: Option<bool>,
    pub search_query: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

pub struct HistoryManager {
    pool: Arc<RwLock<Option<SqlitePool>>>,
}

impl HistoryManager {
    pub async fn new(db_path: &Path) -> Result<Self, String> {
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
        let pool = SqlitePool::connect(&db_url)
            .await
            .map_err(|e| format!("Failed to connect to history database: {}", e))?;

        // Create tables if they don't exist
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS query_history (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                database TEXT NOT NULL,
                schema TEXT NOT NULL,
                query TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                execution_time_ms INTEGER NOT NULL,
                row_count INTEGER NOT NULL,
                success INTEGER NOT NULL,
                error_message TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create query_history table: {}", e))?;

        // Create indices
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_connection_db ON query_history(connection_id, database, schema)",
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create index: {}", e))?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_timestamp ON query_history(timestamp DESC)")
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to create index: {}", e))?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_success ON query_history(success)")
            .execute(&pool)
            .await
            .map_err(|e| format!("Failed to create index: {}", e))?;

        // Create FTS5 virtual table
        sqlx::query(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS query_history_fts USING fts5(
                query,
                content='query_history',
                content_rowid='rowid'
            )
            "#,
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create FTS table: {}", e))?;

        // Create triggers to keep FTS in sync
        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS query_history_ai AFTER INSERT ON query_history BEGIN
                INSERT INTO query_history_fts(rowid, query) VALUES (new.rowid, new.query);
            END
            "#,
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create insert trigger: {}", e))?;

        sqlx::query(
            r#"
            CREATE TRIGGER IF NOT EXISTS query_history_ad AFTER DELETE ON query_history BEGIN
                DELETE FROM query_history_fts WHERE rowid = old.rowid;
            END
            "#,
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create delete trigger: {}", e))?;

        Ok(Self {
            pool: Arc::new(RwLock::new(Some(pool))),
        })
    }

    pub async fn save_entry(&self, entry: QueryHistoryEntry) -> Result<(), String> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or("History database not initialized")?;

        sqlx::query(
            r#"
            INSERT INTO query_history
            (id, connection_id, database, schema, query, timestamp, execution_time_ms, row_count, success, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&entry.id)
        .bind(&entry.connection_id)
        .bind(&entry.database)
        .bind(&entry.schema)
        .bind(&entry.query)
        .bind(entry.timestamp.to_rfc3339())
        .bind(entry.execution_time_ms as i64)
        .bind(entry.row_count as i64)
        .bind(if entry.success { 1 } else { 0 })
        .bind(&entry.error_message)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to save query history: {}", e))?;

        Ok(())
    }

    pub async fn get_entries(
        &self,
        filter: QueryHistoryFilter,
    ) -> Result<Vec<QueryHistoryEntry>, String> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or("History database not initialized")?;

        let mut query_str = String::from("SELECT * FROM query_history WHERE 1=1");
        let mut conditions = Vec::new();

        if let Some(conn_id) = &filter.connection_id {
            conditions.push(format!("connection_id = '{}'", conn_id));
        }

        if let Some(db) = &filter.database {
            conditions.push(format!("database = '{}'", db));
        }

        if let Some(schema) = &filter.schema {
            conditions.push(format!("schema = '{}'", schema));
        }

        if let Some(start) = &filter.start_date {
            conditions.push(format!("timestamp >= '{}'", start.to_rfc3339()));
        }

        if let Some(end) = &filter.end_date {
            conditions.push(format!("timestamp <= '{}'", end.to_rfc3339()));
        }

        if let Some(success_only) = filter.success_only {
            conditions.push(format!("success = {}", if success_only { 1 } else { 0 }));
        }

        for condition in conditions {
            query_str.push_str(&format!(" AND {}", condition));
        }

        query_str.push_str(" ORDER BY timestamp DESC");

        if let Some(limit) = filter.limit {
            query_str.push_str(&format!(" LIMIT {}", limit));
        }

        if let Some(offset) = filter.offset {
            query_str.push_str(&format!(" OFFSET {}", offset));
        }

        let rows = sqlx::query(&query_str)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to fetch query history: {}", e))?;

        let entries: Vec<QueryHistoryEntry> = rows
            .into_iter()
            .map(|row| {
                let timestamp_str: String = row.get("timestamp");
                QueryHistoryEntry {
                    id: row.get("id"),
                    connection_id: row.get("connection_id"),
                    database: row.get("database"),
                    schema: row.get("schema"),
                    query: row.get("query"),
                    timestamp: DateTime::parse_from_rfc3339(&timestamp_str)
                        .unwrap()
                        .with_timezone(&Utc),
                    execution_time_ms: row.get::<i64, _>("execution_time_ms") as u64,
                    row_count: row.get::<i64, _>("row_count") as usize,
                    success: row.get::<i64, _>("success") == 1,
                    error_message: row.get("error_message"),
                }
            })
            .collect();

        Ok(entries)
    }

    pub async fn search_entries(
        &self,
        filter: QueryHistoryFilter,
    ) -> Result<Vec<QueryHistoryEntry>, String> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or("History database not initialized")?;

        let mut query_str = String::from(
            r#"
            SELECT qh.* FROM query_history qh
            JOIN query_history_fts fts ON qh.rowid = fts.rowid
            WHERE query_history_fts MATCH ?
            "#,
        );

        let search_query = filter.search_query.as_deref().unwrap_or("*");

        let mut conditions = Vec::new();

        if let Some(conn_id) = &filter.connection_id {
            conditions.push(format!("qh.connection_id = '{}'", conn_id));
        }

        if let Some(db) = &filter.database {
            conditions.push(format!("qh.database = '{}'", db));
        }

        if let Some(schema) = &filter.schema {
            conditions.push(format!("qh.schema = '{}'", schema));
        }

        if let Some(start) = &filter.start_date {
            conditions.push(format!("qh.timestamp >= '{}'", start.to_rfc3339()));
        }

        if let Some(end) = &filter.end_date {
            conditions.push(format!("qh.timestamp <= '{}'", end.to_rfc3339()));
        }

        if let Some(success_only) = filter.success_only {
            conditions.push(format!("qh.success = {}", if success_only { 1 } else { 0 }));
        }

        for condition in conditions {
            query_str.push_str(&format!(" AND {}", condition));
        }

        query_str.push_str(" ORDER BY qh.timestamp DESC");

        if let Some(limit) = filter.limit {
            query_str.push_str(&format!(" LIMIT {}", limit));
        }

        if let Some(offset) = filter.offset {
            query_str.push_str(&format!(" OFFSET {}", offset));
        }

        let rows = sqlx::query(&query_str)
            .bind(search_query)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to search query history: {}", e))?;

        let entries: Vec<QueryHistoryEntry> = rows
            .into_iter()
            .map(|row| {
                let timestamp_str: String = row.get("timestamp");
                QueryHistoryEntry {
                    id: row.get("id"),
                    connection_id: row.get("connection_id"),
                    database: row.get("database"),
                    schema: row.get("schema"),
                    query: row.get("query"),
                    timestamp: DateTime::parse_from_rfc3339(&timestamp_str)
                        .unwrap()
                        .with_timezone(&Utc),
                    execution_time_ms: row.get::<i64, _>("execution_time_ms") as u64,
                    row_count: row.get::<i64, _>("row_count") as usize,
                    success: row.get::<i64, _>("success") == 1,
                    error_message: row.get("error_message"),
                }
            })
            .collect();

        Ok(entries)
    }

    pub async fn delete_entry(&self, id: &str) -> Result<(), String> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or("History database not initialized")?;

        sqlx::query("DELETE FROM query_history WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to delete query history entry: {}", e))?;

        Ok(())
    }

    pub async fn clear_history(&self, connection_id: Option<String>) -> Result<(), String> {
        let pool_guard = self.pool.read().await;
        let pool = pool_guard
            .as_ref()
            .ok_or("History database not initialized")?;

        if let Some(conn_id) = connection_id {
            sqlx::query("DELETE FROM query_history WHERE connection_id = ?")
                .bind(conn_id)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to clear query history: {}", e))?;
        } else {
            sqlx::query("DELETE FROM query_history")
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to clear query history: {}", e))?;
        }

        Ok(())
    }
}
