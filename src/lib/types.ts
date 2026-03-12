// ABOUTME: Shared TypeScript types for the DBUI frontend.
// ABOUTME: Mirrors Rust structs for type-safe communication.

export type DatabaseType = "postgres" | "mysql" | "sqlite" | "redis";
export type SslMode = "disable" | "prefer" | "require";

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
  category_id: string | null;
  visible_databases: number | null;
  ssl_mode: SslMode;
}

export interface SaveConnectionInput {
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
  category_id: string | null;
  visible_databases: number | null;
  ssl_mode: SslMode;
}

export interface UpdateConnectionInput {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
  category_id: string | null;
  visible_databases: number | null;
  ssl_mode: SslMode;
}

export interface SaveCategoryInput {
  name: string;
  color: string;
}

export interface UpdateCategoryInput {
  id: string;
  name: string;
  color: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  foreign_table: string | null;
  foreign_columns: string[] | null;
}

export interface FunctionInfo {
  name: string;
  definition: string;
  return_type: string | null;
  language: string | null;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  message: string | null;
}

export interface CellSelection {
  rowIndex: number;
  columnIndex: number;
  value: unknown;
  columnName: string;
}

export type MetadataView = {
  type: "columns" | "indexes" | "constraints";
  data: ColumnInfo[] | IndexInfo[] | ConstraintInfo[];
  connectionId: string;
  database: string;
  schema: string;
  table: string;
} | null;

export interface QueryHistoryEntry {
  id: string;
  connection_id: string;
  database: string;
  schema: string;
  query: string;
  timestamp: string;
  execution_time_ms: number;
  row_count: number;
  success: boolean;
  error_message: string | null;
}

export interface QueryHistoryFilter {
  connection_id?: string;
  database?: string;
  schema?: string;
  start_date?: string;
  end_date?: string;
  success_only?: boolean;
  search_query?: string;
  limit?: number;
  offset?: number;
}

export interface AwsProfile {
  name: string;
  region: string | null;
}

export interface AwsParameter {
  name: string;
  parameter_type: string;
  last_modified: string | null;
}

export interface AwsSecret {
  name: string;
  arn: string;
  description: string | null;
  last_modified: string | null;
}

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
}

export interface KubeNamespace {
  name: string;
}

export interface KubeSecret {
  name: string;
  namespace: string;
  secret_type: string;
}

export interface KubeSecretKey {
  key: string;
}

export interface ParsedConnection {
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
}

export interface TableContext {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export interface WorkingContext {
  id: string;
  connectionId: string;
  connectionName: string;
  dbType: DatabaseType;
  database: string;
  schema: string;
  categoryId: string | null;
  categoryColor: string | null;
}

export type ObjectTab = "tables" | "views" | "functions" | "materialized_views" | "sequences" | "triggers" | "procedures";
