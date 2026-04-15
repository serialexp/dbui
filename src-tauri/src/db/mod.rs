// ABOUTME: Database connection management and query execution.
// ABOUTME: Supports PostgreSQL, MySQL, SQLite, and Redis with runtime driver selection.

pub mod mysql;
pub mod postgres;
pub mod redis_db;
pub mod sqlite;
pub mod ssh_tunnel;

use crate::storage::{ConnectionConfig, DatabaseType, SslMode};
use ssh_tunnel::TunnelHandle;
use serde::{Deserialize, Serialize};
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use sqlx::pool::PoolOptions;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_PROGRESS_EVENT: &str = "query-progress";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

fn emit_progress(
    app: &AppHandle,
    query_id: &str,
    phase: &'static str,
    rows: usize,
    elapsed_ms: u64,
    server_ms: Option<u64>,
    transfer_ms: Option<u64>,
    bytes: Option<u64>,
) {
    let _ = app.emit(
        QUERY_PROGRESS_EVENT,
        QueryProgress {
            query_id: query_id.to_string(),
            phase,
            rows,
            elapsed_ms,
            server_ms,
            transfer_ms,
            bytes,
        },
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub foreign_table: Option<String>,
    pub foreign_columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    pub name: String,
    pub definition: String,
    pub return_type: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewDependency {
    pub view_name: String,
    pub depends_on: String,
    pub depends_on_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_time_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transfer_time_ms: Option<u64>,
    /// Approximate payload size — sum of raw column bytes across all rows.
    /// Excludes protocol framing (MySQL/Postgres packet headers, length
    /// prefixes, column metadata) so the true wire-level number is modestly
    /// higher, but for fat rows this dominates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes_transferred: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryProgress {
    pub query_id: String,
    pub phase: &'static str, // "executing" | "transferring" | "done"
    pub rows: usize,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseUser {
    pub name: String,
    pub host: Option<String>,
    pub is_superuser: bool,
    pub can_login: bool,
    pub can_create_db: bool,
    pub can_create_role: bool,
    pub is_replication: bool,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
    pub config: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserGrant {
    pub grantee: String,
    pub grantor: Option<String>,
    pub privilege: String,
    pub object_type: String,
    pub object_catalog: Option<String>,
    pub object_schema: Option<String>,
    pub object_name: Option<String>,
    pub column_name: Option<String>,
    pub is_grantable: bool,
    pub inherited_from: Option<String>,
}

pub enum ConnectionPool {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
    Redis(redis::aio::ConnectionManager),
}

/// A connected pool plus any resources whose lifetime must match the pool
/// (e.g., an SSH tunnel). Field order matters: the pool is dropped before the
/// tunnel so in-flight TCP traffic can still flow during pool teardown.
pub struct ActiveConnection {
    pub pool: Arc<ConnectionPool>,
    _tunnel: Option<TunnelHandle>,
}

pub struct ConnectionManager {
    pools: RwLock<HashMap<String, ActiveConnection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, config: &ConnectionConfig) -> Result<String, String> {
        let connection_id = config.id.clone();

        // SQLite has no network connection so SSH tunneling does not apply.
        // For other database types, if an SSH tunnel is configured, establish
        // it first and route the DB connection through the local forwarded port.
        let (effective_host, effective_port, tunnel) = if matches!(
            config.db_type,
            DatabaseType::Sqlite
        ) {
            (config.host.clone(), config.port, None)
        } else if let Some(ssh_cfg) = &config.ssh_tunnel {
            let handle = ssh_tunnel::establish_tunnel(
                ssh_cfg,
                config.host.clone(),
                config.port,
            )
            .await?;
            (
                "127.0.0.1".to_string(),
                handle.local_port,
                Some(handle),
            )
        } else {
            (config.host.clone(), config.port, None)
        };

        let pool = match config.db_type {
            DatabaseType::Postgres => {
                let ssl_param = match config.ssl_mode {
                    SslMode::Disable => "sslmode=disable",
                    SslMode::Prefer => "sslmode=prefer",
                    SslMode::Require => "sslmode=require",
                };
                let url = format!(
                    "postgres://{}:{}@{}:{}/{}?{}",
                    config.username,
                    config.password,
                    effective_host,
                    effective_port,
                    config.database.as_deref().unwrap_or("postgres"),
                    ssl_param,
                );
                let pool = PoolOptions::new()
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to PostgreSQL: {}", e))?;
                ConnectionPool::Postgres(pool)
            }
            DatabaseType::Mysql => {
                let ssl_param = match config.ssl_mode {
                    SslMode::Disable => "ssl-mode=DISABLED",
                    SslMode::Prefer => "ssl-mode=PREFERRED",
                    SslMode::Require => "ssl-mode=REQUIRED",
                };
                let url = format!(
                    "mysql://{}:{}@{}:{}/{}?{}",
                    config.username,
                    config.password,
                    effective_host,
                    effective_port,
                    config.database.as_deref().unwrap_or("mysql"),
                    ssl_param,
                );
                let pool = PoolOptions::new()
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
                ConnectionPool::Mysql(pool)
            }
            DatabaseType::Sqlite => {
                // For SQLite, host field contains the file path
                let url = format!("sqlite:{}", config.host);
                let pool = PoolOptions::new()
                    .acquire_timeout(CONNECT_TIMEOUT)
                    .connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;
                ConnectionPool::Sqlite(pool)
            }
            DatabaseType::Redis => {
                let manager = redis_db::connect(
                    &effective_host,
                    effective_port,
                    &config.username,
                    &config.password,
                )
                .await?;
                ConnectionPool::Redis(manager)
            }
        };

        let active = ActiveConnection {
            pool: Arc::new(pool),
            _tunnel: tunnel,
        };
        let mut pools = self.pools.write().await;
        pools.insert(connection_id.clone(), active);
        Ok(connection_id)
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        let mut pools = self.pools.write().await;
        if pools.remove(connection_id).is_none() {
            return Err(format!("Connection '{}' not found", connection_id));
        }
        Ok(())
    }

    pub async fn switch_database(&self, config: &ConnectionConfig, database: &str) -> Result<(), String> {
        // For Redis, switch database using SELECT command instead of reconnecting
        if matches!(config.db_type, DatabaseType::Redis) {
            let pool = self.get_pool(&config.id).await?;
            if let ConnectionPool::Redis(c) = pool.as_ref() {
                return redis_db::switch_database(&mut c.clone(), database).await;
            }
        }

        // For SQL databases, disconnect and reconnect with new database
        let _ = self.disconnect(&config.id).await;

        // Create new config with the specified database
        let mut new_config = config.clone();
        new_config.database = Some(database.to_string());

        // Connect to the new database
        self.connect(&new_config).await?;
        Ok(())
    }

    pub async fn get_pool(&self, connection_id: &str) -> Result<Arc<ConnectionPool>, String> {
        let pools = self.pools.read().await;
        pools
            .get(connection_id)
            .map(|a| a.pool.clone())
            .ok_or_else(|| format!("Connection '{}' not found or not connected", connection_id))
    }

    pub async fn create_database(&self, connection_id: &str, name: &str) -> Result<(), String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::create_database(p, name).await,
            ConnectionPool::Mysql(p) => mysql::create_database(p, name).await,
            ConnectionPool::Sqlite(_) => Err("SQLite does not support CREATE DATABASE".to_string()),
            ConnectionPool::Redis(_) => Err("Redis does not support CREATE DATABASE".to_string()),
        }
    }

    pub async fn create_schema(&self, connection_id: &str, name: &str) -> Result<(), String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::create_schema(p, name).await,
            ConnectionPool::Mysql(_) => {
                Err("MySQL does not support CREATE SCHEMA separately from CREATE DATABASE".to_string())
            }
            ConnectionPool::Sqlite(_) => {
                Err("SQLite does not support CREATE SCHEMA".to_string())
            }
            ConnectionPool::Redis(_) => {
                Err("Redis does not support CREATE SCHEMA".to_string())
            }
        }
    }

    pub async fn list_databases(&self, connection_id: &str) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_databases(p).await,
            ConnectionPool::Mysql(p) => mysql::list_databases(p).await,
            ConnectionPool::Sqlite(p) => sqlite::list_databases(p).await,
            ConnectionPool::Redis(c) => redis_db::list_databases(&mut c.clone()).await,
        }
    }

    pub async fn list_schemas(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_schemas(p, database).await,
            ConnectionPool::Mysql(p) => mysql::list_schemas(p, database).await,
            ConnectionPool::Sqlite(p) => sqlite::list_schemas(p, database).await,
            ConnectionPool::Redis(c) => redis_db::list_schemas(&mut c.clone(), database).await,
        }
    }

    pub async fn list_tables(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_tables(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_tables(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_tables(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_tables(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_views(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_views(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_views(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_views(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_views(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_functions(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_functions(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_functions(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_functions(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_functions(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_materialized_views(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_materialized_views(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_materialized_views(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_materialized_views(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_materialized_views(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_sequences(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_sequences(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_sequences(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_sequences(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_sequences(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_triggers(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_triggers(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_triggers(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_triggers(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_triggers(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn list_procedures(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_procedures(p, database, schema).await,
            ConnectionPool::Mysql(p) => mysql::list_procedures(p, database, schema).await,
            ConnectionPool::Sqlite(p) => sqlite::list_procedures(p, database, schema).await,
            ConnectionPool::Redis(c) => redis_db::list_procedures(&mut c.clone(), database, schema).await,
        }
    }

    pub async fn get_function_definition(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
        function_name: &str,
    ) -> Result<FunctionInfo, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => {
                postgres::get_function_definition(p, database, schema, function_name).await
            }
            ConnectionPool::Mysql(p) => {
                mysql::get_function_definition(p, database, schema, function_name).await
            }
            ConnectionPool::Sqlite(p) => {
                sqlite::get_function_definition(p, database, schema, function_name).await
            }
            ConnectionPool::Redis(c) => {
                redis_db::get_function_definition(&mut c.clone(), database, schema, function_name).await
            }
        }
    }

    pub async fn get_view_dependencies(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<Vec<ViewDependency>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => {
                postgres::get_view_dependencies(p, database, schema).await
            }
            _ => Ok(vec![]),
        }
    }

    pub async fn get_view_definition(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
        view_name: &str,
    ) -> Result<FunctionInfo, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => {
                postgres::get_view_definition(p, database, schema, view_name).await
            }
            ConnectionPool::Mysql(p) => {
                mysql::get_view_definition(p, database, schema, view_name).await
            }
            ConnectionPool::Sqlite(p) => {
                sqlite::get_view_definition(p, database, schema, view_name).await
            }
            ConnectionPool::Redis(c) => {
                redis_db::get_view_definition(&mut c.clone(), database, schema, view_name).await
            }
        }
    }

    pub async fn cancel_queries(&self, connection_id: &str) -> Result<u64, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => {
                // Cancel all active queries from this application's connections
                let row = sqlx::query(
                    "SELECT count(*) as cnt FROM (
                        SELECT pg_cancel_backend(pid)
                        FROM pg_stat_activity
                        WHERE pid != pg_backend_pid()
                          AND leader_pid IS NULL
                          AND state = 'active'
                          AND query NOT LIKE '%pg_cancel_backend%'
                    ) t"
                )
                .fetch_one(p)
                .await
                .map_err(|e| format!("Failed to cancel queries: {}", e))?;
                let count: i64 = sqlx::Row::get(&row, "cnt");
                Ok(count as u64)
            }
            ConnectionPool::Mysql(p) => {
                // Kill active queries from this connection's user
                let rows = sqlx::query(
                    "SELECT id FROM information_schema.processlist WHERE id != CONNECTION_ID() AND command != 'Sleep'"
                )
                .fetch_all(p)
                .await
                .map_err(|e| format!("Failed to list queries: {}", e))?;
                let mut killed = 0u64;
                for row in &rows {
                    let id: u64 = sqlx::Row::get(row, "id");
                    if sqlx::query(&format!("KILL QUERY {}", id))
                        .execute(p)
                        .await
                        .is_ok()
                    {
                        killed += 1;
                    }
                }
                Ok(killed)
            }
            _ => Ok(0),
        }
    }

    pub async fn list_users(&self, connection_id: &str) -> Result<Vec<DatabaseUser>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_users(p).await,
            ConnectionPool::Mysql(p) => mysql::list_users(p).await,
            ConnectionPool::Sqlite(_) => Err("SQLite does not have a user management system".to_string()),
            ConnectionPool::Redis(_) => Err("Redis user management is not yet supported".to_string()),
        }
    }

    pub async fn get_user_grants(
        &self,
        connection_id: &str,
        username: &str,
        host: Option<&str>,
    ) -> Result<Vec<UserGrant>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::get_user_grants(p, username).await,
            ConnectionPool::Mysql(p) => mysql::get_user_grants(p, username, host).await,
            ConnectionPool::Sqlite(_) => Err("SQLite does not have a user management system".to_string()),
            ConnectionPool::Redis(_) => Err("Redis user management is not yet supported".to_string()),
        }
    }

    pub async fn list_columns(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_columns(p, database, schema, table).await,
            ConnectionPool::Mysql(p) => mysql::list_columns(p, database, schema, table).await,
            ConnectionPool::Sqlite(p) => sqlite::list_columns(p, database, schema, table).await,
            ConnectionPool::Redis(c) => redis_db::list_columns(&mut c.clone(), database, schema, table).await,
        }
    }

    pub async fn list_indexes(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_indexes(p, database, schema, table).await,
            ConnectionPool::Mysql(p) => mysql::list_indexes(p, database, schema, table).await,
            ConnectionPool::Sqlite(p) => sqlite::list_indexes(p, database, schema, table).await,
            ConnectionPool::Redis(c) => redis_db::list_indexes(&mut c.clone(), database, schema, table).await,
        }
    }

    pub async fn list_constraints(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => {
                postgres::list_constraints(p, database, schema, table).await
            }
            ConnectionPool::Mysql(p) => mysql::list_constraints(p, database, schema, table).await,
            ConnectionPool::Sqlite(p) => sqlite::list_constraints(p, database, schema, table).await,
            ConnectionPool::Redis(c) => redis_db::list_constraints(&mut c.clone(), database, schema, table).await,
        }
    }

    pub async fn execute_query(
        &self,
        app: &AppHandle,
        query_id: &str,
        connection_id: &str,
        query: &str,
        database: Option<&str>,
    ) -> Result<QueryResult, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => execute_query_pg(app, query_id, p, query).await,
            ConnectionPool::Mysql(p) => execute_query_mysql(app, query_id, p, query).await,
            ConnectionPool::Sqlite(p) => execute_query_sqlite(app, query_id, p, query).await,
            ConnectionPool::Redis(c) => {
                let mut conn = c.clone();
                if let Some(db) = database {
                    redis_db::switch_database(&mut conn, db).await?;
                }
                let start = Instant::now();
                emit_progress(app, query_id, "executing", 0, 0, None, None, None);
                let result = redis_db::execute_query(&mut conn, query).await?;
                let total_ms = start.elapsed().as_millis() as u64;
                emit_progress(
                    app,
                    query_id,
                    "done",
                    result.row_count,
                    total_ms,
                    Some(total_ms),
                    Some(0),
                    None,
                );
                Ok(QueryResult {
                    server_time_ms: Some(total_ms),
                    transfer_time_ms: Some(0),
                    ..result
                })
            }
        }
    }
}

/// Returns true if the query modifies data and won't return rows.
/// Queries with RETURNING clauses are excluded since they produce result sets.
fn returns_rows(query: &str) -> bool {
    let trimmed = query.trim();
    let upper = trimmed.to_uppercase();

    // INSERT/DELETE/UPDATE with RETURNING clause produce result sets
    if upper.contains("RETURNING") {
        return true;
    }

    let first_word = upper
        .split_whitespace()
        .next()
        .unwrap_or("");
    matches!(
        first_word,
        "SELECT"
            | "SHOW"
            | "DESCRIBE"
            | "DESC"
            | "EXPLAIN"
            | "PRAGMA"
            | "TABLE"
            | "VALUES"
            | "WITH"
    )
}

async fn execute_query_pg(
    app: &AppHandle,
    query_id: &str,
    pool: &sqlx::PgPool,
    query: &str,
) -> Result<QueryResult, String> {
    use futures::StreamExt;

    let start = Instant::now();
    emit_progress(app, query_id, "executing", 0, 0, None, None, None);

    // Use raw_sql to avoid prepared statements — the PREPARE + DESCRIBE
    // round-trip can hang on system catalogs and connection poolers.
    if !returns_rows(query) {
        let result = sqlx::raw_sql(query)
            .execute(pool)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        let rows_affected = result.rows_affected();
        let total_ms = start.elapsed().as_millis() as u64;
        emit_progress(
            app,
            query_id,
            "done",
            rows_affected as usize,
            total_ms,
            Some(total_ms),
            Some(0),
            Some(0),
        );
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: rows_affected as usize,
            message: Some(format!("{} row(s) affected.", rows_affected)),
            server_time_ms: Some(total_ms),
            transfer_time_ms: Some(0),
            bytes_transferred: Some(0),
        });
    }

    let mut stream = sqlx::raw_sql(query).fetch(pool);
    let mut columns: Vec<String> = Vec::new();
    let mut result_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut first_row_at: Option<Instant> = None;
    let mut last_emit = start;
    let mut bytes_total: u64 = 0;

    while let Some(row_res) = stream.next().await {
        let row = row_res.map_err(|e| format!("Query failed: {}", e))?;
        if first_row_at.is_none() {
            let now = Instant::now();
            first_row_at = Some(now);
            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            let server_ms = now.duration_since(start).as_millis() as u64;
            emit_progress(
                app,
                query_id,
                "transferring",
                0,
                server_ms,
                Some(server_ms),
                None,
                Some(0),
            );
            last_emit = now;
        }
        let mut row_values = Vec::with_capacity(row.columns().len());
        for (i, col) in row.columns().iter().enumerate() {
            let v = pg_value_to_json(&row, i, col.type_info().name());
            bytes_total += approx_value_bytes(&v) as u64;
            row_values.push(v);
        }
        result_rows.push(row_values);

        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            let now = Instant::now();
            let elapsed = now.duration_since(start).as_millis() as u64;
            let server_ms = first_row_at.map(|t| t.duration_since(start).as_millis() as u64);
            emit_progress(
                app,
                query_id,
                "transferring",
                result_rows.len(),
                elapsed,
                server_ms,
                None,
                Some(bytes_total),
            );
            last_emit = now;
        }
    }

    let end = Instant::now();
    let total_ms = end.duration_since(start).as_millis() as u64;
    let (server_ms, transfer_ms) = match first_row_at {
        Some(t1) => (
            t1.duration_since(start).as_millis() as u64,
            end.duration_since(t1).as_millis() as u64,
        ),
        None => (total_ms, 0),
    };

    emit_progress(
        app,
        query_id,
        "done",
        result_rows.len(),
        total_ms,
        Some(server_ms),
        Some(transfer_ms),
        Some(bytes_total),
    );

    if result_rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("0 row(s) affected.".to_string()),
            server_time_ms: Some(server_ms),
            transfer_time_ms: Some(transfer_ms),
            bytes_transferred: Some(bytes_total),
        });
    }

    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        message: None,
        server_time_ms: Some(server_ms),
        transfer_time_ms: Some(transfer_ms),
        bytes_transferred: Some(bytes_total),
    })
}

/// Approximate the payload size of a decoded value for progress reporting.
/// Serialized JSON length is a reasonable proxy — strings and numbers are
/// 1:1 with their wire form; binary blobs are inflated by base64/escape but
/// typically dominate total size anyway, so the order of magnitude is right.
fn approx_value_bytes(v: &serde_json::Value) -> usize {
    match v {
        serde_json::Value::Null => 0,
        serde_json::Value::Bool(_) => 1,
        serde_json::Value::Number(n) => n.to_string().len(),
        serde_json::Value::String(s) => s.len(),
        _ => serde_json::to_string(v).map(|s| s.len()).unwrap_or(0),
    }
}

fn pg_value_to_json(
    row: &sqlx::postgres::PgRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    use sqlx::{Row, ValueRef};

    // Distinguish actual SQL NULL from decode failures
    if row.try_get_raw(index).map_or(true, |v| v.is_null()) {
        return serde_json::Value::Null;
    }

    match type_name {
        "BOOL" => row
            .try_get::<bool, _>(index)
            .map(serde_json::Value::Bool),
        "INT2" => row
            .try_get::<i16, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "INT4" => row
            .try_get::<i32, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "INT8" => row
            .try_get::<i64, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "FLOAT4" | "FLOAT8" => row
            .try_get::<f64, _>(index)
            .map(|v| {
                serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::String(v.to_string()))
            }),
        "TIMESTAMP" => row
            .try_get::<chrono::NaiveDateTime, _>(index)
            .map(|v| serde_json::Value::String(v.to_string())),
        "TIMESTAMPTZ" => row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(index)
            .map(|v| serde_json::Value::String(v.to_rfc3339())),
        "DATE" => row
            .try_get::<chrono::NaiveDate, _>(index)
            .map(|v| serde_json::Value::String(v.to_string())),
        "TIME" => row
            .try_get::<chrono::NaiveTime, _>(index)
            .map(|v| serde_json::Value::String(v.to_string())),
        "UUID" => row
            .try_get::<uuid::Uuid, _>(index)
            .map(|v| serde_json::Value::String(v.to_string())),
        "JSON" | "JSONB" => row
            .try_get::<serde_json::Value, _>(index)
            .map(|v| v),
        _ => pg_try_decode_unknown(row, index, type_name),
    }
    .or_else(|_| pg_try_decode_unknown(row, index, type_name))
    .unwrap_or_else(|_| {
        // Non-null value we couldn't decode — try raw bytes, then show type name
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned()))
            .unwrap_or_else(|_| {
                serde_json::Value::String(format!("<unsupported type: {}>", type_name))
            })
    })
}

