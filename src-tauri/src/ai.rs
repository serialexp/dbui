// ABOUTME: Natural-language → SQL generation backed by a local Ollama service.
// ABOUTME: Uses an agentic tool-calling loop so the model pulls only the schema it needs.

use crate::db::{ColumnInfo, ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Max chat round-trips before we give up, so a misbehaving model can't loop forever.
const MAX_ITERATIONS: usize = 8;

/// A generated SQL suggestion plus the model's reasoning for it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSuggestion {
    pub sql: String,
    pub motivation: String,
}

/// Format one table's columns as DDL-like text, e.g.
/// `TABLE users (\n  id int PRIMARY KEY NOT NULL,\n  email text NOT NULL\n);`
/// Build a schema-qualified, properly-quoted table identifier for the given
/// database engine, e.g. Postgres `"public"."users"`, MySQL `` `shop`.`users` ``.
/// SQLite has no real schema namespace, so the bare table name is returned.
fn qualified_name(db_type: &str, schema: &str, table: &str) -> String {
    match db_type.to_lowercase().as_str() {
        "postgres" | "postgresql" => format!("\"{}\".\"{}\"", schema, table),
        "mysql" | "mariadb" => format!("`{}`.`{}`", schema, table),
        "sqlite" => format!("\"{}\"", table),
        _ => format!("{}.{}", schema, table),
    }
}

fn format_table_ddl(db_type: &str, schema: &str, table: &str, columns: &[ColumnInfo]) -> String {
    let col_lines: Vec<String> = columns
        .iter()
        .map(|c| {
            let mut line = format!("  {} {}", c.name, c.data_type);
            if c.is_primary_key {
                line.push_str(" PRIMARY KEY");
            }
            if !c.is_nullable {
                line.push_str(" NOT NULL");
            }
            line
        })
        .collect();
    format!(
        "TABLE {} (\n{}\n);",
        qualified_name(db_type, schema, table),
        col_lines.join(",\n")
    )
}

/// Strip surrounding markdown code fences (```sql ... ```) and whitespace.
fn strip_fences(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Drop an optional language tag on the first line (e.g. "sql").
        let after_lang = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        let body = after_lang.strip_suffix("```").unwrap_or(after_lang);
        return body.trim().to_string();
    }
    trimmed.to_string()
}

const SQL_KEYWORDS: [&str; 7] = [
    "select", "with", "insert", "update", "delete", "create", "alter",
];

/// Byte index where the SQL portion of a prose answer begins: the first code
/// fence, else the first line starting with a SQL keyword.
fn sql_start_index(text: &str) -> Option<usize> {
    if let Some(i) = text.find("```") {
        return Some(i);
    }
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start().to_lowercase();
        if SQL_KEYWORDS.iter().any(|k| trimmed.starts_with(k)) {
            return Some(offset + (line.len() - line.trim_start().len()));
        }
        offset += line.len();
    }
    None
}

/// Some models narrate the answer (prose + a ```sql block) instead of calling
/// propose_query. Recover an `{sql, motivation}` from that free text.
fn suggestion_from_text(text: &str) -> Option<SqlSuggestion> {
    let start = sql_start_index(text)?;
    let sql = strip_fences(text[start..].trim());
    // Drop anything after a closing fence that strip_fences didn't catch.
    let sql = sql.split("```").next().unwrap_or("").trim().to_string();
    if sql.is_empty() {
        return None;
    }
    let motivation = text[..start].trim().to_string();
    Some(SqlSuggestion { sql, motivation })
}

/// Tool-call arguments arrive as a JSON object, but small models sometimes send
/// the whole arguments blob as a JSON-encoded string. Normalize to an object.
fn args_as_object(arguments: &Value) -> serde_json::Map<String, Value> {
    match arguments {
        Value::Object(map) => map.clone(),
        Value::String(s) => serde_json::from_str::<Value>(s.trim())
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        _ => serde_json::Map::new(),
    }
}

/// Pull a string field from a tool-call argument map, tolerating that the value
/// itself may be wrapped (e.g. a number coerced to text upstream).
fn get_string_arg(obj: &serde_json::Map<String, Value>, key: &str) -> String {
    match obj.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

/// Parse a value that should be a list of strings, tolerating the llama quirk of
/// returning the array as a JSON-encoded string, or a single comma-joined string.
fn clean_name(s: &str) -> String {
    s.trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == '[' || c == ']')
        .trim()
        .to_string()
}

