// ABOUTME: PostgreSQL-specific database introspection queries.
// ABOUTME: Provides schema, table, column, index, and constraint information.

use super::{ColumnInfo, ConstraintInfo, DatabaseUser, FunctionInfo, IndexInfo, UserGrant};
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

pub async fn get_view_definition(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
    view_name: &str,
) -> Result<super::FunctionInfo, String> {
    let row = sqlx::query(
        "SELECT pg_get_viewdef(c.oid, true) as definition
         FROM pg_class c
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = $1 AND c.relname = $2
           AND c.relkind IN ('v', 'm')",
    )
    .bind(schema)
    .bind(view_name)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to get view definition: {}", e))?;

    let definition: String = row.get("definition");

    Ok(super::FunctionInfo {
        name: view_name.to_string(),
        definition: format!("CREATE OR REPLACE VIEW {}.{} AS\n{}", schema, view_name, definition),
        return_type: None,
        language: Some("SQL".to_string()),
    })
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

pub async fn list_materialized_views(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT matviewname FROM pg_matviews
         WHERE schemaname = $1
         ORDER BY matviewname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list materialized views: {}", e))?;

    Ok(rows.iter().map(|r| r.get("matviewname")).collect())
}

pub async fn list_sequences(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT sequence_name FROM information_schema.sequences
         WHERE sequence_schema = $1
         ORDER BY sequence_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list sequences: {}", e))?;

    Ok(rows.iter().map(|r| r.get("sequence_name")).collect())
}

pub async fn list_triggers(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT DISTINCT trigger_name FROM information_schema.triggers
         WHERE trigger_schema = $1
         ORDER BY trigger_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list triggers: {}", e))?;

    Ok(rows.iter().map(|r| r.get("trigger_name")).collect())
}

pub async fn list_procedures(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    let rows = sqlx::query(
        "SELECT routine_name FROM information_schema.routines
         WHERE routine_schema = $1 AND routine_type = 'PROCEDURE'
         ORDER BY routine_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list procedures: {}", e))?;

    Ok(rows.iter().map(|r| r.get("routine_name")).collect())
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
            c.character_maximum_length,
            c.numeric_precision,
            c.numeric_scale,
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
        .map(|r| {
            let base_type: String = r.get("data_type");
            let char_max_len: Option<i32> = r.get("character_maximum_length");
            let num_precision: Option<i32> = r.get("numeric_precision");
            let num_scale: Option<i32> = r.get("numeric_scale");

            let data_type = if let Some(len) = char_max_len {
                format!("{}({})", base_type, len)
            } else if base_type == "numeric" || base_type == "decimal" {
                match (num_precision, num_scale) {
                    (Some(p), Some(s)) if s > 0 => format!("{}({},{})", base_type, p, s),
                    (Some(p), _) => format!("{}({})", base_type, p),
                    _ => base_type,
                }
            } else {
                base_type
            };

            ColumnInfo {
                name: r.get("column_name"),
                data_type,
                is_nullable: r.get::<String, _>("is_nullable") == "YES",
                column_default: r.get("column_default"),
                is_primary_key: r.get("is_primary_key"),
            }
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

pub async fn create_database(pool: &sqlx::PgPool, name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('"') || name.contains('\0') {
        return Err("Invalid database name".to_string());
    }
    let query = format!("CREATE DATABASE \"{}\"", name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create database: {}", e))?;
    Ok(())
}

pub async fn create_schema(pool: &sqlx::PgPool, name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('"') || name.contains('\0') {
        return Err("Invalid schema name".to_string());
    }
    let query = format!("CREATE SCHEMA \"{}\"", name);
    sqlx::query(&query)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create schema: {}", e))?;
    Ok(())
}

pub async fn get_view_dependencies(
    pool: &sqlx::PgPool,
    _database: &str,
    schema: &str,
) -> Result<Vec<super::ViewDependency>, String> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT
            dependent_view.relname AS view_name,
            source_table.relname AS depends_on,
            CASE source_table.relkind
                WHEN 'r' THEN 'table'
                WHEN 'v' THEN 'view'
                WHEN 'm' THEN 'materialized_view'
            END AS depends_on_type
        FROM pg_depend
        JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
        JOIN pg_class AS dependent_view ON pg_rewrite.ev_class = dependent_view.oid
        JOIN pg_class AS source_table ON pg_depend.refobjid = source_table.oid
        JOIN pg_namespace AS dependent_ns ON dependent_view.relnamespace = dependent_ns.oid
        JOIN pg_namespace AS source_ns ON source_table.relnamespace = source_ns.oid
        WHERE dependent_ns.nspname = $1
          AND source_ns.nspname = $1
          AND source_table.relname != dependent_view.relname
          AND source_table.relkind IN ('r', 'v', 'm')
        ORDER BY view_name, depends_on
        "#,
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get view dependencies: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| super::ViewDependency {
            view_name: r.get("view_name"),
            depends_on: r.get("depends_on"),
            depends_on_type: r.get("depends_on_type"),
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

pub async fn list_users(pool: &sqlx::PgPool) -> Result<Vec<DatabaseUser>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            r.rolname,
            r.rolsuper,
            r.rolcreaterole,
            r.rolcreatedb,
            r.rolcanlogin,
            r.rolreplication,
            r.rolvaliduntil::TEXT as rolvaliduntil,
            COALESCE(
                ARRAY(SELECT b.rolname FROM pg_catalog.pg_auth_members m
                      JOIN pg_catalog.pg_roles b ON m.roleid = b.oid
                      WHERE m.member = r.oid),
                ARRAY[]::TEXT[]
            ) as member_of,
            COALESCE(r.rolconfig, ARRAY[]::TEXT[]) as config
        FROM pg_catalog.pg_roles r
        ORDER BY r.rolname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list users: {}", e))?;

    Ok(rows
        .iter()
        .map(|r| {
            let valid_until: Option<String> = r.get("rolvaliduntil");
            DatabaseUser {
                name: r.get("rolname"),
                host: None,
                is_superuser: r.get("rolsuper"),
                can_login: r.get("rolcanlogin"),
                can_create_db: r.get("rolcreatedb"),
                can_create_role: r.get("rolcreaterole"),
                is_replication: r.get("rolreplication"),
                valid_until: valid_until.filter(|v| v != ""),
                member_of: r.get("member_of"),
                config: r.get("config"),
            }
        })
        .collect())
}

pub async fn get_user_grants(
    pool: &sqlx::PgPool,
    username: &str,
) -> Result<Vec<UserGrant>, String> {
    // Resolve transitive role membership: walk pg_auth_members recursively
    let membership_rows = sqlx::query(
        r#"
        WITH RECURSIVE membership AS (
            SELECT m.member, m.roleid, r.rolname as role_name, mr.rolname as member_name
            FROM pg_auth_members m
            JOIN pg_roles r ON m.roleid = r.oid
            JOIN pg_roles mr ON m.member = mr.oid
            WHERE mr.rolname = $1
            UNION
            SELECT m.member, m.roleid, r.rolname as role_name, prev.role_name as member_name
            FROM pg_auth_members m
            JOIN pg_roles r ON m.roleid = r.oid
            JOIN membership prev ON m.member = (SELECT oid FROM pg_roles WHERE rolname = prev.role_name)
        )
        SELECT DISTINCT role_name FROM membership
        "#,
    )
    .bind(username)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to resolve role membership: {}", e))?;

    let mut inherited_roles: Vec<String> = membership_rows
        .iter()
        .map(|r| r.get("role_name"))
        .collect();

    // All roles to query grants for: the user itself + all inherited roles
    let all_roles: Vec<String> = {
        let mut v = vec![username.to_string()];
        v.append(&mut inherited_roles.clone());
        v
    };

    let mut grants = Vec::new();

    // Database-level privileges (has_*_privilege already resolves membership)
    let db_rows = sqlx::query(
        r#"
        SELECT datname,
               has_database_privilege($1, datname, 'CONNECT') as can_connect,
               has_database_privilege($1, datname, 'CREATE') as can_create,
               has_database_privilege($1, datname, 'TEMPORARY') as can_temp
        FROM pg_database
        WHERE datistemplate = false
        ORDER BY datname
        "#,
    )
    .bind(username)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get database grants: {}", e))?;

    for row in &db_rows {
        let datname: String = row.get("datname");
        for (priv_name, col) in [
            ("CONNECT", "can_connect"),
            ("CREATE", "can_create"),
            ("TEMPORARY", "can_temp"),
        ] {
            let has: bool = row.get(col);
            if has {
                grants.push(UserGrant {
                    grantee: username.to_string(),
                    grantor: None,
                    privilege: priv_name.to_string(),
                    object_type: "database".to_string(),
                    object_catalog: Some(datname.clone()),
                    object_schema: None,
                    object_name: Some(datname.clone()),
                    column_name: None,
                    is_grantable: false,
                    inherited_from: None,
                });
            }
        }
    }

    // Schema-level privileges (has_*_privilege already resolves membership)
    let schema_rows = sqlx::query(
        r#"
        SELECT nspname,
               has_schema_privilege($1, nspname, 'USAGE') as has_usage,
               has_schema_privilege($1, nspname, 'CREATE') as has_create
        FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_temp%'
          AND nspname NOT LIKE 'pg_toast%'
        ORDER BY nspname
        "#,
    )
    .bind(username)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to get schema grants: {}", e))?;

    for row in &schema_rows {
        let nspname: String = row.get("nspname");
        for (priv_name, col) in [("USAGE", "has_usage"), ("CREATE", "has_create")] {
            let has: bool = row.get(col);
            if has {
                grants.push(UserGrant {
                    grantee: username.to_string(),
                    grantor: None,
                    privilege: priv_name.to_string(),
                    object_type: "schema".to_string(),
                    object_catalog: None,
                    object_schema: Some(nspname.clone()),
                    object_name: Some(nspname.clone()),
                    column_name: None,
                    is_grantable: false,
                    inherited_from: None,
                });
            }
        }
    }

    // Table-level and column-level privileges: query for the user AND all inherited roles
    for role in &all_roles {
        let inherited_from = if role == username {
            None
        } else {
            Some(role.clone())
        };

        // Table-level privileges
        let table_rows = sqlx::query(
            r#"
            SELECT
                grantor,
                privilege_type,
                table_catalog,
                table_schema,
                table_name,
                is_grantable
            FROM information_schema.role_table_grants
            WHERE grantee = $1
            ORDER BY table_schema, table_name, privilege_type
            "#,
        )
        .bind(role)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to get table grants: {}", e))?;

        for row in &table_rows {
            grants.push(UserGrant {
                grantee: username.to_string(),
                grantor: row.get("grantor"),
                privilege: row.get("privilege_type"),
                object_type: "table".to_string(),
                object_catalog: row.get("table_catalog"),
                object_schema: row.get("table_schema"),
                object_name: row.get("table_name"),
                column_name: None,
                is_grantable: row.get::<String, _>("is_grantable") == "YES",
                inherited_from: inherited_from.clone(),
            });
        }

        // Column-level privileges
        let col_rows = sqlx::query(
            r#"
            SELECT
                grantor,
                privilege_type,
                table_catalog,
                table_schema,
                table_name,
                column_name,
                is_grantable
            FROM information_schema.role_column_grants
            WHERE grantee = $1
            ORDER BY table_schema, table_name, column_name, privilege_type
            "#,
        )
        .bind(role)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed to get column grants: {}", e))?;

        for row in &col_rows {
            grants.push(UserGrant {
                grantee: username.to_string(),
                grantor: row.get("grantor"),
                privilege: row.get("privilege_type"),
                object_type: "column".to_string(),
                object_catalog: row.get("table_catalog"),
                object_schema: row.get("table_schema"),
                object_name: row.get("table_name"),
                column_name: row.get("column_name"),
                is_grantable: row.get::<String, _>("is_grantable") == "YES",
                inherited_from: inherited_from.clone(),
            });
        }
    }

    // Deduplicate: if the same privilege on the same object exists both directly and inherited,
    // keep only the direct one
    let mut seen = std::collections::HashSet::new();
    grants.sort_by_key(|g| g.inherited_from.is_some()); // direct first
    grants.retain(|g| {
        let key = (
            g.privilege.clone(),
            g.object_type.clone(),
            g.object_schema.clone(),
            g.object_name.clone(),
            g.column_name.clone(),
        );
        seen.insert(key)
    });

    Ok(grants)
}