/// Brute-force decode for columns where the typed match arm failed.
/// Uses raw value access to bypass sqlx's type checking, then decodes
/// based on the PostgreSQL wire format (OID).
fn pg_try_decode_unknown(
    row: &sqlx::postgres::PgRow,
    index: usize,
    type_name: &str,
) -> Result<serde_json::Value, sqlx::Error> {
    use sqlx::{Row, ValueRef, TypeInfo};
    use sqlx::postgres::PgValueRef;

    let raw: PgValueRef<'_> = row.try_get_raw(index)?;
    let oid_type = raw.type_info();
    let oid_name = oid_type.name();

    // Try decoding based on the actual OID-resolved type name
    // This handles cases where the match arm's type name is correct but
    // sqlx's type validation rejected the decode anyway.
    let result = match oid_name {
        "BOOL" | "bool" => row.try_get::<bool, _>(index).map(serde_json::Value::Bool),
        "INT2" | "int2" => row.try_get::<i16, _>(index).map(|v| serde_json::Value::Number(v.into())),
        "INT4" | "int4" | "OID" | "oid" => row.try_get::<i32, _>(index).map(|v| serde_json::Value::Number(v.into())),
        "INT8" | "int8" => row.try_get::<i64, _>(index).map(|v| serde_json::Value::Number(v.into())),
        "FLOAT4" | "float4" | "FLOAT8" | "float8" => row.try_get::<f64, _>(index).map(|v| {
            serde_json::Number::from_f64(v)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::String(v.to_string()))
        }),
        "TIMESTAMPTZ" | "timestamptz" => row.try_get::<chrono::DateTime<chrono::Utc>, _>(index).map(|v| serde_json::Value::String(v.to_rfc3339())),
        "TIMESTAMP" | "timestamp" => row.try_get::<chrono::NaiveDateTime, _>(index).map(|v| serde_json::Value::String(v.to_string())),
        "DATE" | "date" => row.try_get::<chrono::NaiveDate, _>(index).map(|v| serde_json::Value::String(v.to_string())),
        "TIME" | "time" | "TIMETZ" | "timetz" => row.try_get::<chrono::NaiveTime, _>(index).map(|v| serde_json::Value::String(v.to_string())),
        "UUID" | "uuid" => row.try_get::<uuid::Uuid, _>(index).map(|v| serde_json::Value::String(v.to_string())),
        "JSON" | "json" | "JSONB" | "jsonb" => row.try_get::<serde_json::Value, _>(index),
        _ => row.try_get::<String, _>(index).map(serde_json::Value::String),
    };

    // If typed decode failed, try reading raw bytes as a UTF-8 string.
    // This bypasses sqlx's type validation (which rejects String for non-text types).
    result.or_else(|_| {
        let raw: PgValueRef<'_> = row.try_get_raw(index)?;
        let bytes = raw.as_bytes().map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
        Ok(serde_json::Value::String(String::from_utf8_lossy(bytes).into_owned()))
    })
}

