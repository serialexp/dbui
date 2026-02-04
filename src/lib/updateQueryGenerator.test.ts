// ABOUTME: Tests for UPDATE query generation from edited result cells.
// ABOUTME: Covers single/composite PKs, NULL handling, quoting, and multiple rows.

import { describe, it, expect } from "vitest";
import { generateUpdateQuery } from "./updateQueryGenerator";

describe("generateUpdateQuery", () => {
  it("generates UPDATE for single row with single changed column", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", "alice@example.com"],
          changes: new Map([[1, "Alicia"]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET name = 'Alicia' WHERE id = 1;`
    );
  });

  it("generates UPDATE for single row with multiple changed columns", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", "alice@example.com"],
          changes: new Map([
            [1, "Alicia"],
            [2, "alicia@example.com"],
          ]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET name = 'Alicia', email = 'alicia@example.com' WHERE id = 1;`
    );
  });

  it("generates multiple UPDATE statements for multiple rows", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", "alice@example.com"],
          changes: new Map([[1, "Alicia"]]),
        },
        {
          rowIndex: 1,
          originalRow: [2, "Bob", "bob@example.com"],
          changes: new Map([[1, "Robert"]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET name = 'Alicia' WHERE id = 1;\nUPDATE public.users SET name = 'Robert' WHERE id = 2;`
    );
  });

  it("handles composite primary key", () => {
    const result = generateUpdateQuery(
      "order_items",
      "sales",
      ["order_id", "product_id"],
      ["order_id", "product_id", "quantity"],
      [
        {
          rowIndex: 0,
          originalRow: [100, 5, 2],
          changes: new Map([[2, 10]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE sales.order_items SET quantity = 10 WHERE order_id = 100 AND product_id = 5;`
    );
  });

  it("handles NULL values in SET clause", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "email"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", "alice@example.com"],
          changes: new Map([[2, null]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET email = NULL WHERE id = 1;`
    );
  });

  it("handles NULL values in WHERE clause (PK)", () => {
    const result = generateUpdateQuery(
      "data",
      "public",
      ["id", "version"],
      ["id", "version", "value"],
      [
        {
          rowIndex: 0,
          originalRow: [1, null, "old"],
          changes: new Map([[2, "new"]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.data SET value = 'new' WHERE id = 1 AND version IS NULL;`
    );
  });

  it("escapes single quotes in string values", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "bio"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", "Some bio"],
          changes: new Map([[1, "O'Brien"]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET name = 'O''Brien' WHERE id = 1;`
    );
  });

  it("handles boolean values", () => {
    const result = generateUpdateQuery(
      "users",
      "public",
      ["id"],
      ["id", "name", "active"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Alice", true],
          changes: new Map([[2, false]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.users SET active = false WHERE id = 1;`
    );
  });

  it("handles numeric values", () => {
    const result = generateUpdateQuery(
      "products",
      "public",
      ["id"],
      ["id", "name", "price"],
      [
        {
          rowIndex: 0,
          originalRow: [1, "Widget", 9.99],
          changes: new Map([[2, 19.99]]),
        },
      ]
    );
    expect(result).toBe(
      `UPDATE public.products SET price = 19.99 WHERE id = 1;`
    );
  });
});
