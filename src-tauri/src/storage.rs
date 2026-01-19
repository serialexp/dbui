// ABOUTME: Handles persistence of database connection configurations and categories.
// ABOUTME: Stores connections and categories as JSON in the user's config directory.

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
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
}

impl Category {
    pub fn new(name: String, color: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            color,
        }
    }
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
    #[serde(default)]
    pub category_id: Option<String>,
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
        category_id: Option<String>,
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
            category_id,
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

pub fn update_connection(config_dir: &Path, config: ConnectionConfig) -> Result<ConnectionConfig, String> {
    let mut connections = load_connections(config_dir);
    let found = connections.iter_mut().find(|c| c.id == config.id);

    match found {
        Some(existing) => {
            *existing = config.clone();
            save_connections(config_dir, &connections)?;
            Ok(config)
        }
        None => Err(format!("Connection with id '{}' not found", config.id)),
    }
}

fn categories_file_path(config_dir: &Path) -> PathBuf {
    fs::create_dir_all(config_dir).ok();
    config_dir.join("categories.json")
}

pub fn load_categories(config_dir: &Path) -> Vec<Category> {
    let path = categories_file_path(config_dir);
    if !path.exists() {
        return Vec::new();
    }

    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_categories(config_dir: &Path, categories: &[Category]) -> Result<(), String> {
    let path = categories_file_path(config_dir);
    let content = serde_json::to_string_pretty(categories)
        .map_err(|e| format!("Failed to serialize categories: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write categories file: {}", e))
}

pub fn add_category(config_dir: &Path, category: Category) -> Result<Category, String> {
    let mut categories = load_categories(config_dir);
    categories.push(category.clone());
    save_categories(config_dir, &categories)?;
    Ok(category)
}

pub fn update_category(config_dir: &Path, category: Category) -> Result<Category, String> {
    let mut categories = load_categories(config_dir);
    let found = categories.iter_mut().find(|c| c.id == category.id);

    match found {
        Some(existing) => {
            existing.name = category.name.clone();
            existing.color = category.color.clone();
            save_categories(config_dir, &categories)?;
            Ok(category)
        }
        None => Err(format!("Category with id '{}' not found", category.id)),
    }
}

pub fn remove_category(config_dir: &Path, id: &str) -> Result<(), String> {
    let mut categories = load_categories(config_dir);
    let original_len = categories.len();
    categories.retain(|c| c.id != id);

    if categories.len() == original_len {
        return Err(format!("Category with id '{}' not found", id));
    }

    save_categories(config_dir, &categories)?;

    // Clear category_id from connections that used this category
    let mut connections = load_connections(config_dir);
    let mut updated = false;
    for conn in connections.iter_mut() {
        if conn.category_id.as_deref() == Some(id) {
            conn.category_id = None;
            updated = true;
        }
    }
    if updated {
        save_connections(config_dir, &connections)?;
    }

    Ok(())
}
