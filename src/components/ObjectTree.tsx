// ABOUTME: Expandable tree view for database objects.
// ABOUTME: Shows connections, databases, schemas, tables, and their metadata.

import { createSignal, createEffect, For, Show } from "solid-js";
import { Icon } from "./Icon";
import type { TreeNode, ConnectionConfig } from "../lib/types";

// Import Phosphor icons as raw SVG strings
import caretRightSvg from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import caretDownSvg from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import plugsSvg from "@phosphor-icons/core/assets/regular/plugs.svg?raw";
import plugsConnectedSvg from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import databaseSvg from "@phosphor-icons/core/assets/regular/database.svg?raw";
import foldersSvg from "@phosphor-icons/core/assets/regular/folders.svg?raw";
import dotOutlineSvg from "@phosphor-icons/core/assets/regular/dot-outline.svg?raw";
import tableSvg from "@phosphor-icons/core/assets/regular/table.svg?raw";
import eyeSvg from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import gridNineSvg from "@phosphor-icons/core/assets/regular/grid-nine.svg?raw";
import rowsSvg from "@phosphor-icons/core/assets/regular/rows.svg?raw";
import lightningSvg from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import lockSvg from "@phosphor-icons/core/assets/regular/lock.svg?raw";
import {
  connect,
  disconnect,
  listDatabases,
  listSchemas,
  listTables,
  listViews,
  listColumns,
  listIndexes,
  listConstraints,
} from "../lib/tauri";

interface Props {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onTableSelect: (database: string, schema: string, table: string) => void;
  onQueryGenerate: (query: string) => void;
  onDelete: (id: string, e: Event) => void;
}

