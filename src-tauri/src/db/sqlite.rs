// ABOUTME: SQLite-specific database introspection queries.
// ABOUTME: Uses PRAGMA statements and sqlite_master for schema information.

use super::{ColumnInfo, ConstraintInfo, IndexInfo};
use sqlx::Row;

pub async fn list_databases(_pool: &sqlx::SqlitePool) -> Result<Vec<String>, String> {
    // SQLite is file-based, so there's just one "database" - we call it "main"
    Ok(vec!["main".to_string()])
}

pub async fn list_schemas(
    _pool: &sqlx::SqlitePool,
    _database: &str,
) -> Result<Vec<String>, String> {
    // SQLite doesn't have schemas, return "main" as the single schema
    Ok(vec!["main".to_string()])
}

pub async fn list_tables(
    pool: &sqlx::SqlitePool,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list tables: {}", e))?;

    Ok(rows.iter().map(|r| r.get("name")).collect())
}

pub async fn list_views(
    pool: &sqlx::SqlitePool,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list views: {}", e))?;

    Ok(rows.iter().map(|r| r.get("name")).collect())
}

pub async fn list_columns(
    pool: &sqlx::SqlitePool,
    _database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let query = format!("PRAGMA table_info(\"{}\")", table);
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list columns: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| ColumnInfo {
            name: r.get("name"),
            data_type: r.get("type"),
            is_nullable: r.get::<i32, _>("notnull") == 0,
            column_default: r.get("dflt_value"),
            is_primary_key: r.get::<i32, _>("pk") > 0,
        })
        .collect())
}

pub async fn list_indexes(
    pool: &sqlx::SqlitePool,
    _database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let query = format!("PRAGMA index_list(\"{}\")", table);
    let index_rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list indexes: {}", e))?;

    let mut indexes = Vec::new();
    for row in &index_rows {
        let index_name: String = row.get("name");
        let is_unique: bool = row.get::<i32, _>("unique") == 1;
        let origin: String = row.get("origin");
        let is_primary = origin == "pk";

        let col_query = format!("PRAGMA index_info(\"{}\")", index_name);
        let col_rows = sqlx::query(&col_query)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to get index columns: {}", e))?;

        let columns: Vec<String> = col_rows.iter().map(|r| r.get("name")).collect();

        indexes.push(IndexInfo {
            name: index_name,
            columns,
            is_unique,
            is_primary,
        });
    }

    Ok(indexes)
}

pub async fn list_constraints(
    pool: &sqlx::SqlitePool,
    _database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ConstraintInfo>, String> {
    let mut constraints = Vec::new();

    // Get foreign keys
    let fk_query = format!("PRAGMA foreign_key_list(\"{}\")", table);
    let fk_rows = sqlx::query(&fk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list foreign keys: {}", e))?;

    // Group by id to handle multi-column foreign keys
    let mut fk_map: std::collections::HashMap<i32, (String, Vec<String>, Vec<String>)> =
        std::collections::HashMap::new();

    for row in &fk_rows {
        let id: i32 = row.get("id");
        let table_ref: String = row.get("table");
        let from_col: String = row.get("from");
        let to_col: String = row.get("to");

        fk_map
            .entry(id)
            .or_insert_with(|| (table_ref, Vec::new(), Vec::new()))
            .1
            .push(from_col);
        fk_map.get_mut(&id).unwrap().2.push(to_col);
    }

    for (id, (foreign_table, columns, foreign_columns)) in fk_map {
        constraints.push(ConstraintInfo {
            name: format!("fk_{}_{}", table, id),
            constraint_type: "FOREIGN KEY".to_string(),
            columns,
            foreign_table: Some(foreign_table),
            foreign_columns: Some(foreign_columns),
        });
    }

    // Get primary key constraint
    let pk_query = format!("PRAGMA table_info(\"{}\")", table);
    let pk_rows = sqlx::query(&pk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to get primary key: {}", e))?;

    let pk_columns: Vec<String> = pk_rows
        .iter()
        .filter(|r| r.get::<i32, _>("pk") > 0)
        .map(|r| r.get("name"))
        .collect();

    if !pk_columns.is_empty() {
        constraints.push(ConstraintInfo {
            name: format!("{}_pkey", table),
            constraint_type: "PRIMARY KEY".to_string(),
            columns: pk_columns,
            foreign_table: None,
            foreign_columns: None,
        });
    }

    Ok(constraints)
}
