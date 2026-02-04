// ABOUTME: Generates UPDATE queries from edited result cells.
// ABOUTME: Supports composite PKs, NULL handling, and multiple row updates.

export interface RowEdit {
  rowIndex: number;
  originalRow: unknown[];
  changes: Map<number, unknown>; // columnIndex -> newValue
}

function formatValue(value: unknown): string {
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
  return String(value);
}

function formatWhereValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "IS NULL";
  }
  if (typeof value === "string") {
    const escaped = value.replace(/'/g, "''");
    return `= '${escaped}'`;
  }
  if (typeof value === "boolean") {
    return `= ${value}`;
  }
  return `= ${value}`;
}

export function generateUpdateQuery(
  table: string,
  schema: string,
  pkColumns: string[],
  columns: string[],
  edits: RowEdit[]
): string {
  const statements = edits.map((edit) => {
    const setClauses: string[] = [];
    edit.changes.forEach((newValue, colIndex) => {
      const colName = columns[colIndex];
      setClauses.push(`${colName} = ${formatValue(newValue)}`);
    });

    const whereClauses = pkColumns.map((pk) => {
      const pkIndex = columns.indexOf(pk);
      const pkValue = edit.originalRow[pkIndex];
      const formatted = formatWhereValue(pkValue);
      if (formatted === "IS NULL") {
        return `${pk} IS NULL`;
      }
      return `${pk} ${formatted}`;
    });

    return `UPDATE ${schema}.${table} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")};`;
  });

  return statements.join("\n");
}