export function ObjectTree(props: Props) {
  const [nodes, setNodes] = createSignal<TreeNode[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  const buildConnectionNodes = () => {
    return props.connections.map((conn) => ({
      id: conn.id,
      label: conn.name,
      type: "connection" as const,
      children: [],
      expanded: false,
      loading: false,
      metadata: { config: conn },
    }));
  };

  const updateNodes = () => {
    setNodes(buildConnectionNodes());
  };

  const findNode = (
    nodeList: TreeNode[],
    id: string
  ): TreeNode | undefined => {
    for (const node of nodeList) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return undefined;
  };

  const updateNode = (id: string, updates: Partial<TreeNode>) => {
    setNodes((prev) => {
      const update = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((node) => {
          if (node.id === id) {
            return { ...node, ...updates };
          }
          if (node.children) {
            return { ...node, children: update(node.children) };
          }
          return node;
        });
      return update(prev);
    });
  };

  const handleToggle = async (node: TreeNode) => {
    if (node.expanded) {
      updateNode(node.id, { expanded: false });
      return;
    }

    // Handle leaf nodes that don't need loading state
    if (["column", "index", "constraint"].includes(node.type)) {
      switch (node.type) {
        case "column": {
          const { column } = node.metadata as { column: any };
          const query = `-- Column: ${column.name}
-- Type: ${column.data_type}
-- Nullable: ${column.is_nullable ? "YES" : "NO"}
-- Default: ${column.column_default ?? "NULL"}
-- Primary Key: ${column.is_primary_key ? "YES" : "NO"}`;
          props.onQueryGenerate(query);
          return;
        }
        case "index": {
          const { index } = node.metadata as { index: any };
          const query = `-- Index: ${index.name}
-- Columns: ${index.columns.join(", ")}
-- Unique: ${index.is_unique ? "YES" : "NO"}
-- Primary: ${index.is_primary ? "YES" : "NO"}`;
          props.onQueryGenerate(query);
          return;
        }
        case "constraint": {
          const { constraint } = node.metadata as { constraint: any };
          let query = `-- Constraint: ${constraint.name}
-- Type: ${constraint.constraint_type}
-- Columns: ${constraint.columns.join(", ")}`;
          if (constraint.foreign_table) {
            query += `
-- References: ${constraint.foreign_table} (${constraint.foreign_columns?.join(", ") ?? ""})`;
          }
          props.onQueryGenerate(query);
          return;
        }
      }
    }

    updateNode(node.id, { loading: true });
    setError(null);

    try {
      let children: TreeNode[] = [];

      switch (node.type) {
        case "connection": {
          const config = node.metadata?.config as ConnectionConfig;
          await connect(config.id);
          props.onConnectionChange(config.id);
          const databases = await listDatabases(config.id);
          children = databases.map((db) => ({
            id: `${node.id}:db:${db}`,
            label: db,
            type: "database" as const,
            children: [],
            expanded: false,
            metadata: { connectionId: config.id, database: db },
          }));
          break;
        }
        case "database": {
          const { connectionId, database } = node.metadata as {
            connectionId: string;
            database: string;
          };
          const schemas = await listSchemas(connectionId, database);
          children = schemas.map((schema) => ({
            id: `${node.id}:schema:${schema}`,
            label: schema,
            type: "schema" as const,
            children: [],
            expanded: false,
            metadata: { connectionId, database, schema },
          }));
          break;
        }
        case "schema": {
          const { connectionId, database, schema } = node.metadata as {
            connectionId: string;
            database: string;
            schema: string;
          };
          const [tables, views] = await Promise.all([
            listTables(connectionId, database, schema),
            listViews(connectionId, database, schema),
          ]);
          children = [
            {
              id: `${node.id}:tables`,
              label: "Tables",
              type: "tables" as const,
              children: tables.map((t) => ({
                id: `${node.id}:table:${t}`,
                label: t,
                type: "table" as const,
                children: [],
                expanded: false,
                metadata: { connectionId, database, schema, table: t },
              })),
              expanded: false,
              metadata: { connectionId, database, schema },
            },
          ];
          if (views.length > 0) {
            children.push({
              id: `${node.id}:views`,
              label: "Views",
              type: "views" as const,
              children: views.map((v) => ({
                id: `${node.id}:view:${v}`,
                label: v,
                type: "view" as const,
                metadata: { connectionId, database, schema, view: v },
              })),
              expanded: false,
              metadata: { connectionId, database, schema },
            });
          }
          break;
        }
        case "tables":
        case "views": {
          updateNode(node.id, { expanded: true, loading: false });
          return;
        }
        case "table": {
          const { connectionId, database, schema, table } = node.metadata as {
            connectionId: string;
            database: string;
            schema: string;
            table: string;
          };
          const [columns, indexes, constraints] = await Promise.all([
            listColumns(connectionId, database, schema, table),
            listIndexes(connectionId, database, schema, table),
            listConstraints(connectionId, database, schema, table),
          ]);
          children = [
            {
              id: `${node.id}:data`,
              label: "Data",
              type: "data" as const,
              metadata: { connectionId, database, schema, table },
            },
            {
              id: `${node.id}:columns`,
              label: "Columns",
              type: "columns" as const,
              children: columns.map((c) => ({
                id: `${node.id}:column:${c.name}`,
                label: `${c.name} (${c.data_type})${c.is_primary_key ? " PK" : ""}`,
                type: "column" as const,
                metadata: { column: c },
              })),
              expanded: false,
            },
            {
              id: `${node.id}:indexes`,
              label: "Indexes",
              type: "indexes" as const,
              children: indexes.map((i) => ({
                id: `${node.id}:index:${i.name}`,
                label: `${i.name}${i.is_primary ? " (PK)" : i.is_unique ? " (UNIQUE)" : ""}`,
                type: "index" as const,
                metadata: { index: i },
              })),
              expanded: false,
            },
            {
              id: `${node.id}:constraints`,
              label: "Constraints",
              type: "constraints" as const,
              children: constraints.map((c) => ({
                id: `${node.id}:constraint:${c.name}`,
                label: `${c.name} (${c.constraint_type})`,
                type: "constraint" as const,
                metadata: { constraint: c },
              })),
              expanded: false,
            },
          ];
          break;
        }
        case "data": {
          const { connectionId, database, schema, table } = node.metadata as {
            connectionId: string;
            database: string;
            schema: string;
            table: string;
          };
          props.onTableSelect(database, schema, table);
          updateNode(node.id, { expanded: true, loading: false });
          return;
        }
        case "columns":
        case "indexes":
        case "constraints": {
          updateNode(node.id, { expanded: true, loading: false });
          return;
        }
      }

      updateNode(node.id, { children, expanded: true, loading: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateNode(node.id, { loading: false });
    }
  };

  const handleDisconnect = async (node: TreeNode) => {
    const config = node.metadata?.config as ConnectionConfig;
    try {
      await disconnect(config.id);
      props.onConnectionChange(null);
      updateNode(node.id, { expanded: false, children: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const getNodeIcon = (node: TreeNode) => {
    const iconSize = 14;
    switch (node.type) {
      case "connection":
        return <Icon svg={node.expanded ? plugsConnectedSvg : plugsSvg} size={iconSize} />;
      case "database":
        return <Icon svg={databaseSvg} size={iconSize} />;
      case "schema":
        return <Icon svg={foldersSvg} size={iconSize} />;
      case "tables":
      case "views":
      case "columns":
      case "indexes":
      case "constraints":
        return <Icon svg={dotOutlineSvg} size={iconSize} />;
      case "table":
        return <Icon svg={tableSvg} size={iconSize} />;
      case "view":
        return <Icon svg={eyeSvg} size={iconSize} />;
      case "data":
        return <Icon svg={gridNineSvg} size={iconSize} />;
      case "column":
        return <Icon svg={rowsSvg} size={iconSize} />;
      case "index":
        return <Icon svg={lightningSvg} size={iconSize} />;
      case "constraint":
        return <Icon svg={lockSvg} size={iconSize} />;
      default:
        return null;
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren =
      node.children && node.children.length > 0 ||
      ["connection", "database", "schema", "tables", "views", "table", "columns", "indexes", "constraints"].includes(node.type);
    const isLeaf = ["view"].includes(node.type);
    const isClickable = ["data", "column", "index", "constraint"].includes(node.type) || !isLeaf;

    return (
      <div class="tree-node">
        <div
          class={`tree-node-content ${node.type}`}
          style={{ "padding-left": `${depth * 16 + 8}px` }}
          onClick={() => isClickable && handleToggle(node)}
        >
          <span class="tree-icon">
            {node.loading ? (
              "..."
            ) : isLeaf || ["data", "column", "index", "constraint"].includes(node.type) ? (
              ""
            ) : node.expanded ? (
              <Icon svg={caretDownSvg} size={12} />
            ) : (
              <Icon svg={caretRightSvg} size={12} />
            )}
          </span>
          <span class="tree-node-icon">{getNodeIcon(node)}</span>
          <span class="tree-label">{node.label}</span>
          <Show when={node.type === "connection"}>
            <Show when={node.expanded}>
              <button
                class="disconnect-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect(node);
                }}
              >
                <Icon svg={xSvg} size={14} />
              </button>
            </Show>
            <button
              class="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                console.log("Delete clicked", node);
                const config = node.metadata?.config as ConnectionConfig;
                props.onDelete(config.id, e);
              }}
            >
              <Icon svg={trashSvg} size={14} />
            </button>
          </Show>
        </div>
        <Show when={node.expanded && node.children}>
          <For each={node.children}>
            {(child) => renderNode(child, depth + 1)}
          </For>
        </Show>
      </div>
    );
  };

  // Initialize nodes when connections change
  createEffect(() => {
    if (nodes().length === 0 && props.connections.length > 0) {
      updateNodes();
    } else if (props.connections.length !== nodes().length) {
      updateNodes();
    }
  });

  return (
    <div class="object-tree">
      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>
      <For each={nodes()}>{(node) => renderNode(node)}</For>
    </div>
  );
}
