// ABOUTME: PostgreSQL-specific database introspection queries.
// ABOUTME: Provides schema, table, column, index, and constraint information.

use super::{ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo};
use sqlx::Row;

pub async fn list_databases(pool: &sqlx::PgPool) -> Result<Vec<String>, String> {
    let rows =
        sqlx::query(
            "SELECT datname FROM pg_database
             WHERE datistemplate = false
             AND has_database_privilege(datname, 'CONNECT')
             ORDER BY datname"
        )
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Failed to list databases: {}", e))?;

    Ok(rows.iter().map(|r| r.get("datname")).collect())
}

pub async fn list_schemas(_pool: &sqlx::PgPool, _database: &str) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT schema_name FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         ORDER BY schema_name",
    )
    .fetch_all(_pool)
    .await
    .map_err(|e| format!("Failed to list schemas: {}", e))?;

    Ok(rows.iter().map(|r| r.get("schema_name")).collect())
}

pub async fn list_tables(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list tables: {}", e))?;

    Ok(rows.iter().map(|r| r.get("table_name")).collect())
}

pub async fn list_views(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.views
         WHERE table_schema = $1
         ORDER BY table_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list views: {}", e))?;

    Ok(rows.iter().map(|r| r.get("table_name")).collect())
}

pub async fn list_functions(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines
         WHERE routine_schema = $1 AND routine_type = 'FUNCTION'
         ORDER BY routine_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list functions: {}", e))?;

    Ok(rows.iter().map(|r| r.get("routine_name")).collect())
}

pub async fn get_function_definition(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
    function_name: &str,
) -> Result<FunctionInfo, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            p.proname as name,
            pg_get_functiondef(p.oid) as definition,
            pg_catalog.format_type(p.prorettype, NULL) as return_type,
            l.lanname as language
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        JOIN pg_language l ON p.prolang = l.oid
        WHERE n.nspname = $1 AND p.proname = $2
        LIMIT 1
        "#,
    )
    .bind(schema)
    .bind(function_name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to get function definition: {}", e))?;

    Ok(FunctionInfo {
        name: rows.get("name"),
        definition: rows.get("definition"),
        return_type: rows.get("return_type"),
        language: rows.get("language"),
    })
}

pub async fn list_columns(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_schema = $1
                AND tc.table_name = $2
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position
        "#,
    )
    .bind(schema)
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
            is_primary_key: r.get("is_primary_key"),
        })
        .collect())
}

pub async fn list_indexes(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            i.relname as index_name,
            array_agg(a.attname::TEXT ORDER BY array_position(ix.indkey, a.attnum))::TEXT[] as columns,
            ix.indisunique as is_unique,
            ix.indisprimary as is_primary
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        WHERE n.nspname = $1 AND t.relname = $2
        GROUP BY i.relname, ix.indisunique, ix.indisprimary
        ORDER BY i.relname
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list indexes: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| IndexInfo {
            name: r.try_get("index_name").unwrap_or_default(),
            columns: r.try_get("columns").unwrap_or_default(),
            is_unique: r.try_get("is_unique").unwrap_or_default(),
            is_primary: r.try_get("is_primary").unwrap_or_default(),
        })
        .collect())
}

pub async fn list_constraints(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ConstraintInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            tc.constraint_name,
            tc.constraint_type,
            array_agg(DISTINCT kcu.column_name::TEXT)::TEXT[] as columns,
            ccu.table_name as foreign_table,
            array_agg(DISTINCT ccu.column_name::TEXT) FILTER (WHERE ccu.column_name IS NOT NULL AND tc.constraint_type = 'FOREIGN KEY')::TEXT[] as foreign_columns
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            AND tc.table_schema = ccu.table_schema
            AND tc.constraint_type = 'FOREIGN KEY'
        WHERE tc.table_schema = $1 AND tc.table_name = $2
        GROUP BY tc.constraint_name, tc.constraint_type, ccu.table_name
        ORDER BY tc.constraint_name
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list constraints: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| ConstraintInfo {
            name: r.try_get("constraint_name").unwrap_or_default(),
            constraint_type: r.try_get("constraint_type").unwrap_or_default(),
            columns: r.try_get("columns").unwrap_or_default(),
            foreign_table: r.try_get("foreign_table").ok(),
            foreign_columns: r.try_get("foreign_columns").ok().flatten(),
        })
        .collect())
}
