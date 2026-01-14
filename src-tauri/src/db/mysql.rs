// ABOUTME: MySQL-specific database introspection queries.
// ABOUTME: Provides schema, table, column, index, and constraint information.

use super::{ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo};
use sqlx::Row;

pub async fn list_databases(pool: &sqlx::MySqlPool) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| r.get::<String, _>(0))
        .filter(|name| {
            name != "information_schema"
                && name != "mysql"
                && name != "performance_schema"
                && name != "sys"
        })
        .collect())
}

pub async fn list_schemas(_pool: &sqlx::MySqlPool, database: &str) -> Result<Vec<String>, String> {
    // In MySQL, schemas and databases are synonymous
    // Return the current database as the only "schema"
    Ok(vec![database.to_string()])
}

pub async fn list_tables(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables
         WHERE table_schema = ? AND table_type = 'BASE TABLE'
         ORDER BY table_name",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list tables: {}", e))?;

    Ok(rows.iter().map(|r| r.get("table_name")).collect())
}

pub async fn list_views(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.views
         WHERE table_schema = ?
         ORDER BY table_name",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list views: {}", e))?;

    Ok(rows.iter().map(|r| r.get("table_name")).collect())
}

pub async fn list_functions(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines
         WHERE routine_schema = ? AND routine_type = 'FUNCTION'
         ORDER BY routine_name",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list functions: {}", e))?;

    Ok(rows.iter().map(|r| r.get("routine_name")).collect())
}

pub async fn get_function_definition(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    function_name: &str,
) -> Result<FunctionInfo, String> {
    // First, get the function info from information_schema
    let info_row = sqlx::query(
        "SELECT routine_name, data_type, external_language
         FROM information_schema.routines
         WHERE routine_schema = ? AND routine_name = ? AND routine_type = 'FUNCTION'
         LIMIT 1",
    )
    .bind(database)
    .bind(function_name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to get function info: {}", e))?;

    // Get the CREATE FUNCTION statement
    let query = format!("SHOW CREATE FUNCTION `{}`.`{}`", database, function_name);
    let create_row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get function definition: {}", e))?;

    let definition: String = create_row.try_get(2).unwrap_or_default();

    Ok(FunctionInfo {
        name: info_row.get("routine_name"),
        definition,
        return_type: info_row.get("data_type"),
        language: info_row.get("external_language"),
    })
}

pub async fn list_columns(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            column_name,
            data_type,
            is_nullable,
            column_default,
            column_key
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
        "#,
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list columns: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| ColumnInfo {
            name: r.get("column_name"),
            data_type: r.get("data_type"),
            is_nullable: r.get::<String, _>("is_nullable") == "YES",
            column_default: r.get("column_default"),
            is_primary_key: r.get::<String, _>("column_key") == "PRI",
        })
        .collect())
}

pub async fn list_indexes(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            index_name,
            GROUP_CONCAT(column_name ORDER BY seq_in_index) as columns,
            NOT non_unique as is_unique,
            index_name = 'PRIMARY' as is_primary
        FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ?
        GROUP BY index_name, non_unique
        ORDER BY index_name
        "#,
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list indexes: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let columns_str: String = r.get("columns");
            IndexInfo {
                name: r.get("index_name"),
                columns: columns_str.split(',').map(|s| s.to_string()).collect(),
                is_unique: r.get("is_unique"),
                is_primary: r.get("is_primary"),
            }
        })
        .collect())
}

pub async fn list_constraints(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ConstraintInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            tc.constraint_name,
            tc.constraint_type,
            GROUP_CONCAT(DISTINCT kcu.column_name) as columns,
            kcu.referenced_table_name as foreign_table,
            GROUP_CONCAT(DISTINCT kcu.referenced_column_name) as foreign_columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = ? AND tc.table_name = ?
        GROUP BY tc.constraint_name, tc.constraint_type, kcu.referenced_table_name
        ORDER BY tc.constraint_name
        "#,
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list constraints: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let foreign_cols: Option<String> = r.get("foreign_columns");
            ConstraintInfo {
                name: r.get("constraint_name"),
                constraint_type: r.get("constraint_type"),
                columns: r
                    .get::<String, _>("columns")
                    .split(',')
                    .map(|s| s.to_string())
                    .collect(),
                foreign_table: r.get("foreign_table"),
                foreign_columns: foreign_cols
                    .map(|s| s.split(',').map(|c| c.to_string()).collect()),
            }
        })
        .collect())
}
