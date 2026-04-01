// ABOUTME: Generates SQL DDL statements for database metadata objects.
// ABOUTME: Supports columns, indexes, and constraints across different database types.

import type { ColumnInfo, IndexInfo, ConstraintInfo, DatabaseType } from "./types";

function tableRef(schema: string, table: string): string {
  return schema ? `${schema}.${table}` : table;
}

export function generateColumnSQL(
  column: ColumnInfo,
  table: string,
  schema: string,
  dbType: DatabaseType
): string {
  const nullable = column.is_nullable ? "" : " NOT NULL";
  const defaultVal = column.column_default
    ? ` DEFAULT ${column.column_default}`
    : "";
  const pk = column.is_primary_key ? " PRIMARY KEY" : "";

  return `-- Column definition for ${column.name}
${column.name} ${column.data_type}${nullable}${defaultVal}${pk}`;
}

export function generateIndexSQL(
  index: IndexInfo,
  table: string,
  schema: string,
  dbType: DatabaseType
): string {
  const ref = tableRef(schema, table);
  if (index.is_primary) {
    return `-- Primary key index
ALTER TABLE ${ref}
  ADD PRIMARY KEY (${index.columns.join(", ")});`;
  }

  const unique = index.is_unique ? "UNIQUE " : "";
  return `-- Index: ${index.name}
CREATE ${unique}INDEX ${index.name}
  ON ${ref} (${index.columns.join(", ")});`;
}

export function generateConstraintSQL(
  constraint: ConstraintInfo,
  table: string,
  schema: string,
  dbType: DatabaseType
): string {
  const ref = tableRef(schema, table);
  const constraintType = constraint.constraint_type.toUpperCase();

  if (constraintType.includes("FOREIGN")) {
    const references = constraint.foreign_table
      ? `${constraint.foreign_table}(${constraint.foreign_columns?.join(", ") ?? ""})`
      : "unknown";

    return `-- Foreign key constraint: ${constraint.name}
ALTER TABLE ${ref}
  ADD CONSTRAINT ${constraint.name}
  FOREIGN KEY (${constraint.columns.join(", ")})
  REFERENCES ${references};`;
  }

  if (constraintType.includes("UNIQUE")) {
    return `-- Unique constraint: ${constraint.name}
ALTER TABLE ${ref}
  ADD CONSTRAINT ${constraint.name}
  UNIQUE (${constraint.columns.join(", ")});`;
  }

  if (constraintType.includes("CHECK")) {
    return `-- Check constraint: ${constraint.name}
ALTER TABLE ${ref}
  ADD CONSTRAINT ${constraint.name}
  CHECK (...);  -- Check expression not available in metadata`;
  }

  if (constraintType.includes("PRIMARY")) {
    return `-- Primary key constraint: ${constraint.name}
ALTER TABLE ${ref}
  ADD CONSTRAINT ${constraint.name}
  PRIMARY KEY (${constraint.columns.join(", ")});`;
  }

  return `-- ${constraintType} constraint: ${constraint.name}
ALTER TABLE ${ref}
  ADD CONSTRAINT ${constraint.name}
  (${constraint.columns.join(", ")});`;
}
