// ABOUTME: Typed wrappers for Tauri invoke calls.
// ABOUTME: Provides type-safe communication with the Rust backend.

import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  SaveConnectionInput,
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  QueryResult,
} from "./types";

export async function saveConnection(
  input: SaveConnectionInput
): Promise<ConnectionConfig> {
  return invoke("save_connection", { input });
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke("list_connections");
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

export async function connect(id: string): Promise<string> {
  return invoke("connect", { id });
}

export async function disconnect(connectionId: string): Promise<void> {
  return invoke("disconnect", { connectionId });
}

export async function switchDatabase(connectionId: string, database: string): Promise<void> {
  return invoke("switch_database", { connectionId, database });
}

export async function listDatabases(connectionId: string): Promise<string[]> {
  return invoke("list_databases", { connectionId });
}

export async function listSchemas(
  connectionId: string,
  database: string
): Promise<string[]> {
  return invoke("list_schemas", { connectionId, database });
}

export async function listTables(
  connectionId: string,
  database: string,
  schema: string
): Promise<string[]> {
  return invoke("list_tables", { connectionId, database, schema });
}

export async function listViews(
  connectionId: string,
  database: string,
  schema: string
): Promise<string[]> {
  return invoke("list_views", { connectionId, database, schema });
}

export async function listColumns(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return invoke("list_columns", { connectionId, database, schema, table });
}

export async function listIndexes(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return invoke("list_indexes", { connectionId, database, schema, table });
}

export async function listConstraints(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return invoke("list_constraints", { connectionId, database, schema, table });
}

export async function executeQuery(
  connectionId: string,
  query: string
): Promise<QueryResult> {
  return invoke("execute_query", { connectionId, query });
}
