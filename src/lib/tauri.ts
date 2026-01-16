// ABOUTME: Typed wrappers for Tauri invoke calls.
// ABOUTME: Provides type-safe communication with the Rust backend.

import { invoke } from "@tauri-apps/api/core";
import type {
  Category,
  ConnectionConfig,
  SaveConnectionInput,
  UpdateConnectionInput,
  SaveCategoryInput,
  UpdateCategoryInput,
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  FunctionInfo,
  QueryResult,
  QueryHistoryEntry,
  QueryHistoryFilter,
  AwsProfile,
  AwsParameter,
  AwsSecret,
  KubeContext,
  KubeNamespace,
  KubeSecret,
  KubeSecretKey,
  ParsedConnection,
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

export async function updateConnection(
  input: UpdateConnectionInput
): Promise<ConnectionConfig> {
  return invoke("update_connection", { input });
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

export async function listFunctions(
  connectionId: string,
  database: string,
  schema: string
): Promise<string[]> {
  return invoke("list_functions", { connectionId, database, schema });
}

export async function getFunctionDefinition(
  connectionId: string,
  database: string,
  schema: string,
  functionName: string
): Promise<FunctionInfo> {
  return invoke("get_function_definition", { connectionId, database, schema, functionName });
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
): Promise<[QueryResult, number]> {
  return invoke("execute_query", { connectionId, query });
}

export async function saveQueryHistory(
  entry: QueryHistoryEntry
): Promise<void> {
  return invoke("save_query_history", { entry });
}

export async function getQueryHistory(
  filter: QueryHistoryFilter
): Promise<QueryHistoryEntry[]> {
  return invoke("get_query_history", { filter });
}

export async function searchQueryHistory(
  filter: QueryHistoryFilter
): Promise<QueryHistoryEntry[]> {
  return invoke("search_query_history", { filter });
}

export async function deleteQueryHistory(id: string): Promise<void> {
  return invoke("delete_query_history", { id });
}

export async function clearQueryHistory(
  connectionId?: string
): Promise<void> {
  return invoke("clear_query_history", { connectionId });
}

export async function listCategories(): Promise<Category[]> {
  return invoke("list_categories");
}

export async function saveCategory(
  input: SaveCategoryInput
): Promise<Category> {
  return invoke("save_category", { input });
}

export async function updateCategory(
  input: UpdateCategoryInput
): Promise<Category> {
  return invoke("update_category", { input });
}

export async function deleteCategory(id: string): Promise<void> {
  return invoke("delete_category", { id });
}

export async function listAwsProfiles(): Promise<AwsProfile[]> {
  return invoke("list_aws_profiles");
}

export async function listSsmParameters(
  profile: string,
  region: string,
  pathPrefix?: string
): Promise<AwsParameter[]> {
  return invoke("list_ssm_parameters", { profile, region, pathPrefix });
}

export async function getSsmParameterValue(
  profile: string,
  region: string,
  name: string
): Promise<string> {
  return invoke("get_ssm_parameter_value", { profile, region, name });
}

export async function listAwsSecrets(
  profile: string,
  region: string
): Promise<AwsSecret[]> {
  return invoke("list_aws_secrets", { profile, region });
}

export async function getAwsSecretValue(
  profile: string,
  region: string,
  secretId: string
): Promise<string> {
  return invoke("get_aws_secret_value", { profile, region, secretId });
}

export async function listKubeContexts(): Promise<KubeContext[]> {
  return invoke("list_kube_contexts");
}

export async function listKubeNamespaces(
  context: string
): Promise<KubeNamespace[]> {
  return invoke("list_kube_namespaces", { context });
}

export async function listKubeSecrets(
  context: string,
  namespace: string
): Promise<KubeSecret[]> {
  return invoke("list_kube_secrets", { context, namespace });
}

export async function listKubeSecretKeys(
  context: string,
  namespace: string,
  secretName: string
): Promise<KubeSecretKey[]> {
  return invoke("list_kube_secret_keys", { context, namespace, secretName });
}

export async function getKubeSecretValue(
  context: string,
  namespace: string,
  secretName: string,
  key: string
): Promise<string> {
  return invoke("get_kube_secret_value", { context, namespace, secretName, key });
}

export async function parseConnectionUrl(url: string): Promise<ParsedConnection> {
  return invoke("parse_connection_url", { url });
}
