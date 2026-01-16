// ABOUTME: Core library for DBUI Tauri application.
// ABOUTME: Contains database connection management and Tauri command handlers.

mod commands;
mod db;
mod history;
mod storage;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_connection,
            list_connections,
            delete_connection,
            connect,
            disconnect,
            switch_database,
            list_databases,
            list_schemas,
            list_tables,
            list_views,
            list_functions,
            get_function_definition,
            list_columns,
            list_indexes,
            list_constraints,
            execute_query,
            save_query_history,
            get_query_history,
            search_query_history,
            delete_query_history,
            clear_query_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
