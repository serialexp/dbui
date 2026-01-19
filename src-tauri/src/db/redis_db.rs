// ABOUTME: Redis database operations for connection and command execution.
// ABOUTME: Handles Redis-specific logic including command parsing and response formatting.

use super::{ColumnInfo, ConstraintInfo, FunctionInfo, IndexInfo, QueryResult};
use redis::aio::ConnectionManager;
use redis::{RedisResult, Value};

pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<ConnectionManager, String> {
    let url = build_connection_url(host, port, username, password);
    let client =
        redis::Client::open(url).map_err(|e| format!("Failed to create Redis client: {}", e))?;
    let manager = ConnectionManager::new(client)
        .await
        .map_err(|e| format!("Failed to connect to Redis: {}", e))?;
    Ok(manager)
}

fn build_connection_url(host: &str, port: u16, username: &str, password: &str) -> String {
    match (username.is_empty(), password.is_empty()) {
        (true, true) => format!("redis://{}:{}", host, port),
        (true, false) => format!("redis://:{}@{}:{}", password, host, port),
        (false, _) => format!("redis://{}:{}@{}:{}", username, password, host, port),
    }
}

pub async fn list_databases(_conn: &mut ConnectionManager) -> Result<Vec<String>, String> {
    Ok((0..16).map(|i| i.to_string()).collect())
}

pub async fn list_schemas(
    _conn: &mut ConnectionManager,
    _database: &str,
) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn list_tables(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn list_views(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn list_functions(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn get_function_definition(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
    _function_name: &str,
) -> Result<FunctionInfo, String> {
    Err("Redis does not support functions in the traditional sense".to_string())
}

pub async fn list_columns(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
    _table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    Ok(vec![])
}

pub async fn list_indexes(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
    _table: &str,
) -> Result<Vec<IndexInfo>, String> {
    Ok(vec![])
}

pub async fn list_constraints(
    _conn: &mut ConnectionManager,
    _database: &str,
    _schema: &str,
    _table: &str,
) -> Result<Vec<ConstraintInfo>, String> {
    Ok(vec![])
}

async fn browse_keys(conn: &mut ConnectionManager, args: &[&str]) -> Result<QueryResult, String> {
    // Parse arguments: BROWSE [cursor] [COUNT n] [MATCH pattern] [TYPE type]
    let mut cursor: i64 = 0;
    let mut count: i64 = 100;
    let mut pattern: Option<&str> = None;
    let mut type_filter: Option<&str> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].to_uppercase().as_str() {
            "COUNT" if i + 1 < args.len() => {
                count = args[i + 1].parse().unwrap_or(100);
                i += 2;
            }
            "MATCH" if i + 1 < args.len() => {
                pattern = Some(args[i + 1]);
                i += 2;
            }
            "TYPE" if i + 1 < args.len() => {
                type_filter = Some(args[i + 1]);
                i += 2;
            }
            _ => {
                // First non-keyword argument is the cursor
                if i == 0 {
                    cursor = args[i].parse().unwrap_or(0);
                }
                i += 1;
            }
        }
    }

    // Build SCAN command
    let mut cmd = redis::cmd("SCAN");
    cmd.arg(cursor);
    cmd.arg("COUNT").arg(count);
    if let Some(p) = pattern {
        cmd.arg("MATCH").arg(p);
    }
    if let Some(t) = type_filter {
        cmd.arg("TYPE").arg(t);
    }

    let result: RedisResult<Value> = cmd.query_async(conn).await;

    match result {
        Ok(Value::Array(arr)) if arr.len() == 2 => {
            let next_cursor = match &arr[0] {
                Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
                Value::Int(i) => i.to_string(),
                _ => "0".to_string(),
            };

            let keys = match &arr[1] {
                Value::Array(keys) => keys,
                _ => return Err("Invalid SCAN response".to_string()),
            };

            // Get type for each key
            let mut rows = Vec::new();
            for key in keys {
                let key_str = match key {
                    Value::BulkString(b) => String::from_utf8_lossy(b).to_string(),
                    _ => continue,
                };

                let type_result: RedisResult<String> = redis::cmd("TYPE")
                    .arg(&key_str)
                    .query_async(conn)
                    .await;

                let key_type = type_result.unwrap_or_else(|_| "unknown".to_string());

                rows.push(vec![
                    serde_json::Value::String(key_str),
                    serde_json::Value::String(key_type),
                ]);
            }

            let row_count = rows.len();
            let message = if next_cursor == "0" {
                Some("Scan complete".to_string())
            } else {
                Some(format!("Next cursor: {} (run BROWSE {} to continue)", next_cursor, next_cursor))
            };

            Ok(QueryResult {
                columns: vec!["key".to_string(), "type".to_string()],
                rows,
                row_count,
                message,
            })
        }
        Ok(_) => Err("Invalid SCAN response format".to_string()),
        Err(e) => Err(format!("Redis error: {}", e)),
    }
}

pub async fn execute_query(
    conn: &mut ConnectionManager,
    query: &str,
) -> Result<QueryResult, String> {
    // Strip trailing semicolons - Redis doesn't use them
    let trimmed = query.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("Empty command".to_string()),
        });
    }

    let parts = parse_command(trimmed);
    if parts.is_empty() {
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("Empty command".to_string()),
        });
    }

    let cmd_name = parts[0].to_uppercase();
    let args: Vec<&str> = parts[1..].iter().map(|s| s.as_str()).collect();

    // Handle SELECT command specially to switch databases
    if cmd_name == "SELECT" && args.len() == 1 {
        if let Ok(db_index) = args[0].parse::<i64>() {
            let result: RedisResult<Value> = redis::cmd("SELECT")
                .arg(db_index)
                .query_async(conn)
                .await;
            return match result {
                Ok(_) => Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    row_count: 0,
                    message: Some(format!("Switched to database {}", db_index)),
                }),
                Err(e) => Err(format!("Redis error: {}", e)),
            };
        }
    }

    // Handle BROWSE command - SCAN with TYPE info for each key
    // Usage: BROWSE [cursor] [COUNT n] [MATCH pattern] [TYPE type]
    if cmd_name == "BROWSE" {
        return browse_keys(conn, &args).await;
    }

    // Build and execute the command
    let mut cmd = redis::cmd(&cmd_name);
    for arg in &args {
        cmd.arg(*arg);
    }

    let result: RedisResult<Value> = cmd.query_async(conn).await;

    match result {
        Ok(value) => Ok(format_redis_value(&value, &cmd_name)),
        Err(e) => Err(format!("Redis error: {}", e)),
    }
}

