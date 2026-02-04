// ABOUTME: Displays query results in a scrollable table.
// ABOUTME: Shows columns, rows, and row count from executed queries.

import { createSignal, createEffect, For, Show } from "solid-js";
import type { QueryResult, CellSelection, TableContext } from "../lib/types";
import type { RowEdit } from "../lib/updateQueryGenerator";
import { Icon } from "./Icon";
import arrowRightSvg from "@phosphor-icons/core/assets/regular/arrow-right.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import pencilSvg from "@phosphor-icons/core/assets/regular/pencil-simple.svg?raw";

interface Props {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
  selectedCell: CellSelection | null;
  onCellSelect: (selection: CellSelection | null) => void;
  onRowDoubleClick?: (row: unknown[], columns: string[]) => void;
  tableContext?: TableContext | null;
  primaryKeyColumns?: string[];
  onGenerateDelete?: (rowIndices: number[]) => void;
  onGenerateUpdate?: (edits: RowEdit[]) => void;
  onPendingChangesChange?: (hasPending: boolean) => void;
}

export function ResultsTable(props: Props) {
  const MAX_DISPLAY_ROWS = 1000;
  const [markedForDeletion, setMarkedForDeletion] = createSignal<Set<number>>(new Set());
  const [editedCells, setEditedCells] = createSignal<Map<number, Map<number, unknown>>>(new Map());
  const [editingCell, setEditingCell] = createSignal<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = createSignal("");
  const [lastClickedRow, setLastClickedRow] = createSignal<number | null>(null);

  createEffect(() => {
    props.result;
    setMarkedForDeletion(new Set());
    setEditedCells(new Map());
    setEditingCell(null);
    setLastClickedRow(null);
  });

  createEffect(() => {
    const hasPending = markedForDeletion().size > 0 || editedCells().size > 0;
    props.onPendingChangesChange?.(hasPending);
  });

  const canEdit = () =>
    props.tableContext !== null &&
    props.tableContext !== undefined;

  const canDelete = () =>
    props.tableContext !== null &&
    props.tableContext !== undefined;

  const isRowEdited = (rowIndex: number) => editedCells().has(rowIndex);

  const toggleRowMarked = (rowIndex: number, shiftKey: boolean) => {
    const current = new Set(markedForDeletion());
    const lastRow = lastClickedRow();

    if (shiftKey && lastRow !== null && lastRow !== rowIndex) {
      const start = Math.min(lastRow, rowIndex);
      const end = Math.max(lastRow, rowIndex);
      for (let i = start; i <= end; i++) {
        if (!isRowEdited(i)) {
          current.add(i);
        }
      }
      setMarkedForDeletion(current);
    } else {
      if (current.has(rowIndex)) {
        current.delete(rowIndex);
      } else {
        if (isRowEdited(rowIndex)) return;
        current.add(rowIndex);
      }
      setMarkedForDeletion(current);
      setLastClickedRow(rowIndex);
    }
  };

  const handleGenerateDelete = () => {
    const indices = Array.from(markedForDeletion());
    if (indices.length > 0 && props.onGenerateDelete) {
      props.onGenerateDelete(indices);
      setMarkedForDeletion(new Set());
      setEditedCells(new Map());
    }
  };

  const startEditing = (rowIndex: number, colIndex: number, currentValue: unknown) => {
    if (markedForDeletion().has(rowIndex)) return;
    if (!canEdit()) return;

    const edited = editedCells().get(rowIndex)?.get(colIndex);
    const valueToEdit = edited !== undefined ? edited : currentValue;

    setEditingCell({ row: rowIndex, col: colIndex });
    setEditValue(valueToEdit === null ? "" : String(valueToEdit));
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const saveEdit = () => {
    const cell = editingCell();
    if (!cell || !props.result) return;

    const originalValue = props.result.rows[cell.row][cell.col];
    const newValue = editValue();

    let parsedValue: unknown = newValue;
    if (newValue === "" && originalValue === null) {
      parsedValue = null;
    } else if (newValue.toLowerCase() === "null") {
      parsedValue = null;
    } else if (typeof originalValue === "number") {
      const num = Number(newValue);
      if (!isNaN(num)) parsedValue = num;
    } else if (typeof originalValue === "boolean") {
      parsedValue = newValue.toLowerCase() === "true";
    }

    const currentEdits = new Map(editedCells());
    let rowEdits = currentEdits.get(cell.row);

    if (parsedValue === originalValue || (parsedValue === null && originalValue === null)) {
      if (rowEdits) {
        rowEdits.delete(cell.col);
        if (rowEdits.size === 0) {
          currentEdits.delete(cell.row);
        }
      }
    } else {
      if (!rowEdits) {
        rowEdits = new Map();
        currentEdits.set(cell.row, rowEdits);
      }
      rowEdits.set(cell.col, parsedValue);
    }

    setEditedCells(currentEdits);
    setEditingCell(null);
    setEditValue("");
  };

  const handleGenerateUpdate = () => {
    const edits = editedCells();
    if (edits.size === 0 || !props.onGenerateUpdate || !props.result) return;

    const rowEdits: RowEdit[] = [];
    edits.forEach((changes, rowIndex) => {
      rowEdits.push({
        rowIndex,
        originalRow: props.result!.rows[rowIndex],
        changes,
      });
    });

    props.onGenerateUpdate(rowEdits);
    setEditedCells(new Map());
    setMarkedForDeletion(new Set());
  };

  const getCellDisplayValue = (rowIndex: number, colIndex: number, originalValue: unknown): unknown => {
    const rowEdits = editedCells().get(rowIndex);
    if (rowEdits?.has(colIndex)) {
      return rowEdits.get(colIndex);
    }
    return originalValue;
  };

  const isCellEdited = (rowIndex: number, colIndex: number): boolean => {
    return editedCells().get(rowIndex)?.has(colIndex) ?? false;
  };

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

  const isDrillable = () => {
    if (!props.onRowDoubleClick || !props.result) return false;
    const cols = props.result.columns;
    return cols.length >= 2 && cols[0] === "key" && cols[1] === "type";
  };

  return (
    <div class="results-table">
      <div class="results-header">
        <span>Results</span>
        <Show when={props.result}>
          <Show
            when={props.result!.rows.length > 0}
            fallback={
              <span class="result-message">{props.result!.message || "No results"}</span>
            }
          >
            <span class="row-count">
              {props.result!.row_count} rows
              <Show when={isLimited()}>
                {" "}(showing first {MAX_DISPLAY_ROWS})
              </Show>
            </span>
          </Show>
        </Show>
        <Show when={editedCells().size > 0}>
          <button class="generate-update-btn" onClick={handleGenerateUpdate}>
            <Icon svg={pencilSvg} size={14} />
            Generate UPDATE ({editedCells().size})
          </button>
        </Show>
        <Show when={markedForDeletion().size > 0}>
          <button class="generate-delete-btn" onClick={handleGenerateDelete}>
            <Icon svg={trashSvg} size={14} />
            Generate DELETE ({markedForDeletion().size})
          </button>
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
                    <Show when={canDelete()}>
                      <th class="delete-column"></th>
                    </Show>
                    <For each={props.result!.columns}>
                      {(col) => <th>{col}</th>}
                    </For>
                    <Show when={isDrillable()}>
                      <th class="action-column"></th>
                    </Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={displayRows()}>
                    {(row, getRowIndex) => (
                      <tr
                        classList={{
                          "marked-for-deletion": markedForDeletion().has(getRowIndex()),
                          "row-edited": isRowEdited(getRowIndex()),
                        }}
                      >
                        <Show when={canDelete()}>
                          <td class="delete-cell">
                            <input
                              type="checkbox"
                              checked={markedForDeletion().has(getRowIndex())}
                              onClick={(e) => {
                                e.preventDefault();
                                toggleRowMarked(getRowIndex(), e.shiftKey);
                              }}
                            />
                          </td>
                        </Show>
                        <For each={row}>
                          {(cell, getCellIndex) => {
                            const rowIdx = getRowIndex();
                            const cellIdx = getCellIndex();

                            const isSelected = () =>
                              props.selectedCell !== null &&
                              props.selectedCell.rowIndex === rowIdx &&
                              props.selectedCell.columnIndex === cellIdx;

                            const isEditing = () => {
                              const ec = editingCell();
                              return ec !== null && ec.row === rowIdx && ec.col === cellIdx;
                            };

                            const handleClick = () => {
                              const columns = props.result?.columns;
                              if (!columns) return;

                              props.onCellSelect({
                                rowIndex: rowIdx,
                                columnIndex: cellIdx,
                                value: getCellDisplayValue(rowIdx, cellIdx, cell),
                                columnName: columns[cellIdx],
                              });
                            };

                            const handleDoubleClick = (e: MouseEvent) => {
                              e.stopPropagation();
                              if (isDrillable() && props.onRowDoubleClick && props.result?.columns) {
                                props.onRowDoubleClick(row, props.result.columns);
                                return;
                              }
                              startEditing(rowIdx, cellIdx, cell);
                            };

                            const displayValue = getCellDisplayValue(rowIdx, cellIdx, cell);

                            return (
                              <td
                                classList={{
                                  "null": displayValue === null,
                                  "selected-cell": isSelected(),
                                  "cell-edited": isCellEdited(rowIdx, cellIdx),
                                }}
                                onClick={handleClick}
                                onDblClick={handleDoubleClick}
                              >
                                <Show
                                  when={isEditing()}
                                  fallback={formatValue(displayValue)}
                                >
                                  <input
                                    type="text"
                                    class="cell-edit-input"
                                    value={editValue()}
                                    onInput={(e) => setEditValue(e.currentTarget.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        saveEdit();
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        cancelEditing();
                                      }
                                    }}
                                    onBlur={saveEdit}
                                    ref={(el) => setTimeout(() => el?.focus(), 0)}
                                  />
                                </Show>
                              </td>
                            );
                          }}
                        </For>
                        <Show when={isDrillable()}>
                          <td class="action-cell">
                            <button
                              class="drill-button"
                              onClick={() => {
                                if (props.onRowDoubleClick && props.result?.columns) {
                                  props.onRowDoubleClick(row, props.result.columns);
                                }
                              }}
                              title="View value"
                            >
                              <Icon svg={arrowRightSvg} size={14} />
                            </button>
                          </td>
                        </Show>
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
