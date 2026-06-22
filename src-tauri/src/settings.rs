// ABOUTME: Handles persistence of app-level settings (not tied to a connection).
// ABOUTME: Stores settings as JSON in the user's config directory (settings.json).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn default_ollama_base_url() -> String {
    "http://localhost:11434".to_string()
}

fn default_ollama_model() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_ollama_base_url")]
    pub ollama_base_url: String,
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ollama_base_url: default_ollama_base_url(),
            ollama_model: default_ollama_model(),
        }
    }
}

fn settings_file_path(config_dir: &Path) -> PathBuf {
    fs::create_dir_all(config_dir).ok();
    config_dir.join("settings.json")
}

pub fn load_settings(config_dir: &Path) -> AppSettings {
    let path = settings_file_path(config_dir);
    if !path.exists() {
        return AppSettings::default();
    }

    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_settings(config_dir: &Path, settings: &AppSettings) -> Result<AppSettings, String> {
    let path = settings_file_path(config_dir);
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write settings file: {}", e))?;
    Ok(settings.clone())
}
