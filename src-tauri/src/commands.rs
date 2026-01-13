// ABOUTME: Tauri command handlers for frontend-backend communication.
// ABOUTME: Exposes database operations and connection management to the UI.

use crate::db::{ColumnInfo, ConnectionManager, ConstraintInfo, IndexInfo, QueryResult};
use crate::storage::{self, ConnectionConfig, DatabaseType};
use std::sync::OnceLock;
use tauri::Manager;

static CONNECTION_MANAGER: OnceLock<ConnectionManager> = OnceLock::new();

fn get_manager() -> &'static ConnectionManager {
    CONNECTION_MANAGER.get_or_init(ConnectionManager::new)
}

#[derive(serde::Deserialize)]
pub struct SaveConnectionInput {
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
}

#[tauri::command]
pub fn save_connection(app: tauri::AppHandle, input: SaveConnectionInput) -> Result<ConnectionConfig, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let config = ConnectionConfig::new(
        input.name,
        input.db_type,
        input.host,
        input.port,
        input.username,
        input.password,
        input.database,
    );
    storage::add_connection(&config_dir, config)
}

#[tauri::command]
pub fn list_connections(app: tauri::AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    Ok(storage::load_connections(&config_dir))
}

#[tauri::command]
pub fn delete_connection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    storage::remove_connection(&config_dir, &id)
}

#[tauri::command]
pub async fn connect(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let config = storage::get_connection(&config_dir, &id)
        .ok_or_else(|| format!("Connection '{}' not found", id))?;
    get_manager().connect(&config).await
}

#[tauri::command]
pub async fn disconnect(connection_id: String) -> Result<(), String> {
    get_manager().disconnect(&connection_id).await
}

#[tauri::command]
pub async fn list_databases(connection_id: String) -> Result<Vec<String>, String> {
    get_manager().list_databases(&connection_id).await
}

#[tauri::command]
pub async fn list_schemas(connection_id: String, database: String) -> Result<Vec<String>, String> {
    get_manager().list_schemas(&connection_id, &database).await
}

#[tauri::command]
pub async fn list_tables(
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Vec<String>, String> {
    get_manager()
        .list_tables(&connection_id, &database, &schema)
        .await
}

#[tauri::command]
pub async fn list_views(
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Vec<String>, String> {
    get_manager()
        .list_views(&connection_id, &database, &schema)
        .await
}

#[tauri::command]
pub async fn list_columns(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    get_manager()
        .list_columns(&connection_id, &database, &schema, &table)
        .await
}

#[tauri::command]
pub async fn list_indexes(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    get_manager()
        .list_indexes(&connection_id, &database, &schema, &table)
        .await
}

#[tauri::command]
pub async fn list_constraints(
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ConstraintInfo>, String> {
    get_manager()
        .list_constraints(&connection_id, &database, &schema, &table)
        .await
}

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    query: String,
) -> Result<QueryResult, String> {
    get_manager().execute_query(&connection_id, &query).await
}
