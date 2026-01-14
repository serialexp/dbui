// ABOUTME: Database connection management and query execution.
// ABOUTME: Supports PostgreSQL, MySQL, and SQLite with runtime driver selection.

pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::storage::{ConnectionConfig, DatabaseType};
use serde::{Deserialize, Serialize};
use sqlx::Column;
use sqlx::Row;
use sqlx::TypeInfo;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

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
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

pub enum ConnectionPool {
    Postgres(sqlx::PgPool),
    Mysql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
}

pub struct ConnectionManager {
    pools: RwLock<HashMap<String, Arc<ConnectionPool>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, config: &ConnectionConfig) -> Result<String, String> {
        let connection_id = config.id.clone();

        let pool = match config.db_type {
            DatabaseType::Postgres => {
                let url = format!(
                    "postgres://{}:{}@{}:{}/{}",
                    config.username,
                    config.password,
                    config.host,
                    config.port,
                    config.database.as_deref().unwrap_or("postgres")
                );
                let pool = sqlx::PgPool::connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to PostgreSQL: {}", e))?;
                ConnectionPool::Postgres(pool)
            }
            DatabaseType::Mysql => {
                let url = format!(
                    "mysql://{}:{}@{}:{}/{}",
                    config.username,
                    config.password,
                    config.host,
                    config.port,
                    config.database.as_deref().unwrap_or("mysql")
                );
                let pool = sqlx::MySqlPool::connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
                ConnectionPool::Mysql(pool)
            }
            DatabaseType::Sqlite => {
                // For SQLite, host field contains the file path
                let url = format!("sqlite:{}", config.host);
                let pool = sqlx::SqlitePool::connect(&url)
                    .await
                    .map_err(|e| format!("Failed to connect to SQLite: {}", e))?;
                ConnectionPool::Sqlite(pool)
            }
        };

        let mut pools = self.pools.write().await;
        pools.insert(connection_id.clone(), Arc::new(pool));
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
        // Disconnect existing connection if any
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
            .cloned()
            .ok_or_else(|| format!("Connection '{}' not found or not connected", connection_id))
    }

    pub async fn list_databases(&self, connection_id: &str) -> Result<Vec<String>, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => postgres::list_databases(p).await,
            ConnectionPool::Mysql(p) => mysql::list_databases(p).await,
            ConnectionPool::Sqlite(p) => sqlite::list_databases(p).await,
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
        }
    }

    pub async fn execute_query(
        &self,
        connection_id: &str,
        query: &str,
    ) -> Result<QueryResult, String> {
        let pool = self.get_pool(connection_id).await?;
        match pool.as_ref() {
            ConnectionPool::Postgres(p) => execute_query_pg(p, query).await,
            ConnectionPool::Mysql(p) => execute_query_mysql(p, query).await,
            ConnectionPool::Sqlite(p) => execute_query_sqlite(p, query).await,
        }
    }
}

async fn execute_query_pg(pool: &sqlx::PgPool, query: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
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
            let value = pg_value_to_json(&row, i, col.type_info().name());
            row_values.push(value);
        }
        result_rows.push(row_values);
    }

    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
    })
}

fn pg_value_to_json(
    row: &sqlx::postgres::PgRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOL" => row
            .try_get::<bool, _>(index)
            .ok()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        "INT2" => row
            .try_get::<i16, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "INT4" => row
            .try_get::<i32, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "INT8" => row
            .try_get::<i64, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "FLOAT4" | "FLOAT8" => row
            .try_get::<f64, _>(index)
            .ok()
            .and_then(|v| serde_json::Number::from_f64(v))
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        _ => row
            .try_get::<String, _>(index)
            .ok()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}

async fn execute_query_mysql(pool: &sqlx::MySqlPool, query: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
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
            let value = mysql_value_to_json(&row, i, col.type_info().name());
            row_values.push(value);
        }
        result_rows.push(row_values);
    }

    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
    })
}

fn mysql_value_to_json(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOLEAN" | "TINYINT(1)" => row
            .try_get::<bool, _>(index)
            .ok()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" => row
            .try_get::<i32, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "BIGINT" => row
            .try_get::<i64, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "FLOAT" | "DOUBLE" | "DECIMAL" => row
            .try_get::<f64, _>(index)
            .ok()
            .and_then(|v| serde_json::Number::from_f64(v))
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        _ => row
            .try_get::<String, _>(index)
            .ok()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}

async fn execute_query_sqlite(pool: &sqlx::SqlitePool, query: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    if rows.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
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

    Ok(QueryResult {
        columns,
        row_count: result_rows.len(),
        rows: result_rows,
    })
}

fn sqlite_value_to_json(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    type_name: &str,
) -> serde_json::Value {
    match type_name {
        "BOOLEAN" => row
            .try_get::<bool, _>(index)
            .ok()
            .map(serde_json::Value::Bool)
            .unwrap_or(serde_json::Value::Null),
        "INTEGER" => row
            .try_get::<i64, _>(index)
            .ok()
            .map(|v| serde_json::Value::Number(v.into()))
            .unwrap_or(serde_json::Value::Null),
        "REAL" => row
            .try_get::<f64, _>(index)
            .ok()
            .and_then(|v| serde_json::Number::from_f64(v))
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        _ => row
            .try_get::<String, _>(index)
            .ok()
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null),
    }
}
