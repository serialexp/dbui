// ABOUTME: Tests for DELETE query generation from selected result rows.
// ABOUTME: Covers single/composite PKs, NULL handling, quoting, and query merging.

import { describe, it, expect } from "vitest";
import {
  generateDeleteQuery,
  mergeDeleteQuery,
  parseDeleteQuery,
} from "./deleteQueryGenerator";

describe("generateDeleteQuery", () => {
  it("generates DELETE for single row with single PK", () => {
    const result = generateDeleteQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [[1, "Alice", "alice@example.com"]]
    );
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (id = 1);`
    );
  });

  it("generates DELETE for multiple rows with single PK", () => {
    const result = generateDeleteQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [
        [1, "Alice", "alice@example.com"],
        [2, "Bob", "bob@example.com"],
        [3, "Carol", "carol@example.com"],
      ]
    );
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (id = 1)\n   OR (id = 2)\n   OR (id = 3);`
    );
  });

  it("generates DELETE for composite PK", () => {
    const result = generateDeleteQuery(
      "order_items",
      "sales",
      ["order_id", "product_id"],
      ["order_id", "product_id", "quantity"],
      [
        [100, 5, 2],
        [100, 7, 1],
      ]
    );
    expect(result).toBe(
      `DELETE FROM sales.order_items\nWHERE (order_id = 100 AND product_id = 5)\n   OR (order_id = 100 AND product_id = 7);`
    );
  });

  it("handles NULL values in PK with IS NULL", () => {
    const result = generateDeleteQuery(
      "data",
      "public",
      ["id", "version"],
      ["id", "version", "value"],
      [[1, null, "test"]]
    );
    expect(result).toBe(
      `DELETE FROM public.data\nWHERE (id = 1 AND version IS NULL);`
    );
  });

  it("quotes string values", () => {
    const result = generateDeleteQuery(
      "users",
      "public",
      ["username"],
      ["username", "email"],
      [["alice", "alice@example.com"]]
    );
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (username = 'alice');`
    );
  });

  it("escapes single quotes in string values", () => {
    const result = generateDeleteQuery(
      "users",
      "public",
      ["name"],
      ["name", "bio"],
      [["O'Brien", "Some bio"]]
    );
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (name = 'O''Brien');`
    );
  });

  it("handles boolean values", () => {
    const result = generateDeleteQuery(
      "flags",
      "public",
      ["id", "active"],
      ["id", "active"],
      [[1, true]]
    );
    expect(result).toBe(
      `DELETE FROM public.flags\nWHERE (id = 1 AND active = true);`
    );
  });
});

describe("parseDeleteQuery", () => {
  it("parses simple DELETE query", () => {
    const result = parseDeleteQuery(
      `DELETE FROM public.users\nWHERE (id = 1);`
    );
    expect(result).toEqual({
      table: "users",
      schema: "public",
      conditions: ["(id = 1)"],
    });
  });

  it("parses DELETE with multiple conditions", () => {
    const result = parseDeleteQuery(
      `DELETE FROM public.users\nWHERE (id = 1)\n   OR (id = 2)\n   OR (id = 3);`
    );
    expect(result).toEqual({
      table: "users",
      schema: "public",
      conditions: ["(id = 1)", "(id = 2)", "(id = 3)"],
    });
  });

  it("parses DELETE with composite PK conditions", () => {
    const result = parseDeleteQuery(
      `DELETE FROM sales.order_items\nWHERE (order_id = 100 AND product_id = 5)\n   OR (order_id = 100 AND product_id = 7);`
    );
    expect(result).toEqual({
      table: "order_items",
      schema: "sales",
      conditions: [
        "(order_id = 100 AND product_id = 5)",
        "(order_id = 100 AND product_id = 7)",
      ],
    });
  });

  it("returns null for non-DELETE queries", () => {
    const result = parseDeleteQuery("SELECT * FROM users;");
    expect(result).toBeNull();
  });

  it("returns null for malformed DELETE queries", () => {
    const result = parseDeleteQuery("DELETE users WHERE id = 1;");
    expect(result).toBeNull();
  });
});

describe("mergeDeleteQuery", () => {
  it("merges new conditions into existing DELETE", () => {
    const existing = `DELETE FROM public.users\nWHERE (id = 1);`;
    const newConditions = ["(id = 2)", "(id = 3)"];
    const result = mergeDeleteQuery(existing, newConditions);
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (id = 1)\n   OR (id = 2)\n   OR (id = 3);`
    );
  });

  it("avoids duplicate conditions", () => {
    const existing = `DELETE FROM public.users\nWHERE (id = 1)\n   OR (id = 2);`;
    const newConditions = ["(id = 2)", "(id = 3)"];
    const result = mergeDeleteQuery(existing, newConditions);
    expect(result).toBe(
      `DELETE FROM public.users\nWHERE (id = 1)\n   OR (id = 2)\n   OR (id = 3);`
    );
  });

  it("returns null for non-DELETE queries", () => {
    const result = mergeDeleteQuery("SELECT * FROM users;", ["(id = 1)"]);
    expect(result).toBeNull();
  });
});
