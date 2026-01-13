// ABOUTME: Expandable tree view for database objects.
// ABOUTME: Shows connections, databases, schemas, tables, and their metadata.

import { createSignal, For, Show } from "solid-js";
import type { TreeNode, ConnectionConfig } from "../lib/types";
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
          props.onTableSelect(database, schema, table);
          break;
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

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren =
      node.children && node.children.length > 0 ||
      ["connection", "database", "schema", "tables", "views", "table", "columns", "indexes", "constraints"].includes(node.type);
    const isLeaf = ["column", "index", "constraint", "view"].includes(node.type);

    return (
      <div class="tree-node" style={{ "padding-left": `${depth * 16}px` }}>
        <div
          class={`tree-node-content ${node.type}`}
          onClick={() => !isLeaf && handleToggle(node)}
        >
          <span class="tree-icon">
            {node.loading ? (
              "..."
            ) : isLeaf ? (
              ""
            ) : node.expanded ? (
              "▼"
            ) : (
              "▶"
            )}
          </span>
          <span class="tree-label">{node.label}</span>
          <Show when={node.type === "connection" && node.expanded}>
            <button
              class="disconnect-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleDisconnect(node);
              }}
            >
              ×
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
  const initNodes = () => {
    if (nodes().length === 0 && props.connections.length > 0) {
      updateNodes();
    } else if (props.connections.length !== nodes().length) {
      updateNodes();
    }
  };
  initNodes();

  return (
    <div class="object-tree">
      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>
      <For each={nodes()}>{(node) => renderNode(node)}</For>
    </div>
  );
}