fn parse_command(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = ' ';
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == quote_char {
                in_quotes = false;
            } else if c == '\\' {
                if let Some(&next) = chars.peek() {
                    chars.next();
                    match next {
                        'n' => current.push('\n'),
                        't' => current.push('\t'),
                        'r' => current.push('\r'),
                        _ => current.push(next),
                    }
                }
            } else {
                current.push(c);
            }
        } else if c == '"' || c == '\'' {
            in_quotes = true;
            quote_char = c;
        } else if c.is_whitespace() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
        } else {
            current.push(c);
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn format_redis_value(value: &Value, cmd_name: &str) -> QueryResult {
    match value {
        Value::Nil => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::Null]],
            row_count: 1,
            message: None,
        },
        Value::Int(i) => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::Number((*i).into())]],
            row_count: 1,
            message: None,
        },
        Value::BulkString(bytes) => {
            let s = String::from_utf8_lossy(bytes).to_string();
            QueryResult {
                columns: vec!["value".to_string()],
                rows: vec![vec![serde_json::Value::String(s)]],
                row_count: 1,
                message: None,
            }
        }
        Value::Array(arr) => format_array_value(arr, cmd_name),
        Value::SimpleString(s) => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::String(s.clone())]],
            row_count: 1,
            message: None,
        },
        Value::Okay => QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some("OK".to_string()),
        },
        Value::Map(pairs) => {
            let rows: Vec<Vec<serde_json::Value>> = pairs
                .iter()
                .map(|(k, v)| {
                    vec![
                        value_to_json(k),
                        value_to_json(v),
                    ]
                })
                .collect();
            let row_count = rows.len();
            QueryResult {
                columns: vec!["field".to_string(), "value".to_string()],
                rows,
                row_count,
                message: None,
            }
        }
        Value::Set(items) => {
            let rows: Vec<Vec<serde_json::Value>> = items
                .iter()
                .map(|v| vec![value_to_json(v)])
                .collect();
            let row_count = rows.len();
            QueryResult {
                columns: vec!["member".to_string()],
                rows,
                row_count,
                message: None,
            }
        }
        Value::Double(d) => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Number::from_f64(*d)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null)]],
            row_count: 1,
            message: None,
        },
        Value::Boolean(b) => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::Bool(*b)]],
            row_count: 1,
            message: None,
        },
        Value::VerbatimString { format: _, text } => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::String(text.clone())]],
            row_count: 1,
            message: None,
        },
        Value::BigNumber(n) => QueryResult {
            columns: vec!["value".to_string()],
            rows: vec![vec![serde_json::Value::String(n.to_string())]],
            row_count: 1,
            message: None,
        },
        Value::Push { kind: _, data } => format_array_value(data, cmd_name),
        Value::Attribute { data, attributes: _ } => format_redis_value(data, cmd_name),
        Value::ServerError(err) => QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            message: Some(format!("Server error: {:?}", err)),
        },
    }
}