async fn execute_query_mysql(
    app: &AppHandle,
    query_id: &str,
    pool: &sqlx::MySqlPool,
    query: &str,
) -> Result<QueryResult, String> {
    use futures::StreamExt;

    let start = Instant::now();
    emit_progress(app, query_id, "executing", 0, 0, None, None, None);

    // Use raw_sql to avoid prepared statements — MySQL's prepared statement
    // protocol doesn't support many statement types (SET, KILL, etc.).
    if !returns_rows(query) {
        let result = sqlx::raw_sql(query)
            .execute(pool)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        let rows_affected = result.rows_affected();
        let total_ms = start.elapsed().as_millis() as u64;
        emit_progress(
            app,
            query_id,
            "done",
            rows_affected as usize,
            total_ms,
            Some(total_ms),
            Some(0),
            Some(0),
        );
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: rows_affected as usize,
            message: Some(format!("{} row(s) affected.", rows_affected)),
            server_time_ms: Some(total_ms),
            transfer_time_ms: Some(0),
            bytes_transferred: Some(0),
        });
    }

    let mut stream = sqlx::raw_sql(query).fetch(pool);
    let mut columns: Vec<String> = Vec::new();
    let mut result_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut first_row_at: Option<Instant> = None;
    let mut last_emit = start;
    let mut bytes_total: u64 = 0;

    while let Some(row_res) = stream.next().await {
        let row = row_res.map_err(|e| format!("Query failed: {}", e))?;
        if first_row_at.is_none() {
            let now = Instant::now();
            first_row_at = Some(now);
            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
            let server_ms = now.duration_since(start).as_millis() as u64;
            emit_progress(
                app,
                query_id,
                "transferring",
                0,
                server_ms,
                Some(server_ms),
                None,
                Some(0),
            );
            last_emit = now;
        }
        let mut row_values = Vec::with_capacity(row.columns().len());
        for (i, col) in row.columns().iter().enumerate() {
            let v = mysql_value_to_json(&row, i, col.type_info().name());
            bytes_total += approx_value_bytes(&v) as u64;
            row_values.push(v);
        }
        result_rows.push(row_values);

        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            let now = Instant::now();
            let elapsed = now.duration_since(start).as_millis() as u64;
            let server_ms = first_row_at.map(|t| t.duration_since(start).as_millis() as u64);
            emit_progress(
                app,
                query_id,
                "transferring",
                result_rows.len(),
                elapsed,
                server_ms,
                None,
                Some(bytes_total),
            );
            last_emit = now;
        }
    }

    let end = Instant::now();
    let total_ms = end.duration_since(start).as_millis() as u64;
    let (server_ms, transfer_ms) = match first_row_at {
        Some(t1) => (
            t1.duration_since(start).as_millis() as u64,
            end.duration_since(t1).as_millis() as u64,
        ),
        None => (total_ms, 0),
    };

    emit_progress(
        app,
        query_id,
        "done",
        result_rows.len(),
        total_ms,
        Some(server_ms),
        Some(transfer_ms),
        Some(bytes_total),
    );

    if result_rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("0 row(s) affected.".to_string()),
            server_time_ms: Some(server_ms),
            transfer_time_ms: Some(transfer_ms),
            bytes_transferred: Some(bytes_total),
        });
    }

    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        message: None,
        server_time_ms: Some(server_ms),
        transfer_time_ms: Some(transfer_ms),
        bytes_transferred: Some(bytes_total),
    })
}

