// ABOUTME: Shared TypeScript types for the DBUI frontend.
// ABOUTME: Mirrors Rust structs for type-safe communication.

export type DatabaseType = "postgres" | "mysql" | "sqlite";

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
}

export interface SaveConnectionInput {
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string | null;
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

export interface TreeNode {
  id: string;
  label: string;
  type:
    | "connection"
    | "database"
    | "schema"
    | "tables"
    | "table"
    | "views"
    | "view"
    | "functions"
    | "function"
    | "data"
    | "columns"
    | "column"
    | "indexes"
    | "index"
    | "constraints"
    | "constraint"
    | "empty";
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
  metadata?: Record<string, unknown>;
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
