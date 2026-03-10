// ABOUTME: Displays database metadata (columns, indexes, constraints) in table format.
// ABOUTME: Shows SQL DDL definitions when a row is selected. Supports multi-select for dropping.

import { For, Show, createSignal, createEffect } from "solid-js";
import type {
  MetadataView,
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  DatabaseType,
} from "../lib/types";
import {
  generateColumnSQL,
  generateIndexSQL,
  generateConstraintSQL,
} from "../lib/sqlGenerator";
import { Icon } from "./Icon";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";

interface Props {
  view: MetadataView;
  selectedRows: number[];
  lastClickedRow: number | null;
  onRowToggle: (rowIndex: number, shiftKey: boolean) => void;
  onToggleAll: () => void;
  onRefresh: () => Promise<void>;
  onDrop: (names: string[]) => void;
  dbType: DatabaseType | null;
}

interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function MetadataTable(props: Props) {
  const dropLabel = () => {
    switch (props.view?.type) {
      case "columns": return "Drop Column";
      case "indexes": return "Drop Index";
      case "constraints": return "Drop Constraint";
      default: return "Drop";
    }
  };

  const transformToTableData = (): TableData => {
    if (!props.view) {
      return { columns: [], rows: [] };
    }

    switch (props.view.type) {
      case "columns": {
        const data = props.view.data as ColumnInfo[];
        return {
          columns: ["Name", "Type", "Nullable", "Default", "Primary Key"],
          rows: data.map((c) => [
            c.name,
            c.data_type,
            c.is_nullable ? "YES" : "NO",
            c.column_default ?? "NULL",
            c.is_primary_key ? "YES" : "NO",
          ]),
        };
      }
      case "indexes": {
        const data = props.view.data as IndexInfo[];
        return {
          columns: ["Name", "Columns", "Unique", "Primary"],
          rows: data.map((i) => [
            i.name,
            i.columns.join(", "),
            i.is_unique ? "YES" : "NO",
            i.is_primary ? "YES" : "NO",
          ]),
        };
      }
      case "constraints": {
        const data = props.view.data as ConstraintInfo[];
        return {
          columns: ["Name", "Type", "Columns", "References"],
          rows: data.map((c) => [
            c.name,
            c.constraint_type,
            c.columns.join(", "),
            c.foreign_table
              ? `${c.foreign_table}(${c.foreign_columns?.join(", ") ?? ""})`
              : "-",
          ]),
        };
      }
    }
  };

  const getSQLDefinition = (): string => {
    if (!props.view || props.lastClickedRow === null) return "";

    const dbType = props.dbType ?? "postgres";
    const { table, schema } = props.view;

    switch (props.view.type) {
      case "columns": {
        const column = (props.view.data as ColumnInfo[])[props.lastClickedRow];
        return column ? generateColumnSQL(column, table, schema, dbType) : "";
      }
      case "indexes": {
        const index = (props.view.data as IndexInfo[])[props.lastClickedRow];
        return index ? generateIndexSQL(index, table, schema, dbType) : "";
      }
      case "constraints": {
        const constraint = (props.view.data as ConstraintInfo[])[props.lastClickedRow];
        return constraint ? generateConstraintSQL(constraint, table, schema, dbType) : "";
      }
    }
  };

  const tableData = () => transformToTableData();

  const [refreshing, setRefreshing] = createSignal(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDrop = () => {
    if (!props.view || props.selectedRows.length === 0) return;
    const names = [...props.selectedRows]
      .sort((a, b) => a - b)
      .map((i) => (props.view!.data[i] as { name: string }).name);
    props.onDrop(names);
  };

  return (
    <div class="metadata-table">
      <div class="metadata-header">
        <span>{props.view?.type}</span>
        <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          <Show when={props.selectedRows.length > 0}>
            <button class="generate-delete-btn" onClick={handleDrop}>
              <Icon svg={trashSvg} size={14} />
              {dropLabel()} ({props.selectedRows.length})
            </button>
          </Show>
          <button
            class="refresh-button"
            onClick={handleRefresh}
            disabled={refreshing()}
            title="Refresh"
          >
            <Icon svg={arrowsClockwiseSvg} size={14} />
          </button>
        </div>
      </div>
      <div class="metadata-content">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th class="delete-column">
                  <input
                    type="checkbox"
                    checked={(() => {
                      const total = props.view?.data.length ?? 0;
                      return total > 0 && props.selectedRows.length === total;
                    })()}
                    ref={(el) => {
                      createEffect(() => {
                        const total = props.view?.data.length ?? 0;
                        const selected = props.selectedRows.length;
                        el.indeterminate = selected > 0 && selected < total;
                      });
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      props.onToggleAll();
                    }}
                  />
                </th>
                <For each={tableData().columns}>{(col) => <th>{col}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={tableData().rows}>
                {(row, getIndex) => {
                  const rowIdx = getIndex();
                  const isSelected = () => props.selectedRows.includes(rowIdx);

                  return (
                    <tr
                      classList={{ "marked-for-deletion": isSelected() }}
                      onClick={(e) => props.onRowToggle(rowIdx, e.shiftKey)}
                    >
                      <td class="delete-cell">
                        <input
                          type="checkbox"
                          checked={isSelected()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            props.onRowToggle(rowIdx, e.shiftKey);
                          }}
                        />
                      </td>
                      <For each={row}>{(cell) => <td>{cell}</td>}</For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <Show when={props.lastClickedRow !== null && props.selectedRows.includes(props.lastClickedRow!)}>
        <div class="sql-definition-panel">
          <div class="sql-definition-label">SQL Definition</div>
          <div class="sql-definition-content">{getSQLDefinition()}</div>
        </div>
      </Show>
    </div>
  );
}
