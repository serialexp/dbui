// ABOUTME: MySQL-specific database introspection queries.
// ABOUTME: Provides schema, table, column, index, and constraint information.

use super::{ColumnInfo, ConstraintInfo, DatabaseUser, FunctionInfo, IndexInfo, UserGrant};
use sqlx::Row;

/// MySQL over TLS may return information_schema strings as VARBINARY instead of VARCHAR.
/// This helper tries String first, then falls back to reading raw bytes.
/// Uses positional index to avoid column-name lookup issues.
fn get_str(row: &sqlx::mysql::MySqlRow, index: usize) -> String {
    row.try_get::<String, _>(index).unwrap_or_else(|_| {
        row.try_get::<Vec<u8>, _>(index)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    })
}

fn get_opt_str(row: &sqlx::mysql::MySqlRow, index: usize) -> Option<String> {
    row.try_get::<Option<String>, _>(index)
        .unwrap_or_else(|_| {
            row.try_get::<Option<Vec<u8>>, _>(index)
                .ok()
                .flatten()
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
}

pub async fn list_databases(pool: &sqlx::MySqlPool) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| get_str(r, 0))
        .filter(|name| {
            name != "information_schema"
                && name != "mysql"
                && name != "performance_schema"
                && name != "sys"
        })
        .collect())
}

pub async fn list_schemas(_pool: &sqlx::MySqlPool, database: &str) -> Result<Vec<String>, String> {
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

    Ok(rows.iter().map(|r| get_str(r, 0)).collect())
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

    Ok(rows.iter().map(|r| get_str(r, 0)).collect())
}

pub async fn get_view_definition(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    view_name: &str,
) -> Result<super::FunctionInfo, String> {
    let query = format!("SHOW CREATE VIEW `{}`.`{}`", database, view_name);
    let row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get view definition: {}", e))?;

    let definition: String = get_str(&row, 1);

    Ok(super::FunctionInfo {
        name: view_name.to_string(),
        definition,
        return_type: None,
        language: Some("SQL".to_string()),
    })
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

    Ok(rows.iter().map(|r| get_str(r, 0)).collect())
}

pub async fn get_function_definition(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    function_name: &str,
) -> Result<FunctionInfo, String> {
    // SELECT routine_name(0), data_type(1), external_language(2)
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

    let query = format!("SHOW CREATE FUNCTION `{}`.`{}`", database, function_name);
    let create_row = sqlx::query(&query)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to get function definition: {}", e))?;

    let definition = get_str(&create_row, 2);

    Ok(FunctionInfo {
        name: get_str(&info_row, 0),
        definition,
        return_type: get_opt_str(&info_row, 1),
        language: get_opt_str(&info_row, 2),
    })
}

pub async fn list_materialized_views(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    // MySQL does not support materialized views
    Ok(vec![])
}

pub async fn list_sequences(
    _pool: &sqlx::MySqlPool,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    // MySQL does not have standalone sequences
    Ok(vec![])
}

pub async fn list_triggers(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT trigger_name FROM information_schema.triggers
         WHERE trigger_schema = ?
         ORDER BY trigger_name",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list triggers: {}", e))?;

    Ok(rows.iter().map(|r| get_str(r, 0)).collect())
}

pub async fn list_procedures(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines
         WHERE routine_schema = ? AND routine_type = 'PROCEDURE'
         ORDER BY routine_name",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list procedures: {}", e))?;

    Ok(rows.iter().map(|r| get_str(r, 0)).collect())
}

pub async fn list_columns(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    // SELECT column_name(0), column_type(1), is_nullable(2), column_default(3), column_key(4)
    let rows = sqlx::query(
        r#"
        SELECT
            column_name,
            column_type,
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
            name: get_str(r, 0),
            data_type: get_str(r, 1),
            is_nullable: get_str(r, 2) == "YES",
            column_default: get_opt_str(r, 3),
            is_primary_key: get_str(r, 4) == "PRI",
        })
        .collect())
}

pub async fn list_indexes(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<IndexInfo>, String> {
    // SELECT index_name(0), columns(1), is_unique(2), is_primary(3)
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
            let columns_str = get_str(r, 1);
            IndexInfo {
                name: get_str(r, 0),
                columns: columns_str.split(',').map(|s| s.to_string()).collect(),
                is_unique: r.get(2),
                is_primary: r.get(3),
            }
        })
        .collect())
}

pub async fn create_database(pool: &sqlx::MySqlPool, name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('`') || name.contains('\0') {
        return Err("Invalid database name".to_string());
    }
    let query = format!("CREATE DATABASE `{}`", name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create database: {}", e))?;
    Ok(())
}

pub async fn list_constraints(
    pool: &sqlx::MySqlPool,
    database: &str,
    _schema: &str,
    table: &str,
) -> Result<Vec<ConstraintInfo>, String> {
    // SELECT constraint_name(0), constraint_type(1), columns(2), foreign_table(3), foreign_columns(4)
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
            let foreign_cols = get_opt_str(r, 4);
            ConstraintInfo {
                name: get_str(r, 0),
                constraint_type: get_str(r, 1),
                columns: get_str(r, 2)
                    .split(',')
                    .map(|s| s.to_string())
                    .collect(),
                foreign_table: get_opt_str(r, 3),
                foreign_columns: foreign_cols
                    .map(|s| s.split(',').map(|c| c.to_string()).collect()),
            }
        })
        .collect())
}