fn mysql_value_to_json(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    use sqlx::{Row, ValueRef};

    if row.try_get_raw(index).map_or(true, |v| v.is_null()) {
        return serde_json::Value::Null;
    }

    match type_name {
        "BOOLEAN" | "TINYINT(1)" => row
            .try_get::<bool, _>(index)
            .map(serde_json::Value::Bool),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "TINYINT UNSIGNED"
        | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" | "INT UNSIGNED" => row
            .try_get::<i32, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "BIGINT" | "BIGINT UNSIGNED" => row
            .try_get::<i64, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "FLOAT" | "DOUBLE" | "DECIMAL" => row
            .try_get::<f64, _>(index)
            .map(|v| {
                serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::String(v.to_string()))
            }),
        "JSON" => row
            .try_get::<serde_json::Value, _>(index)
            .map(|v| v),
        _ => row
            .try_get::<String, _>(index)
            .or_else(|_| {
                // MySQL over TLS may return string columns as VARBINARY
                row.try_get::<Vec<u8>, _>(index)
                    .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            })
            .map(serde_json::Value::String),
    }
    .unwrap_or_else(|_| {
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned()))
            .unwrap_or_else(|_| {
                serde_json::Value::String(format!("<unsupported type: {}>", type_name))
            })
    })
}

