// ABOUTME: Handles persistence of database connection configurations.
// ABOUTME: Stores connections as JSON in the user's config directory.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Postgres,
    Mysql,
    Sqlite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
}

impl ConnectionConfig {
    pub fn new(
        name: String,
        db_type: DatabaseType,
        host: String,
        port: u16,
        username: String,
        password: String,
        database: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            db_type,
            host,
            port,
            username,
            password,
            database,
        }
    }
}

fn connections_file_path(config_dir: &Path) -> PathBuf {
    fs::create_dir_all(config_dir).ok();
    config_dir.join("connections.json")
}

pub fn load_connections(config_dir: &Path) -> Vec<ConnectionConfig> {
    let path = connections_file_path(config_dir);
    if !path.exists() {
        return Vec::new();
    }

    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_connections(config_dir: &Path, connections: &[ConnectionConfig]) -> Result<(), String> {
    let path = connections_file_path(config_dir);
    let content = serde_json::to_string_pretty(connections)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write connections file: {}", e))
}

pub fn add_connection(
    config_dir: &Path,
    config: ConnectionConfig,
) -> Result<ConnectionConfig, String> {
    let mut connections = load_connections(config_dir);
    connections.push(config.clone());
    save_connections(config_dir, &connections)?;
    Ok(config)
}

pub fn remove_connection(config_dir: &Path, id: &str) -> Result<(), String> {
    let mut connections = load_connections(config_dir);
    let original_len = connections.len();
    connections.retain(|c| c.id != id);

    if connections.len() == original_len {
        return Err(format!("Connection with id '{}' not found", id));
    }

    save_connections(config_dir, &connections)
}

pub fn get_connection(config_dir: &Path, id: &str) -> Option<ConnectionConfig> {
    load_connections(config_dir)
        .into_iter()
        .find(|c| c.id == id)
}
