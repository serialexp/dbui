// ABOUTME: Expandable tree view for database objects.
// ABOUTME: Shows connections, databases, schemas, tables, and their metadata.

import { createSignal, createEffect, For, Show } from "solid-js";
import { Icon } from "./Icon";
import type { TreeNode, ConnectionConfig, Category, MetadataView } from "../lib/types";

// Import Phosphor icons as raw SVG strings
import caretRightSvg from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import caretDownSvg from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import ejectSvg from "@phosphor-icons/core/assets/regular/eject.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import pencilSvg from "@phosphor-icons/core/assets/regular/pencil.svg?raw";
import plugsSvg from "@phosphor-icons/core/assets/regular/plugs.svg?raw";
import plugsConnectedSvg from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import databaseSvg from "@phosphor-icons/core/assets/regular/database.svg?raw";
import foldersSvg from "@phosphor-icons/core/assets/regular/folders.svg?raw";
import dotOutlineSvg from "@phosphor-icons/core/assets/regular/dot-outline.svg?raw";
import tableSvg from "@phosphor-icons/core/assets/regular/table.svg?raw";
import eyeSvg from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import rowsSvg from "@phosphor-icons/core/assets/regular/rows.svg?raw";
import columnsSvg from "@phosphor-icons/core/assets/regular/columns.svg?raw";
import lightningSvg from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import lockSvg from "@phosphor-icons/core/assets/regular/lock.svg?raw";
import functionSvg from "@phosphor-icons/core/assets/regular/function.svg?raw";
import folderSvg from "@phosphor-icons/core/assets/regular/folder.svg?raw";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import {
  connect,
  disconnect,
  switchDatabase,
  listDatabases,
  listSchemas,
  listTables,
  listViews,
  listFunctions,
  listColumns,
  listIndexes,
  listConstraints,
  setVisibleDatabases,
} from "../lib/tauri";

interface Props {
  connections: ConnectionConfig[];
  categories: Category[];
  activeConnectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onDatabaseSwitch: (database: string, schema: string | null) => void;
  onTableSelect: (connectionId: string, database: string, schema: string, table: string) => void;
  onQueryGenerate: (query: string) => void;
  onEdit: (connection: ConnectionConfig) => void;
  onDelete: (id: string, e: Event) => void;
  onMetadataSelect: (view: MetadataView) => void;
  onFunctionSelect: (connectionId: string, database: string, schema: string, functionName: string) => void;
}