async fn execute_query_sqlite(
    app: &AppHandle,
    query_id: &str,
    pool: &sqlx::SqlitePool,
    query: &str,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    emit_progress(app, query_id, "executing", 0, 0, None, None, None);
    if !returns_rows(query) {
        let result = sqlx::query(query)
            .execute(pool)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        let rows_affected = result.rows_affected();
        let total_ms = start.elapsed().as_millis() as u64;
        emit_progress(
            app,
            query_id,
            "done",
            rows_affected as usize,
            total_ms,
            Some(total_ms),
            Some(0),
            Some(0),
        );
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: rows_affected as usize,
            message: Some(format!("{} row(s) affected.", rows_affected)),
            server_time_ms: Some(total_ms),
            transfer_time_ms: Some(0),
            bytes_transferred: Some(0),
        });
    }

    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    if rows.is_empty() {
        let total_ms = start.elapsed().as_millis() as u64;
        emit_progress(app, query_id, "done", 0, total_ms, Some(total_ms), Some(0), Some(0));
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("0 row(s) affected.".to_string()),
            server_time_ms: Some(total_ms),
            transfer_time_ms: Some(0),
            bytes_transferred: Some(0),
        });
    }

    let columns: Vec<String> = rows[0]
        .columns()
        .iter()
        .map(|c| c.name().to_string())
        .collect();

    let mut result_rows = Vec::new();
    for row in &rows {
        let mut row_values = Vec::new();
        for (i, col) in row.columns().iter().enumerate() {
            let value = sqlite_value_to_json(&row, i, col.type_info().name());
            row_values.push(value);
        }
        result_rows.push(row_values);
    }

    let total_ms = start.elapsed().as_millis() as u64;
    emit_progress(
        app,
        query_id,
        "done",
        result_rows.len(),
        total_ms,
        Some(total_ms),
        Some(0),
        None,
    );
    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
        message: None,
        server_time_ms: Some(total_ms),
        transfer_time_ms: Some(0),
        bytes_transferred: None,
    })
}

fn sqlite_value_to_json(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    use sqlx::{Row, ValueRef};

    if row.try_get_raw(index).map_or(true, |v| v.is_null()) {
        return serde_json::Value::Null;
    }

    match type_name {
        "BOOLEAN" => row
            .try_get::<bool, _>(index)
            .map(serde_json::Value::Bool),
        "INTEGER" => row
            .try_get::<i64, _>(index)
            .map(|v| serde_json::Value::Number(v.into())),
        "REAL" => row
            .try_get::<f64, _>(index)
            .map(|v| {
                serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::String(v.to_string()))
            }),
        _ => row
            .try_get::<String, _>(index)
            .map(serde_json::Value::String),
    }
    .unwrap_or_else(|_| {
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned()))
            .unwrap_or_else(|_| {
                serde_json::Value::String(format!("<unsupported type: {}>", type_name))
            })
    })
}
