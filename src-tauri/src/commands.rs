// ABOUTME: Tauri command handlers for frontend-backend communication.
// ABOUTME: Exposes database operations and connection management to the UI.

use crate::cloud::{
    self, AwsParameter, AwsProfile, AwsSecret, KubeContext, KubeNamespace, KubeSecret,
    KubeSecretKey, ParsedConnection,
};
use crate::db::{ColumnInfo, ConnectionManager, ConstraintInfo, FunctionInfo, IndexInfo, QueryResult};
use crate::history::{HistoryManager, QueryHistoryEntry, QueryHistoryFilter};
use crate::storage::{self, Category, ConnectionConfig, DatabaseType};
use std::sync::OnceLock;
use tauri::Manager;
use tokio::sync::OnceCell;

static CONNECTION_MANAGER: OnceLock<ConnectionManager> = OnceLock::new();
static HISTORY_MANAGER: OnceCell<HistoryManager> = OnceCell::const_new();

fn get_manager() -> &'static ConnectionManager {
    CONNECTION_MANAGER.get_or_init(ConnectionManager::new)
}

async fn get_history_manager(app: &tauri::AppHandle) -> Result<&'static HistoryManager, String> {
    HISTORY_MANAGER
        .get_or_try_init(|| async {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| format!("Failed to get config directory: {}", e))?;
            let history_db_path = config_dir.join("history.db");
            HistoryManager::new(&history_db_path).await
        })
        .await
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
    pub category_id: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct UpdateConnectionInput {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
    pub category_id: Option<String>,
}

#[tauri::command]
pub fn save_connection(
    app: tauri::AppHandle,
    input: SaveConnectionInput,
) -> Result<ConnectionConfig, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let config = ConnectionConfig::new(
        input.name,
        input.db_type,
        input.host,
        input.port,
        input.username,
        input.password,
        input.database,
        input.category_id,
    );
    storage::add_connection(&config_dir, config)
}

#[tauri::command]
pub fn list_connections(app: tauri::AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    Ok(storage::load_connections(&config_dir))
}

#[tauri::command]
pub fn delete_connection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    storage::remove_connection(&config_dir, &id)
}

#[tauri::command]
pub fn update_connection(
    app: tauri::AppHandle,
    input: UpdateConnectionInput,
) -> Result<ConnectionConfig, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let config = ConnectionConfig {
        id: input.id,
        name: input.name,
        db_type: input.db_type,
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.password,
        database: input.database,
        category_id: input.category_id,
    };
    storage::update_connection(&config_dir, config)
}

