// ABOUTME: Displays database metadata (columns, indexes, constraints) in table format.
// ABOUTME: Shows SQL DDL definitions when a row is selected.

import { For, Show } from "solid-js";
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
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";

interface Props {
  view: MetadataView;
  selectedRow: number | null;
  onRowSelect: (rowIndex: number) => void;
  onClose: () => void;
  dbType: DatabaseType | null;
}

interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function MetadataTable(props: Props) {
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

  const getTitle = (): string => {
    if (!props.view) return "";
    const typeLabel = props.view.type.charAt(0).toUpperCase() + props.view.type.slice(1);
    return `${typeLabel} - ${props.view.schema}.${props.view.table}`;
  };

  const getSQLDefinition = (): string => {
    if (!props.view || props.selectedRow === null) return "";

    const dbType = props.dbType ?? "postgres";
    const { table, schema } = props.view;

    switch (props.view.type) {
      case "columns": {
        const column = (props.view.data as ColumnInfo[])[props.selectedRow];
        return generateColumnSQL(column, table, schema, dbType);
      }
      case "indexes": {
        const index = (props.view.data as IndexInfo[])[props.selectedRow];
        return generateIndexSQL(index, table, schema, dbType);
      }
      case "constraints": {
        const constraint = (props.view.data as ConstraintInfo[])[props.selectedRow];
        return generateConstraintSQL(constraint, table, schema, dbType);
      }
    }
  };

  const tableData = () => transformToTableData();

  return (
    <div class="metadata-table">
      <div class="metadata-header">
        <span>{getTitle()}</span>
        <button class="close-button" onClick={props.onClose} title="Close">
          <Icon svg={xSvg} />
        </button>
      </div>

      <div class="metadata-content">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <For each={tableData().columns}>{(col) => <th>{col}</th>}</For>
              </tr>
            </thead>
            <tbody>
              <For each={tableData().rows}>
                {(row, getIndex) => {
                  const rowIdx = getIndex();
                  const isSelected = () => props.selectedRow === rowIdx;

                  return (
                    <tr
                      classList={{ "metadata-row-selected": isSelected() }}
                      onClick={() => props.onRowSelect(rowIdx)}
                    >
                      <For each={row}>{(cell) => <td>{cell}</td>}</For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <Show when={props.selectedRow !== null}>
        <div class="sql-definition-panel">
          <div class="sql-definition-label">SQL Definition</div>
          <div class="sql-definition-content">{getSQLDefinition()}</div>
        </div>
      </Show>
    </div>
  );
}
