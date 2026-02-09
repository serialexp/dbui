// ABOUTME: Exports query result sets as JSON or SQL INSERT statements.
// ABOUTME: Handles various data types including NULL, strings, numbers, booleans, and objects.

import type { QueryResult, DatabaseType } from "./types";

export function exportAsJson(result: QueryResult): string {
  const rows = result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, index) => {
      obj[col] = row[index];
    });
    return obj;
  });
  return JSON.stringify(rows, null, 2);
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    const escaped = json.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  return String(value);
}

export function exportAsSqlInsert(
  result: QueryResult,
  tableName: string,
  dbType?: DatabaseType | null
): string {
  if (result.rows.length === 0) {
    return "-- No data to export";
  }

  const columns = result.columns.join(", ");
  const values = result.rows
    .map((row) => {
      const formatted = row.map(formatSqlValue).join(", ");
      return `  (${formatted})`;
    })
    .join(",\n");

  if (dbType === "mysql") {
    return `INSERT IGNORE INTO ${tableName} (${columns}) VALUES\n${values};`;
  }

  if (dbType === "postgres") {
    return `INSERT INTO ${tableName} (${columns}) VALUES\n${values}\nON CONFLICT DO NOTHING;`;
  }

  return `INSERT INTO ${tableName} (${columns}) VALUES\n${values};`;
}