fn parse_string_array(v: &Value) -> Vec<String> {
    match v {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|x| x.as_str().map(clean_name))
            .filter(|s| !s.is_empty())
            .collect(),
        Value::String(s) => {
            let t = s.trim();
            // First try to parse it as a JSON array string: "[\"a\",\"b\"]".
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(t) {
                return arr
                    .iter()
                    .filter_map(|x| x.as_str().map(clean_name))
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            // Fall back to comma-separated, stripping stray quotes/brackets.
            t.trim_matches(|c| c == '[' || c == ']')
                .split(',')
                .map(clean_name)
                .filter(|p| !p.is_empty())
                .collect()
        }
        _ => Vec::new(),
    }
}

fn tool_list_tables() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": "List the names of all tables in the current schema. Call this first.",
            "parameters": { "type": "object", "properties": {} }
        }
    })
}

fn tool_get_table_schema() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "get_table_schema",
            "description": "Get the columns (with types, primary keys, nullability) for one or more tables.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tables": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Exact table names to describe."
                    }
                },
                "required": ["tables"]
            }
        }
    })
}

fn tool_propose_query() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "propose_query",
            "description": "Submit the final SQL query and a short motivation. Call this when ready.",
            "parameters": {
                "type": "object",
                "properties": {
                    "motivation": {
                        "type": "string",
                        "description": "1-3 sentences explaining what the query does / what you changed."
                    },
                    "sql": {
                        "type": "string",
                        "description": "A single SQL query, no markdown fences."
                    }
                },
                "required": ["motivation", "sql"]
            }
        }
    })
}

/// All tools, offered every turn. (We tried staging tools by discovery progress,
/// but that made the model emit not-yet-offered tools as plain text instead of
/// tool calls — net worse. Reliability is handled in the loop via the
/// sole-propose rule and the prose-extraction fallback.)
fn all_tools() -> Value {
    json!([tool_list_tables(), tool_get_table_schema(), tool_propose_query()])
}

fn system_prompt(db_type: &str, database: &str, schema: &str) -> String {
    format!(
        "You are a SQL assistant for a {db_type} database (database \"{database}\", schema \"{schema}\"). \
You do NOT yet know which tables exist. Discover the schema with the provided tools:\n\
1. Call list_tables first and WAIT for the result before doing anything else.\n\
2. Call get_table_schema with the EXACT table names (from list_tables) whose columns you need.\n\
3. Use ONLY tables and columns returned by the tools — never invent names. If a table is \
reported as not found, look at the list_tables result and try again.\n\
4. Always reference tables by the EXACT schema-qualified name shown in the get_table_schema \
result (e.g. \"{schema}\".\"table_name\"), never the bare table name — the query runs without a \
default schema, so unqualified names will fail.\n\
When you have enough information, call propose_query with a short motivation and a single SQL \
query (no markdown fences). Always finish by calling propose_query.",
        db_type = db_type,
        database = database,
        schema = schema,
    )
}

#[derive(Deserialize)]
struct ChatResponse {
    message: ChatResponseMessage,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_calls: Vec<ToolCall>,
}

#[derive(Deserialize)]
struct ToolCall {
    function: ToolCallFunction,
}

#[derive(Deserialize)]
struct ToolCallFunction {
    name: String,
    #[serde(default)]
    arguments: Value,
}

