// ABOUTME: Core library for DBUI Tauri application.
// ABOUTME: Contains database connection management and Tauri command handlers.

mod cloud;
mod commands;
mod db;
mod history;
mod sql_analyzer;
mod storage;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install rustls crypto provider before any TLS connections
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_connection,
            list_connections,
            delete_connection,
            set_visible_databases,
            update_connection,
            save_last_selected,
            cancel_queries,
            connect,
            disconnect,
            switch_database,
            list_databases,
            list_schemas,
            create_database,
            create_schema,
            list_tables,
            list_views,
            list_functions,
            list_materialized_views,
            list_sequences,
            list_triggers,
            list_procedures,
            get_function_definition,
            get_view_definition,
            get_view_dependencies,
            list_columns,
            list_indexes,
            list_constraints,
            execute_query,
            save_query_history,
            get_query_history,
            search_query_history,
            delete_query_history,
            clear_query_history,
            list_categories,
            save_category,
            update_category,
            delete_category,
            list_aws_profiles,
            list_ssm_parameters,
            get_ssm_parameter_value,
            list_aws_secrets,
            get_aws_secret_value,
            list_kube_contexts,
            list_kube_namespaces,
            list_kube_secrets,
            list_kube_secret_keys,
            get_kube_secret_value,
            parse_connection_url,
            extract_query_table,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
