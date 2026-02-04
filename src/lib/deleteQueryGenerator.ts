// ABOUTME: Generates DELETE queries from selected result rows.
// ABOUTME: Supports composite PKs, NULL handling, and merging into existing queries.

export interface ParsedDelete {
  table: string;
  schema: string;
  conditions: string[];
}

function formatValue(value: unknown): string {
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

function buildCondition(
  pkColumns: string[],
  columns: string[],
  row: unknown[]
): string {
  const conditions = pkColumns.map((pk) => {
    const colIndex = columns.indexOf(pk);
    const value = row[colIndex];
    const formattedValue = formatValue(value);
    if (formattedValue === "IS NULL") {
      return `${pk} IS NULL`;
    }
    return `${pk} ${formattedValue}`;
  });

  return `(${conditions.join(" AND ")})`;
}

export function generateDeleteQuery(
  table: string,
  schema: string,
  pkColumns: string[],
  columns: string[],
  rows: unknown[][]
): string {
  const conditions = rows.map((row) => buildCondition(pkColumns, columns, row));

  const whereClause = conditions
    .map((cond, i) => (i === 0 ? cond : `   OR ${cond}`))
    .join("\n");

  return `DELETE FROM ${schema}.${table}\nWHERE ${whereClause};`;
}

export function parseDeleteQuery(query: string): ParsedDelete | null {
  const normalized = query.trim();
  const match = normalized.match(
    /^DELETE\s+FROM\s+(\w+)\.(\w+)\s+WHERE\s+(.+);?$/is
  );

  if (!match) {
    return null;
  }

  const [, schema, table, whereClause] = match;

  const conditions: string[] = [];
  const conditionRegex = /\(([^)]+)\)/g;
  let condMatch;
  while ((condMatch = conditionRegex.exec(whereClause)) !== null) {
    conditions.push(`(${condMatch[1]})`);
  }

  if (conditions.length === 0) {
    return null;
  }

  return {
    table,
    schema,
    conditions,
  };
}

export function mergeDeleteQuery(
  existingQuery: string,
  newConditions: string[]
): string | null {
  const parsed = parseDeleteQuery(existingQuery);
  if (!parsed) {
    return null;
  }

  const existingSet = new Set(parsed.conditions);
  const uniqueNew = newConditions.filter((cond) => !existingSet.has(cond));
  const allConditions = [...parsed.conditions, ...uniqueNew];

  const whereClause = allConditions
    .map((cond, i) => (i === 0 ? cond : `   OR ${cond}`))
    .join("\n");

  return `DELETE FROM ${parsed.schema}.${parsed.table}\nWHERE ${whereClause};`;
}