/// Run the agentic generation loop: the model discovers the schema via tools and
/// finishes by calling propose_query, which we return as the suggestion.
pub async fn generate_sql(
    manager: &ConnectionManager,
    base_url: &str,
    model: &str,
    connection_id: &str,
    database: &str,
    schema: &str,
    db_type: &str,
    request: &str,
    current_query: Option<&str>,
) -> Result<SqlSuggestion, String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();

    // Cache the real table list once so get_table_schema can validate names.
    let mut known_tables: Option<Vec<String>> = None;
    // Set once the model has received real columns for at least one table; used
    // to gate the prose-extraction fallback so we don't accept blind SQL.
    let mut schema_delivered = false;
    let tools = all_tools();

    let user_content = match current_query {
        Some(q) if !q.trim().is_empty() => format!(
            "The user is currently editing this query — modify or build on it:\n{}\n\nRequest: {}",
            q.trim(),
            request
        ),
        _ => format!("Request: {}", request),
    };

    let mut messages: Vec<Value> = vec![
        json!({ "role": "system", "content": system_prompt(db_type, database, schema) }),
        json!({ "role": "user", "content": user_content }),
    ];

    let mut nudges = 0;

    for _ in 0..MAX_ITERATIONS {
        let resp = client
            .post(&url)
            .json(&json!({
                "model": model,
                "messages": messages,
                "tools": tools,
                "stream": false,
                "keep_alive": "30m",
            }))
            .send()
            .await
            .map_err(|e| format!("Could not reach Ollama at {}: {}", base_url, e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {}: {}", status, body));
        }

        // Keep the raw message so we can echo the assistant turn back verbatim
        // (preserving tool_calls so Ollama can match our tool responses).
        let raw: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
        let raw_message = raw.get("message").cloned().unwrap_or_else(|| json!({}));
        let parsed: ChatResponse = serde_json::from_value(raw.clone())
            .map_err(|e| format!("Unexpected Ollama chat response: {}", e))?;
        let message = parsed.message;

        messages.push(raw_message);

        if !message.tool_calls.is_empty() {
            // Accept propose_query ONLY when it is the sole call this turn. Small
            // models often bundle propose_query together with list_tables /
            // get_table_schema in one turn — meaning they proposed BEFORE seeing
            // any results (and hallucinate columns). In that case we defer the
            // proposal, answer the discovery tools, and ask it to propose again.
            let has_other = message
                .tool_calls
                .iter()
                .any(|c| c.function.name != "propose_query");

            if !has_other {
                if let Some(call) = message
                    .tool_calls
                    .iter()
                    .find(|c| c.function.name == "propose_query")
                {
                    let obj = args_as_object(&call.function.arguments);
                    let sql = strip_fences(&get_string_arg(&obj, "sql"));
                    let motivation = get_string_arg(&obj, "motivation").trim().to_string();
                    if sql.is_empty() {
                        return Err("Model proposed an empty SQL query.".to_string());
                    }
                    return Ok(SqlSuggestion { sql, motivation });
                }
            }

            for call in &message.tool_calls {
                let name = call.function.name.as_str();
                let obj = args_as_object(&call.function.arguments);

                match name {
                    "propose_query" => {
                        // Deferred: keep tool-call/response symmetry and nudge.
                        messages.push(json!({
                            "role": "tool",
                            "tool_name": name,
                            "content": "Not accepted yet — review the get_table_schema results \
above to confirm the real columns, then call propose_query again as your only action.",
                        }));
                    }
                    "list_tables" => {
                        let tables = match &known_tables {
                            Some(t) => t.clone(),
                            None => {
                                let t = manager
                                    .list_tables(connection_id, database, schema)
                                    .await?;
                                known_tables = Some(t.clone());
                                t
                            }
                        };
                        let content = if tables.is_empty() {
                            "No tables exist in this schema.".to_string()
                        } else {
                            tables.join("\n")
                        };
                        messages.push(json!({
                            "role": "tool",
                            "tool_name": name,
                            "content": content,
                        }));
                    }
                    "get_table_schema" => {
                        if known_tables.is_none() {
                            let t = manager
                                .list_tables(connection_id, database, schema)
                                .await?;
                            known_tables = Some(t);
                        }
                        let all = known_tables.as_ref().unwrap();
                        let requested = parse_string_array(obj.get("tables").unwrap_or(&Value::Null));

                        let mut parts: Vec<String> = Vec::new();
                        if requested.is_empty() {
                            parts.push(
                                "No table names provided. Call list_tables to see valid names."
                                    .to_string(),
                            );
                        }
                        let mut found_any = false;
                        for table in requested {
                            // Case-insensitive match against the real table list.
                            let real = all
                                .iter()
                                .find(|t| t.eq_ignore_ascii_case(&table))
                                .cloned();
                            match real {
                                Some(t) => {
                                    let columns = manager
                                        .list_columns(connection_id, database, schema, &t)
                                        .await?;
                                    parts.push(format_table_ddl(db_type, schema, &t, &columns));
                                    found_any = true;
                                }
                                None => parts.push(format!(
                                    "Table \"{}\" not found. Valid tables: {}.",
                                    table,
                                    all.join(", ")
                                )),
                            }
                        }
                        // Only unlock propose_query once the model has actually
                        // received real columns for at least one table.
                        if found_any {
                            schema_delivered = true;
                        }
                        messages.push(json!({
                            "role": "tool",
                            "tool_name": name,
                            "content": parts.join("\n\n"),
                        }));
                    }
                    other => {
                        messages.push(json!({
                            "role": "tool",
                            "tool_name": other,
                            "content": format!("Unknown tool \"{}\".", other),
                        }));
                    }
                }
            }
            continue;
        }

        // No tool calls. Maybe the model answered directly with JSON — accept it.
        let content = message.content.trim();
        if !content.is_empty() {
            if let Ok(s) = serde_json::from_str::<SqlSuggestion>(content) {
                let sql = strip_fences(&s.sql);
                if !sql.is_empty() {
                    return Ok(SqlSuggestion {
                        sql,
                        motivation: s.motivation.trim().to_string(),
                    });
                }
            }
            // Once the model has seen real schema, accept SQL narrated as prose
            // (a ```sql block) rather than via propose_query. Gated on
            // schema_delivered so we don't accept blind/hallucinated SQL.
            if schema_delivered {
                if let Some(s) = suggestion_from_text(content) {
                    return Ok(s);
                }
            }
        }

        // Otherwise nudge, grounding the model in the real tables, then give up.
        if nudges >= 2 {
            return Err(
                "The model stopped without proposing a query. Try rephrasing your request."
                    .to_string(),
            );
        }
        nudges += 1;
        let tables_hint = match &known_tables {
            Some(t) if !t.is_empty() => format!(" The available tables are: {}.", t.join(", ")),
            _ => String::new(),
        };
        messages.push(json!({
            "role": "user",
            "content": format!(
                "Keep going using the tools.{} Inspect the tables you need with \
get_table_schema, then call propose_query with your final motivation and sql.",
                tables_hint
            )
        }));
    }

    Err(format!(
        "Gave up after {} steps without a proposed query.",
        MAX_ITERATIONS
    ))
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
}