#[tauri::command]
pub async fn connect(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let config_dir = app
        .path()
        .app_config_dir()
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
pub async fn switch_database(app: tauri::AppHandle, connection_id: String, database: String) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let config = storage::get_connection(&config_dir, &connection_id)
        .ok_or_else(|| format!("Connection '{}' not found", connection_id))?;
    get_manager().switch_database(&config, &database).await
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
pub async fn list_functions(
    connection_id: String,
    database: String,
    schema: String,
) -> Result<Vec<String>, String> {
    get_manager()
        .list_functions(&connection_id, &database, &schema)
        .await
}

#[tauri::command]
pub async fn get_function_definition(
    connection_id: String,
    database: String,
    schema: String,
    function_name: String,
) -> Result<FunctionInfo, String> {
    get_manager()
        .get_function_definition(&connection_id, &database, &schema, &function_name)
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
pub async fn execute_query(connection_id: String, query: String) -> Result<(QueryResult, u64), String> {
    let start = std::time::Instant::now();
    let result = get_manager().execute_query(&connection_id, &query).await?;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    Ok((result, elapsed_ms))
}

#[tauri::command]
pub async fn save_query_history(
    app: tauri::AppHandle,
    entry: QueryHistoryEntry,
) -> Result<(), String> {
    let history = get_history_manager(&app).await?;
    history.save_entry(entry).await
}

#[tauri::command]
pub async fn get_query_history(
    app: tauri::AppHandle,
    filter: QueryHistoryFilter,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let history = get_history_manager(&app).await?;
    history.get_entries(filter).await
}

#[tauri::command]
pub async fn search_query_history(
    app: tauri::AppHandle,
    filter: QueryHistoryFilter,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let history = get_history_manager(&app).await?;
    history.search_entries(filter).await
}

#[tauri::command]
pub async fn delete_query_history(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let history = get_history_manager(&app).await?;
    history.delete_entry(&id).await
}

#[tauri::command]
pub async fn clear_query_history(
    app: tauri::AppHandle,
    connection_id: Option<String>,
) -> Result<(), String> {
    let history = get_history_manager(&app).await?;
    history.clear_history(connection_id).await
}

#[derive(serde::Deserialize)]
pub struct SaveCategoryInput {
    pub name: String,
    pub color: String,
}

#[derive(serde::Deserialize)]
pub struct UpdateCategoryInput {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[tauri::command]
pub fn list_categories(app: tauri::AppHandle) -> Result<Vec<Category>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    Ok(storage::load_categories(&config_dir))
}

#[tauri::command]
pub fn save_category(app: tauri::AppHandle, input: SaveCategoryInput) -> Result<Category, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let category = Category::new(input.name, input.color);
    storage::add_category(&config_dir, category)
}

#[tauri::command]
pub fn update_category(
    app: tauri::AppHandle,
    input: UpdateCategoryInput,
) -> Result<Category, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    let category = Category {
        id: input.id,
        name: input.name,
        color: input.color,
    };
    storage::update_category(&config_dir, category)
}

#[tauri::command]
pub fn delete_category(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;
    storage::remove_category(&config_dir, &id)
}

#[tauri::command]
pub fn list_aws_profiles() -> Result<Vec<AwsProfile>, String> {
    cloud::list_aws_profiles()
}

#[tauri::command]
pub async fn list_ssm_parameters(
    profile: String,
    region: String,
    path_prefix: Option<String>,
) -> Result<Vec<AwsParameter>, String> {
    cloud::list_ssm_parameters(&profile, &region, path_prefix.as_deref()).await
}

#[tauri::command]
pub async fn get_ssm_parameter_value(
    profile: String,
    region: String,
    name: String,
) -> Result<String, String> {
    cloud::get_ssm_parameter_value(&profile, &region, &name).await
}

#[tauri::command]
pub async fn list_aws_secrets(profile: String, region: String) -> Result<Vec<AwsSecret>, String> {
    cloud::list_aws_secrets(&profile, &region).await
}

#[tauri::command]
pub async fn get_aws_secret_value(
    profile: String,
    region: String,
    secret_id: String,
) -> Result<String, String> {
    cloud::get_aws_secret_value(&profile, &region, &secret_id).await
}

#[tauri::command]
pub fn list_kube_contexts() -> Result<Vec<KubeContext>, String> {
    cloud::list_kube_contexts()
}

#[tauri::command]
pub async fn list_kube_namespaces(context: String) -> Result<Vec<KubeNamespace>, String> {
    cloud::list_kube_namespaces(&context).await
}

#[tauri::command]
pub async fn list_kube_secrets(
    context: String,
    namespace: String,
) -> Result<Vec<KubeSecret>, String> {
    cloud::list_kube_secrets(&context, &namespace).await
}

#[tauri::command]
pub async fn list_kube_secret_keys(
    context: String,
    namespace: String,
    secret_name: String,
) -> Result<Vec<KubeSecretKey>, String> {
    cloud::list_kube_secret_keys(&context, &namespace, &secret_name).await
}

#[tauri::command]
pub async fn get_kube_secret_value(
    context: String,
    namespace: String,
    secret_name: String,
    key: String,
) -> Result<String, String> {
    cloud::get_kube_secret_value(&context, &namespace, &secret_name, &key).await
}

#[tauri::command]
pub fn parse_connection_url(url: String) -> Result<ParsedConnection, String> {
    cloud::parse_connection_url(&url).map_err(|e| e.to_string())
}
