// ABOUTME: Tests for result set export functionality.
// ABOUTME: Covers JSON and SQL INSERT export with various data types.

import { describe, it, expect } from "vitest";
import { exportAsJson, exportAsSqlInsert } from "./resultExporter";
import type { QueryResult } from "./types";

describe("exportAsJson", () => {
  it("exports empty result as empty array", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [],
      row_count: 0,
      message: null,
    };
    expect(exportAsJson(result)).toBe("[]");
  });

  it("exports single row as array of objects", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsJson(result)).toBe(
      JSON.stringify([{ id: 1, name: "Alice" }], null, 2)
    );
  });

  it("exports multiple rows", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
      row_count: 2,
      message: null,
    };
    expect(exportAsJson(result)).toBe(
      JSON.stringify(
        [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
        null,
        2
      )
    );
  });

  it("handles NULL values", () => {
    const result: QueryResult = {
      columns: ["id", "email"],
      rows: [[1, null]],
      row_count: 1,
      message: null,
    };
    expect(exportAsJson(result)).toBe(
      JSON.stringify([{ id: 1, email: null }], null, 2)
    );
  });

  it("handles boolean values", () => {
    const result: QueryResult = {
      columns: ["id", "active"],
      rows: [[1, true]],
      row_count: 1,
      message: null,
    };
    expect(exportAsJson(result)).toBe(
      JSON.stringify([{ id: 1, active: true }], null, 2)
    );
  });

  it("handles nested objects", () => {
    const result: QueryResult = {
      columns: ["id", "metadata"],
      rows: [[1, { foo: "bar" }]],
      row_count: 1,
      message: null,
    };
    expect(exportAsJson(result)).toBe(
      JSON.stringify([{ id: 1, metadata: { foo: "bar" } }], null, 2)
    );
  });
});

describe("exportAsSqlInsert", () => {
  it("exports empty result as comment", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [],
      row_count: 0,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe("-- No data to export");
  });

  it("exports single row as INSERT statement", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'Alice');"
    );
  });

  it("exports multiple rows as multi-value INSERT", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
      row_count: 2,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'Alice'),\n  (2, 'Bob');"
    );
  });

  it("handles NULL values", () => {
    const result: QueryResult = {
      columns: ["id", "email"],
      rows: [[1, null]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe(
      "INSERT INTO users (id, email) VALUES\n  (1, NULL);"
    );
  });

  it("escapes single quotes in strings", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "O'Brien"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'O''Brien');"
    );
  });

  it("handles boolean values", () => {
    const result: QueryResult = {
      columns: ["id", "active"],
      rows: [[1, true]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users")).toBe(
      "INSERT INTO users (id, active) VALUES\n  (1, true);"
    );
  });

  it("handles numeric values", () => {
    const result: QueryResult = {
      columns: ["id", "price"],
      rows: [[1, 19.99]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "products")).toBe(
      "INSERT INTO products (id, price) VALUES\n  (1, 19.99);"
    );
  });

  it("handles objects as JSON strings", () => {
    const result: QueryResult = {
      columns: ["id", "metadata"],
      rows: [[1, { foo: "bar" }]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "items")).toBe(
      `INSERT INTO items (id, metadata) VALUES\n  (1, '{"foo":"bar"}');`
    );
  });

  it("quotes table name with schema", () => {
    const result: QueryResult = {
      columns: ["id"],
      rows: [[1]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "public.users")).toBe(
      "INSERT INTO public.users (id) VALUES\n  (1);"
    );
  });

  it("adds ON CONFLICT DO NOTHING for postgres", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users", "postgres")).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'Alice')\nON CONFLICT DO NOTHING;"
    );
  });

  it("uses INSERT IGNORE for mysql", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users", "mysql")).toBe(
      "INSERT IGNORE INTO users (id, name) VALUES\n  (1, 'Alice');"
    );
  });

  it("uses plain INSERT for sqlite", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users", "sqlite")).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'Alice');"
    );
  });

  it("uses plain INSERT when dbType is null", () => {
    const result: QueryResult = {
      columns: ["id", "name"],
      rows: [[1, "Alice"]],
      row_count: 1,
      message: null,
    };
    expect(exportAsSqlInsert(result, "users", null)).toBe(
      "INSERT INTO users (id, name) VALUES\n  (1, 'Alice');"
    );
  });
});