pub async fn list_users(pool: &sqlx::MySqlPool) -> Result<Vec<DatabaseUser>, String> {
    // SELECT user(0), host(1), super_priv(2), create_user_priv(3), create_priv(4),
    //        repl_slave_priv(5), account_locked(6), password_lifetime(7)
    let rows = sqlx::query(
        r#"
        SELECT
            user, host, super_priv, create_user_priv, create_priv,
            repl_slave_priv, account_locked, password_lifetime
        FROM mysql.user
        ORDER BY user, host
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list users: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let lifetime: Option<i32> = r.try_get(7).unwrap_or(None);
            DatabaseUser {
                name: get_str(r, 0),
                host: Some(get_str(r, 1)),
                is_superuser: get_str(r, 2) == "Y",
                can_login: get_str(r, 6) != "Y", // account_locked = Y means cannot login
                can_create_db: get_str(r, 4) == "Y",
                can_create_role: get_str(r, 3) == "Y",
                is_replication: get_str(r, 5) == "Y",
                valid_until: lifetime.map(|l| format!("{} days", l)),
                member_of: vec![],
                config: vec![],
            }
        })
        .collect())
}

pub async fn get_user_grants(
    pool: &sqlx::MySqlPool,
    username: &str,
    host: Option<&str>,
) -> Result<Vec<UserGrant>, String> {
    let mut grants = Vec::new();
    let host = host.unwrap_or("%");

    // Global privileges
    // SELECT privilege_type(0), is_grantable(1)
    let global_rows = sqlx::query(
        r#"
        SELECT privilege_type, is_grantable
        FROM information_schema.user_privileges
        WHERE grantee = CONCAT('''', ?, '''@''', ?, '''')
        ORDER BY privilege_type
        "#,
    )
    .bind(username)
    .bind(host)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get global grants: {}", e))?;

    for row in &global_rows {
        grants.push(UserGrant {
            grantee: username.to_string(),
            grantor: None,
            privilege: get_str(row, 0),
            object_type: "server".to_string(),
            object_catalog: None,
            object_schema: None,
            object_name: None,
            column_name: None,
            is_grantable: get_str(row, 1) == "YES",
            inherited_from: None,
        });
    }

    // Schema-level privileges
    // SELECT table_schema(0), privilege_type(1), is_grantable(2)
    let schema_rows = sqlx::query(
        r#"
        SELECT table_schema, privilege_type, is_grantable
        FROM information_schema.schema_privileges
        WHERE grantee = CONCAT('''', ?, '''@''', ?, '''')
        ORDER BY table_schema, privilege_type
        "#,
    )
    .bind(username)
    .bind(host)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get schema grants: {}", e))?;

    for row in &schema_rows {
        grants.push(UserGrant {
            grantee: username.to_string(),
            grantor: None,
            privilege: get_str(row, 1),
            object_type: "database".to_string(),
            object_catalog: Some(get_str(row, 0)),
            object_schema: Some(get_str(row, 0)),
            object_name: Some(get_str(row, 0)),
            column_name: None,
            is_grantable: get_str(row, 2) == "YES",
            inherited_from: None,
        });
    }

    // Table-level privileges
    // SELECT table_schema(0), table_name(1), privilege_type(2), is_grantable(3)
    let table_rows = sqlx::query(
        r#"
        SELECT table_schema, table_name, privilege_type, is_grantable
        FROM information_schema.table_privileges
        WHERE grantee = CONCAT('''', ?, '''@''', ?, '''')
        ORDER BY table_schema, table_name, privilege_type
        "#,
    )
    .bind(username)
    .bind(host)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get table grants: {}", e))?;

    for row in &table_rows {
        grants.push(UserGrant {
            grantee: username.to_string(),
            grantor: None,
            privilege: get_str(row, 2),
            object_type: "table".to_string(),
            object_catalog: Some(get_str(row, 0)),
            object_schema: Some(get_str(row, 0)),
            object_name: Some(get_str(row, 1)),
            column_name: None,
            is_grantable: get_str(row, 3) == "YES",
            inherited_from: None,
        });
    }

    // Column-level privileges
    // SELECT table_schema(0), table_name(1), column_name(2), privilege_type(3), is_grantable(4)
    let col_rows = sqlx::query(
        r#"
        SELECT table_schema, table_name, column_name, privilege_type, is_grantable
        FROM information_schema.column_privileges
        WHERE grantee = CONCAT('''', ?, '''@''', ?, '''')
        ORDER BY table_schema, table_name, column_name, privilege_type
        "#,
    )
    .bind(username)
    .bind(host)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get column grants: {}", e))?;

    for row in &col_rows {
        grants.push(UserGrant {
            grantee: username.to_string(),
            grantor: None,
            privilege: get_str(row, 3),
            object_type: "column".to_string(),
            object_catalog: Some(get_str(row, 0)),
            object_schema: Some(get_str(row, 0)),
            object_name: Some(get_str(row, 1)),
            column_name: Some(get_str(row, 2)),
            is_grantable: get_str(row, 4) == "YES",
            inherited_from: None,
        });
    }

    Ok(grants)
}