fn format_array_value(arr: &[Value], cmd_name: &str) -> QueryResult {
    let upper_cmd = cmd_name.to_uppercase();

    // HGETALL returns alternating field/value pairs
    if upper_cmd == "HGETALL" || upper_cmd == "HSCAN" {
        let mut rows = Vec::new();
        let mut i = 0;
        while i + 1 < arr.len() {
            rows.push(vec![
                value_to_json(&arr[i]),
                value_to_json(&arr[i + 1]),
            ]);
            i += 2;
        }
        let row_count = rows.len();
        return QueryResult {
            columns: vec!["field".to_string(), "value".to_string()],
            rows,
            row_count,
            message: None,
        };
    }

    // SMEMBERS, SINTER, SUNION, SDIFF - set operations
    if upper_cmd.starts_with('S')
        && (upper_cmd == "SMEMBERS"
            || upper_cmd == "SINTER"
            || upper_cmd == "SUNION"
            || upper_cmd == "SDIFF")
    {
        let rows: Vec<Vec<serde_json::Value>> =
            arr.iter().map(|v| vec![value_to_json(v)]).collect();
        let row_count = rows.len();
        return QueryResult {
            columns: vec!["member".to_string()],
            rows,
            row_count,
            message: None,
        };
    }

    // ZRANGE, ZRANGEBYSCORE with WITHSCORES
    if upper_cmd.starts_with('Z') {
        // Check if it looks like score pairs
        let has_scores = arr.len() % 2 == 0
            && arr.iter().enumerate().all(|(i, v)| {
                if i % 2 == 1 {
                    matches!(v, Value::BulkString(_) | Value::Double(_))
                } else {
                    true
                }
            });

        if has_scores && arr.len() > 0 {
            let mut rows = Vec::new();
            let mut i = 0;
            while i + 1 < arr.len() {
                rows.push(vec![
                    value_to_json(&arr[i]),
                    value_to_json(&arr[i + 1]),
                ]);
                i += 2;
            }
            if !rows.is_empty() {
                let row_count = rows.len();
                return QueryResult {
                    columns: vec!["member".to_string(), "score".to_string()],
                    rows,
                    row_count,
                    message: None,
                };
            }
        }
    }

    // SCAN returns [cursor, [keys...]]
    if upper_cmd == "SCAN" && arr.len() == 2 {
        if let Value::Array(keys) = &arr[1] {
            let rows: Vec<Vec<serde_json::Value>> =
                keys.iter().map(|v| vec![value_to_json(v)]).collect();
            let row_count = rows.len();
            return QueryResult {
                columns: vec!["key".to_string()],
                rows,
                row_count,
                message: Some(format!("Cursor: {}", value_to_string(&arr[0]))),
            };
        }
    }

    // Default: index + value columns
    let rows: Vec<Vec<serde_json::Value>> = arr
        .iter()
        .enumerate()
        .map(|(i, v)| {
            vec![
                serde_json::Value::Number(i.into()),
                value_to_json(v),
            ]
        })
        .collect();
    let row_count = rows.len();
    QueryResult {
        columns: vec!["index".to_string(), "value".to_string()],
        rows,
        row_count,
        message: None,
    }
}

fn value_to_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Nil => serde_json::Value::Null,
        Value::Int(i) => serde_json::Value::Number((*i).into()),
        Value::BulkString(bytes) => {
            serde_json::Value::String(String::from_utf8_lossy(bytes).to_string())
        }
        Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(value_to_json).collect())
        }
        Value::SimpleString(s) => serde_json::Value::String(s.clone()),
        Value::Okay => serde_json::Value::String("OK".to_string()),
        Value::Map(pairs) => {
            let obj: serde_json::Map<String, serde_json::Value> = pairs
                .iter()
                .map(|(k, v)| (value_to_string(k), value_to_json(v)))
                .collect();
            serde_json::Value::Object(obj)
        }
        Value::Set(items) => {
            serde_json::Value::Array(items.iter().map(value_to_json).collect())
        }
        Value::Double(d) => serde_json::Number::from_f64(*d)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Boolean(b) => serde_json::Value::Bool(*b),
        Value::VerbatimString { format: _, text } => serde_json::Value::String(text.clone()),
        Value::BigNumber(n) => serde_json::Value::String(n.to_string()),
        Value::Push { kind: _, data } => {
            serde_json::Value::Array(data.iter().map(value_to_json).collect())
        }
        Value::Attribute { data, attributes: _ } => value_to_json(data),
        Value::ServerError(err) => serde_json::Value::String(format!("Error: {:?}", err)),
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::BulkString(bytes) => String::from_utf8_lossy(bytes).to_string(),
        Value::SimpleString(s) => s.clone(),
        Value::Int(i) => i.to_string(),
        Value::Double(d) => d.to_string(),
        _ => format!("{:?}", value),
    }
}

pub async fn switch_database(conn: &mut ConnectionManager, database: &str) -> Result<(), String> {
    let db_index: i64 = database
        .parse()
        .map_err(|_| format!("Invalid database index: {}", database))?;

    let _: () = redis::cmd("SELECT")
        .arg(db_index)
        .query_async(conn)
        .await
        .map_err(|e| format!("Failed to switch database: {}", e))?;

    Ok(())
}
