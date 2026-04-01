// ABOUTME: SQL query analyzer using sqlparser-rs.
// ABOUTME: Extracts table information from queries to determine if delete checkboxes should be shown.

use sqlparser::ast::{SetExpr, Statement, TableFactor};
use sqlparser::dialect::{GenericDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect};
use sqlparser::parser::Parser;

/// Result of analyzing a SQL query for its target table.
#[derive(Debug, Clone, serde::Serialize)]
pub struct QueryTableInfo {
    pub schema: Option<String>,
    pub table: String,
}

/// Attempt to extract a single table from a SQL query.
/// Returns Some only if the query is a SELECT from exactly one real table
/// (no joins, subqueries, CTEs, or UNIONs).
pub fn extract_single_table(sql: &str, db_type: &str) -> Option<QueryTableInfo> {
    let dialect: Box<dyn sqlparser::dialect::Dialect> = match db_type {
        "postgres" => Box::new(PostgreSqlDialect {}),
        "mysql" => Box::new(MySqlDialect {}),
        "sqlite" => Box::new(SQLiteDialect {}),
        _ => Box::new(GenericDialect {}),
    };

    let statements = Parser::parse_sql(dialect.as_ref(), sql).ok()?;

    // Must be exactly one statement
    if statements.len() != 1 {
        return None;
    }

    let stmt = &statements[0];
    match stmt {
        Statement::Query(query) => {
            // No CTEs allowed
            if !query.with.is_none() {
                return None;
            }

            let select = match query.body.as_ref() {
                SetExpr::Select(s) => s,
                _ => return None, // UNION, INTERSECT, etc.
            };

            // Exactly one FROM table, no joins
            if select.from.len() != 1 {
                return None;
            }

            let from = &select.from[0];

            // No joins
            if !from.joins.is_empty() {
                return None;
            }

            // Must be a plain table reference
            match &from.relation {
                TableFactor::Table { name, alias: _, .. } => {
                    let parts: Vec<String> = name
                        .0
                        .iter()
                        .filter_map(|part| part.as_ident().map(|id| id.value.clone()))
                        .collect();
                    if parts.len() != name.0.len() {
                        return None; // Contains non-identifier parts
                    }

                    match parts.len() {
                        1 => Some(QueryTableInfo {
                            schema: None,
                            table: parts[0].clone(),
                        }),
                        2 => Some(QueryTableInfo {
                            schema: Some(parts[0].clone()),
                            table: parts[1].clone(),
                        }),
                        3 => {
                            // database.schema.table — use schema.table
                            Some(QueryTableInfo {
                                schema: Some(parts[1].clone()),
                                table: parts[2].clone(),
                            })
                        }
                        _ => None,
                    }
                }
                _ => None, // Subquery, derived table, etc.
            }
        }
        _ => None, // INSERT, UPDATE, DELETE, etc.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_select() {
        let result = extract_single_table("SELECT * FROM users LIMIT 100", "postgres");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.table, "users");
        assert_eq!(info.schema, None);
    }

    #[test]
    fn schema_qualified() {
        let result =
            extract_single_table("SELECT * FROM public.users LIMIT 100", "postgres");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.table, "users");
        assert_eq!(info.schema, Some("public".to_string()));
    }

    #[test]
    fn with_where_clause() {
        let result = extract_single_table(
            "SELECT id, name FROM public.users WHERE active = true ORDER BY name LIMIT 50",
            "postgres",
        );
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.table, "users");
        assert_eq!(info.schema, Some("public".to_string()));
    }

    #[test]
    fn join_returns_none() {
        let result = extract_single_table(
            "SELECT u.*, o.id FROM users u JOIN orders o ON u.id = o.user_id",
            "postgres",
        );
        assert!(result.is_none());
    }

    #[test]
    fn union_returns_none() {
        let result = extract_single_table(
            "SELECT * FROM users UNION SELECT * FROM admins",
            "postgres",
        );
        assert!(result.is_none());
    }

    #[test]
    fn subquery_returns_none() {
        let result = extract_single_table(
            "SELECT * FROM (SELECT * FROM users) sub",
            "postgres",
        );
        assert!(result.is_none());
    }

    #[test]
    fn cte_returns_none() {
        let result = extract_single_table(
            "WITH active AS (SELECT * FROM users WHERE active) SELECT * FROM active",
            "postgres",
        );
        assert!(result.is_none());
    }

    #[test]
    fn insert_returns_none() {
        let result =
            extract_single_table("INSERT INTO users (name) VALUES ('test')", "postgres");
        assert!(result.is_none());
    }

    #[test]
    fn mysql_backticks() {
        let result =
            extract_single_table("SELECT * FROM `my_table` LIMIT 10", "mysql");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.table, "my_table");
    }

    #[test]
    fn multiple_statements_returns_none() {
        let result = extract_single_table(
            "SELECT * FROM users; SELECT * FROM orders;",
            "postgres",
        );
        assert!(result.is_none());
    }
}
