// ABOUTME: Displays query results in a scrollable table.
// ABOUTME: Shows columns, rows, and row count from executed queries.

import { For, Show } from "solid-js";
import type { QueryResult } from "../lib/types";

interface Props {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
}

export function ResultsTable(props: Props) {
  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  return (
    <div class="results-table">
      <div class="results-header">
        <span>Results</span>
        <Show when={props.result}>
          <span class="row-count">{props.result!.row_count} rows</span>
        </Show>
      </div>

      <div class="results-content">
        <Show when={props.loading}>
          <div class="loading">Running query...</div>
        </Show>

        <Show when={props.error}>
          <div class="error">{props.error}</div>
        </Show>

        <Show when={!props.loading && !props.error && props.result}>
          <Show
            when={props.result!.rows.length > 0}
            fallback={<div class="empty">No results</div>}
          >
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <For each={props.result!.columns}>
                      {(col) => <th>{col}</th>}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.result!.rows}>
                    {(row) => (
                      <tr>
                        <For each={row}>
                          {(cell) => (
                            <td class={cell === null ? "null" : ""}>
                              {formatValue(cell)}
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>

        <Show when={!props.loading && !props.error && !props.result}>
          <div class="empty">Run a query to see results</div>
        </Show>
      </div>
    </div>
  );
}