/// List models available from the Ollama service (/api/tags).
pub async fn list_models(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not reach Ollama at {}: {}", base_url, e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned {} when listing models.", resp.status()));
    }

    let parsed: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama model list: {}", e))?;

    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_array() {
        let v = json!(["users", "orders"]);
        assert_eq!(parse_string_array(&v), vec!["users", "orders"]);
    }

    #[test]
    fn parses_stringified_array() {
        // The llama3.2 quirk: arguments arrive as a JSON-encoded string.
        let v = json!("[\"revenue\", \"customers\"]");
        assert_eq!(parse_string_array(&v), vec!["revenue", "customers"]);
    }

    #[test]
    fn parses_comma_separated_string() {
        let v = json!("users, orders");
        assert_eq!(parse_string_array(&v), vec!["users", "orders"]);
    }

    #[test]
    fn parses_single_string() {
        let v = json!("users");
        assert_eq!(parse_string_array(&v), vec!["users"]);
    }

    #[test]
    fn empty_for_non_string_non_array() {
        assert!(parse_string_array(&Value::Null).is_empty());
        assert!(parse_string_array(&json!(42)).is_empty());
    }

    #[test]
    fn args_as_object_handles_stringified_blob() {
        let v = json!("{\"tables\": [\"a\"]}");
        let obj = args_as_object(&v);
        assert!(obj.contains_key("tables"));
    }

    #[test]
    fn strips_single_quoted_names() {
        let v = json!("[\"'users'\", \"'orders'\"]");
        assert_eq!(parse_string_array(&v), vec!["users", "orders"]);
    }

    #[test]
    fn extracts_sql_from_fenced_prose() {
        let text = "Here is the query to get recent users:\n\n```sql\nSELECT * FROM users ORDER BY created_at DESC LIMIT 10\n```";
        let s = suggestion_from_text(text).expect("should extract");
        assert_eq!(s.sql, "SELECT * FROM users ORDER BY created_at DESC LIMIT 10");
        assert!(s.motivation.starts_with("Here is the query"));
    }

    #[test]
    fn extracts_sql_from_bare_keyword_line() {
        let text = "This counts the rows.\nSELECT count(*) FROM orders";
        let s = suggestion_from_text(text).expect("should extract");
        assert_eq!(s.sql, "SELECT count(*) FROM orders");
        assert_eq!(s.motivation, "This counts the rows.");
    }

    #[test]
    fn no_sql_in_plain_text_returns_none() {
        assert!(suggestion_from_text("I cannot find a suitable table.").is_none());
    }
}
