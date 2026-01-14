// ABOUTME: Displays query results in a scrollable table.
// ABOUTME: Shows columns, rows, and row count from executed queries.

import { For, Show } from "solid-js";
import type { QueryResult, CellSelection } from "../lib/types";

interface Props {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
  selectedCell: CellSelection | null;
  onCellSelect: (selection: CellSelection | null) => void;
}

export function ResultsTable(props: Props) {
  const MAX_DISPLAY_ROWS = 1000;

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const displayRows = () => {
    if (!props.result) return [];
    return props.result.rows.slice(0, MAX_DISPLAY_ROWS);
  };

  const isLimited = () => {
    return props.result && props.result.rows.length > MAX_DISPLAY_ROWS;
  };

  return (
    <div class="results-table">
      <div class="results-header">
        <span>Results</span>
        <Show when={props.result}>
          <span class="row-count">
            {props.result!.row_count} rows
            <Show when={isLimited()}>
              {" "}(showing first {MAX_DISPLAY_ROWS})
            </Show>
          </span>
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
            fallback={<div class="empty">{props.result!.message || "No results"}</div>}
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
                  <For each={displayRows()}>
                    {(row, getRowIndex) => (
                      <tr>
                        <For each={row}>
                          {(cell, getCellIndex) => {
                            const rowIdx = getRowIndex();
                            const cellIdx = getCellIndex();

                            const isSelected = () =>
                              props.selectedCell !== null &&
                              props.selectedCell.rowIndex === rowIdx &&
                              props.selectedCell.columnIndex === cellIdx;

                            const handleClick = () => {
                              const columns = props.result?.columns;
                              if (!columns) return;

                              props.onCellSelect({
                                rowIndex: rowIdx,
                                columnIndex: cellIdx,
                                value: cell,
                                columnName: columns[cellIdx],
                              });
                            };

                            return (
                              <td
                                class={cell === null ? "null" : ""}
                                classList={{ "selected-cell": isSelected() }}
                                onClick={handleClick}
                              >
                                {formatValue(cell)}
                              </td>
                            );
                          }}
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
