// ABOUTME: Entry point for the DBUI Tauri application.
// ABOUTME: Initializes the Rust backend and starts the app.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dbui_lib::run()
}