export function ObjectTree(props: Props) {
  const [nodes, setNodes] = createSignal<TreeNode[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  const findConnectionConfig = (connectionId: string): ConnectionConfig | undefined => {
    return props.connections.find((c) => c.id === connectionId);
  };

  const buildConnectionNodes = () => {
    const categoryMap = new Map<string, Category>();
    for (const cat of props.categories) {
      categoryMap.set(cat.id, cat);
    }

    const categorizedConnections = new Map<string, ConnectionConfig[]>();
    const uncategorizedConnections: ConnectionConfig[] = [];

    for (const conn of props.connections) {
      if (conn.category_id && categoryMap.has(conn.category_id)) {
        const existing = categorizedConnections.get(conn.category_id) || [];
        existing.push(conn);
        categorizedConnections.set(conn.category_id, existing);
      } else {
        uncategorizedConnections.push(conn);
      }
    }

    const nodes: TreeNode[] = [];

    for (const category of props.categories) {
      const conns = categorizedConnections.get(category.id) || [];
      nodes.push({
        id: `category:${category.id}`,
        label: category.name,
        type: "category" as const,
        children: conns.map((conn) => ({
          id: conn.id,
          label: conn.name,
          type: "connection" as const,
          children: [],
          expanded: false,
          loading: false,
          metadata: { config: conn },
        })),
        expanded: true,
        metadata: { category },
      });
    }

    for (const conn of uncategorizedConnections) {
      nodes.push({
        id: conn.id,
        label: conn.name,
        type: "connection" as const,
        children: [],
        expanded: false,
        loading: false,
        metadata: { config: conn },
      });
    }

    return nodes;
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
    // Action nodes (data, columns, indexes, constraints) should always execute, not toggle
    const isActionNode = ["data", "columns", "indexes", "constraints"].includes(node.type);

    if (!isActionNode && node.expanded) {
      updateNode(node.id, { expanded: false });
      return;
    }

    updateNode(node.id, { loading: true });
    setError(null);

    try {
      let children: TreeNode[] = [];

      switch (node.type) {
        case "category": {
          updateNode(node.id, { expanded: !node.expanded, loading: false });
          return;
        }
        case "connection": {
          const config = node.metadata?.config as ConnectionConfig;
          await connect(config.id);
          props.onConnectionChange(config.id);
          const databases = await listDatabases(config.id);

          // For Redis, show limited databases with "more" option
          if (config.db_type === "redis") {
            const visibleCount = config.visible_databases ?? 4;
            if (databases.length > visibleCount) {
              const visibleDbs = databases.slice(0, visibleCount);
              const hiddenDbs = databases.slice(visibleCount);
              children = visibleDbs.map((db) => ({
                id: `${node.id}:db:${db}`,
                label: db,
                type: "database" as const,
                children: [],
                expanded: false,
                metadata: { connectionId: config.id, database: db },
              }));
              children.push({
                id: `${node.id}:more-dbs`,
                label: `... ${hiddenDbs.length} more`,
                type: "more-databases" as const,
                children: [],
                expanded: false,
                metadata: { connectionId: config.id, databases: hiddenDbs, allDatabases: databases },
              });
            } else {
              children = databases.map((db) => ({
                id: `${node.id}:db:${db}`,
                label: db,
                type: "database" as const,
                children: [],
                expanded: false,
                metadata: { connectionId: config.id, database: db },
              }));
            }
          } else {
            children = databases.map((db) => ({
              id: `${node.id}:db:${db}`,
              label: db,
              type: "database" as const,
              children: [],
              expanded: false,
              metadata: { connectionId: config.id, database: db },
            }));
          }
          break;
        }
        case "database": {
          const { connectionId, database } = node.metadata as {
            connectionId: string;
            database: string;
          };
          const config = findConnectionConfig(connectionId);
          await switchDatabase(connectionId, database);
          props.onDatabaseSwitch(database, null);

          // Redis shows data type categories instead of schemas
          if (config?.db_type === "redis") {
            children = [
              {
                id: `${node.id}:redis-keys`,
                label: "Keys",
                type: "redis-keys" as const,
                metadata: { connectionId, database },
              },
              {
                id: `${node.id}:redis-lists`,
                label: "Lists",
                type: "redis-lists" as const,
                metadata: { connectionId, database },
              },
              {
                id: `${node.id}:redis-hashes`,
                label: "Hashes",
                type: "redis-hashes" as const,
                metadata: { connectionId, database },
              },
              {
                id: `${node.id}:redis-sets`,
                label: "Sets",
                type: "redis-sets" as const,
                metadata: { connectionId, database },
              },
              {
                id: `${node.id}:redis-sorted-sets`,
                label: "Sorted Sets",
                type: "redis-sorted-sets" as const,
                metadata: { connectionId, database },
              },
            ];
            break;
          }

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
          const [tables, views, functions] = await Promise.all([
            listTables(connectionId, database, schema),
            listViews(connectionId, database, schema),
            listFunctions(connectionId, database, schema),
          ]);
          children = [
            {
              id: `${node.id}:tables`,
              label: "Tables",
              type: "tables" as const,
              children: tables.length > 0 ? tables.map((t) => ({
                id: `${node.id}:table:${t}`,
                label: t,
                type: "table" as const,
                children: [],
                expanded: false,
                metadata: { connectionId, database, schema, table: t },
              })) : [{
                id: `${node.id}:tables:empty`,
                label: "No tables",
                type: "empty" as const,
              }],
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
          if (functions.length > 0) {
            children.push({
              id: `${node.id}:functions`,
              label: "Functions",
              type: "functions" as const,
              children: functions.map((f) => ({
                id: `${node.id}:function:${f}`,
                label: f,
                type: "function" as const,
                metadata: { connectionId, database, schema, function: f },
              })),
              expanded: false,
              metadata: { connectionId, database, schema },
            });
          }
          break;
        }
        case "tables":
        case "views":
        case "functions": {
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
              metadata: {
                connectionId,
                database,
                schema,
                table,
                data: columns,
              },
            },
            {
              id: `${node.id}:indexes`,
              label: "Indexes",
              type: "indexes" as const,
              metadata: {
                connectionId,
                database,
                schema,
                table,
                data: indexes,
              },
            },
            {
              id: `${node.id}:constraints`,
              label: "Constraints",
              type: "constraints" as const,
              metadata: {
                connectionId,
                database,
                schema,
                table,
                data: constraints,
              },
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
          props.onTableSelect(connectionId, database, schema, table);
          updateNode(node.id, { loading: false });
          return;
        }
        case "columns":
        case "indexes":
        case "constraints": {
          const { connectionId, database, schema, table, data } = node.metadata as {
            connectionId: string;
            database: string;
            schema: string;
            table: string;
            data: any[];
          };
          props.onMetadataSelect({
            type: node.type,
            data,
            connectionId,
            database,
            schema,
            table,
          });
          updateNode(node.id, { loading: false });
          return;
        }
        case "more-databases": {
          const { connectionId, allDatabases } = node.metadata as {
            connectionId: string;
            databases: string[];
            allDatabases: string[];
          };
          const config = findConnectionConfig(connectionId);
          if (!config) {
            updateNode(node.id, { loading: false });
            return;
          }

          // Expand by 2 more databases
          const currentCount = config.visible_databases ?? 4;
          const newCount = currentCount + 2;

          // Persist the new count
          await setVisibleDatabases(connectionId, newCount);

          // Get the connection node ID (parent of this "more" node)
          const connectionNodeId = node.id.replace(":more-dbs", "");

          // Build new children for the connection node
          let newChildren: TreeNode[];
          if (allDatabases.length > newCount) {
            const visibleDbs = allDatabases.slice(0, newCount);
            const hiddenDbs = allDatabases.slice(newCount);
            newChildren = visibleDbs.map((db) => ({
              id: `${connectionNodeId}:db:${db}`,
              label: db,
              type: "database" as const,
              children: [],
              expanded: false,
              metadata: { connectionId, database: db },
            }));
            newChildren.push({
              id: `${connectionNodeId}:more-dbs`,
              label: `... ${hiddenDbs.length} more`,
              type: "more-databases" as const,
              children: [],
              expanded: false,
              metadata: { connectionId, databases: hiddenDbs, allDatabases },
            });
          } else {
            newChildren = allDatabases.map((db) => ({
              id: `${connectionNodeId}:db:${db}`,
              label: db,
              type: "database" as const,
              children: [],
              expanded: false,
              metadata: { connectionId, database: db },
            }));
          }

          // Update the connection node (which is the parent)
          updateNode(connectionNodeId, { children: newChildren, loading: false });
          return;
        }
      }

      updateNode(node.id, { children, expanded: true, loading: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateNode(node.id, { loading: false });
    }
  };

  const handleReload = async (node: TreeNode) => {
    updateNode(node.id, { children: [], expanded: false });
    await handleToggle({ ...node, expanded: false, children: [] });
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

  const getConnectionIcon = (dbType: string) => {
    const iconMap: Record<string, string> = {
      postgres: "/icons/postgresql.svg",
      mysql: "/icons/mysql.svg",
      sqlite: "/icons/sqlite.svg",
      redis: "/icons/redis.svg",
    };
    return iconMap[dbType] || "/icons/postgresql.svg";
  };

  const getNodeIcon = (node: TreeNode) => {
    const iconSize = 14;
    switch (node.type) {
      case "category":
        return <Icon svg={folderSvg} size={iconSize} />;
      case "connection": {
        const config = node.metadata?.config as ConnectionConfig;
        return <img src={getConnectionIcon(config.db_type)} width={iconSize} height={iconSize} alt={config.db_type} />;
      }
      case "database":
        return <Icon svg={databaseSvg} size={iconSize} />;
      case "schema":
        return <Icon svg={foldersSvg} size={iconSize} />;
      case "tables":
      case "views":
      case "functions":
        return <Icon svg={rowsSvg} size={iconSize} />;
      case "columns":
        return <Icon svg={columnsSvg} size={iconSize} />;
      case "indexes":
        return <Icon svg={lightningSvg} size={iconSize} />;
      case "constraints":
        return <Icon svg={lockSvg} size={iconSize} />;
      case "table":
        return <Icon svg={tableSvg} size={iconSize} />;
      case "view":
        return <Icon svg={eyeSvg} size={iconSize} />;
      case "function":
        return <Icon svg={functionSvg} size={iconSize} />;
      case "data":
        return <Icon svg={rowsSvg} size={iconSize} />;
      case "redis-keys":
      case "redis-lists":
      case "redis-hashes":
      case "redis-sets":
      case "redis-sorted-sets":
        return <Icon svg={rowsSvg} size={iconSize} />;
      default:
        return null;
    }
  };

  const handleFunctionClick = (node: TreeNode) => {
    const { connectionId, database, schema, function: functionName } = node.metadata as {
      connectionId: string;
      database: string;
      schema: string;
      function: string;
    };
    props.onFunctionSelect(connectionId, database, schema, functionName);
  };

  const handleRedisTypeClick = (node: TreeNode) => {
    const { database } = node.metadata as { connectionId: string; database: string };

    // Switch to the correct database first
    props.onDatabaseSwitch(database, null);

    // Generate BROWSE command with type filter for each Redis data type
    const typeFilters: Record<string, string> = {
      "redis-keys": "BROWSE COUNT 100",
      "redis-lists": "BROWSE COUNT 100 TYPE list",
      "redis-hashes": "BROWSE COUNT 100 TYPE hash",
      "redis-sets": "BROWSE COUNT 100 TYPE set",
      "redis-sorted-sets": "BROWSE COUNT 100 TYPE zset",
    };

    const query = typeFilters[node.type] || "BROWSE COUNT 100";
    props.onQueryGenerate(query);
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren =
      node.children && node.children.length > 0 ||
      ["category", "connection", "database", "schema", "tables", "views", "functions", "table"].includes(node.type);
    const isLeaf = ["view", "function", "data", "columns", "indexes", "constraints", "empty", "more-databases", "redis-keys", "redis-lists", "redis-hashes", "redis-sets", "redis-sorted-sets"].includes(node.type);
    const isClickable = !isLeaf || ["data", "columns", "indexes", "constraints", "function", "more-databases", "redis-keys", "redis-lists", "redis-hashes", "redis-sets", "redis-sorted-sets"].includes(node.type);

    const getCategoryStyle = () => {
      if (node.type === "category") {
        const category = node.metadata?.category as Category;
        if (category) {
          return {
            "background-color": `${category.color}20`,
            "border-left": `3px solid ${category.color}`,
          };
        }
      }
      return {};
    };

    return (
      <div class="tree-node">
        <div
          class={`tree-node-content ${node.type}`}
          style={{ "padding-left": `${depth * 16 + 8}px`, ...getCategoryStyle() }}
          onClick={() => {
            if (node.type === "function") {
              handleFunctionClick(node);
            } else if (node.type.startsWith("redis-")) {
              handleRedisTypeClick(node);
            } else if (isClickable) {
              handleToggle(node);
            }
          }}
        >
          <span class="tree-icon">
            {node.loading ? (
              "..."
            ) : isLeaf ? (
              ""
            ) : node.expanded ? (
              <Icon svg={caretDownSvg} size={12} />
            ) : (
              <Icon svg={caretRightSvg} size={12} />
            )}
          </span>
          <span class="tree-node-icon">{getNodeIcon(node)}</span>
          <span class="tree-label">{node.label}</span>
          <Show when={node.expanded && ["connection", "database", "schema"].includes(node.type)}>
            <button
              class="reload-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleReload(node);
              }}
              title="Reload"
            >
              <Icon svg={arrowsClockwiseSvg} size={14} />
            </button>
          </Show>
          <Show when={node.type === "connection"}>
            <Show when={node.expanded}>
              <button
                class="disconnect-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisconnect(node);
                }}
              >
                <Icon svg={ejectSvg} size={14} />
              </button>
            </Show>
            <button
              class="edit-btn"
              onClick={(e) => {
                e.stopPropagation();
                const config = node.metadata?.config as ConnectionConfig;
                props.onEdit(config);
              }}
            >
              <Icon svg={pencilSvg} size={14} />
            </button>
            <button
              class="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
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

  // Initialize nodes when connections or categories change
  createEffect(() => {
    // Track both connections and categories
    const connectionIds = props.connections.map(c => c.id + (c.category_id || "")).join(",");
    const categoryIds = props.categories.map(c => c.id + c.name + c.color).join(",");

    // Rebuild tree when connections or categories change
    updateNodes();
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
