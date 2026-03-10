// ABOUTME: Tabbed panel for browsing database objects (tables, views, functions).
// ABOUTME: Shows objects for the currently selected WorkingContext with context menu for metadata.

import { createSignal, createEffect, For, Show, on } from "solid-js";
import { Icon } from "./Icon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { WorkingContext, ObjectTab, MetadataView } from "../lib/types";
import {
  listTables,
  listViews,
  listFunctions,
  listColumns,
  listIndexes,
  listConstraints,
  switchDatabase,
} from "../lib/tauri";

import tableSvg from "@phosphor-icons/core/assets/regular/table.svg?raw";
import eyeSvg from "@phosphor-icons/core/assets/regular/eye.svg?raw";
import functionSvg from "@phosphor-icons/core/assets/regular/function.svg?raw";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import rowsSvg from "@phosphor-icons/core/assets/regular/rows.svg?raw";
import columnsSvg from "@phosphor-icons/core/assets/regular/columns.svg?raw";
import lightningSvg from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import lockSvg from "@phosphor-icons/core/assets/regular/lock.svg?raw";

interface Props {
  context: WorkingContext | null;
  onTableSelect: (connectionId: string, database: string, schema: string, table: string) => void;
  onFunctionSelect: (connectionId: string, database: string, schema: string, functionName: string) => void;
  onMetadataSelect: (view: MetadataView) => void;
  onQueryGenerate: (query: string) => void;
}

interface ObjectCounts {
  tables: number;
  views: number;
  functions: number;
}

const REDIS_TABS = ["keys", "lists", "hashes", "sets", "sorted-sets"] as const;
type RedisTab = (typeof REDIS_TABS)[number];

export function ObjectPanel(props: Props) {
  const [activeTab, setActiveTab] = createSignal<ObjectTab>("tables");
  const [tables, setTables] = createSignal<string[]>([]);
  const [views, setViews] = createSignal<string[]>([]);
  const [functions, setFunctions] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [redisTab, setRedisTab] = createSignal<RedisTab>("keys");

  const isRedis = () => props.context?.dbType === "redis";

  const counts = (): ObjectCounts => ({
    tables: tables().length,
    views: views().length,
    functions: functions().length,
  });

  const currentList = (): string[] => {
    switch (activeTab()) {
      case "tables": return tables();
      case "views": return views();
      case "functions": return functions();
    }
  };

  const loadObjects = async (ctx: WorkingContext) => {
    setLoading(true);
    setError(null);
    setTables([]);
    setViews([]);
    setFunctions([]);

    try {
      await switchDatabase(ctx.connectionId, ctx.database);

      const [t, v, f] = await Promise.all([
        listTables(ctx.connectionId, ctx.database, ctx.schema),
        listViews(ctx.connectionId, ctx.database, ctx.schema),
        listFunctions(ctx.connectionId, ctx.database, ctx.schema),
      ]);

      setTables(t);
      setViews(v);
      setFunctions(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReload = () => {
    const ctx = props.context;
    if (ctx) loadObjects(ctx);
  };

  // Reload objects when context changes
  createEffect(
    on(
      () => props.context?.id,
      (id) => {
        if (!id || !props.context) {
          setTables([]);
          setViews([]);
          setFunctions([]);
          return;
        }
        loadObjects(props.context);
      },
    ),
  );

  const handleObjectClick = (name: string) => {
    const ctx = props.context;
    if (!ctx) return;

    if (activeTab() === "functions") {
      props.onFunctionSelect(ctx.connectionId, ctx.database, ctx.schema, name);
    } else {
      // Tables and views both use onTableSelect
      props.onTableSelect(ctx.connectionId, ctx.database, ctx.schema, name);
    }
  };

  const openMetadata = async (name: string, type: "columns" | "indexes" | "constraints") => {
    const ctx = props.context;
    if (!ctx) return;
    const fetchers = {
      columns: listColumns,
      indexes: listIndexes,
      constraints: listConstraints,
    };
    const data = await fetchers[type](ctx.connectionId, ctx.database, ctx.schema, name);
    props.onMetadataSelect({ type, data, connectionId: ctx.connectionId, database: ctx.database, schema: ctx.schema, table: name });
  };

  const handleContextMenu = (e: MouseEvent, name: string) => {
    const ctx = props.context;
    if (!ctx || activeTab() !== "tables") return;

    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Data",
        action: () => props.onTableSelect(ctx.connectionId, ctx.database, ctx.schema, name),
      },
      { label: "Columns", action: () => openMetadata(name, "columns") },
      { label: "Indexes", action: () => openMetadata(name, "indexes") },
      { label: "Constraints", action: () => openMetadata(name, "constraints") },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const handleRedisTabClick = (tab: RedisTab) => {
    setRedisTab(tab);
    const ctx = props.context;
    if (!ctx) return;

    const commands: Record<RedisTab, string> = {
      keys: "BROWSE COUNT 100",
      lists: "BROWSE COUNT 100 TYPE list",
      hashes: "BROWSE COUNT 100 TYPE hash",
      sets: "BROWSE COUNT 100 TYPE set",
      "sorted-sets": "BROWSE COUNT 100 TYPE zset",
    };
    props.onQueryGenerate(commands[tab]);
  };

  const getTabIcon = (tab: ObjectTab) => {
    switch (tab) {
      case "tables": return tableSvg;
      case "views": return eyeSvg;
      case "functions": return functionSvg;
    }
  };

  return (
    <div class="object-panel">
      <div class="object-panel-header">
        <span class="object-panel-title">Objects</span>
        <Show when={props.context && !isRedis()}>
          <button class="object-reload-btn" onClick={handleReload} title="Reload">
            <Icon svg={arrowsClockwiseSvg} size={14} />
          </button>
        </Show>
      </div>

      <Show when={props.context} fallback={
        <div class="object-empty">Select a database to browse objects</div>
      }>
        <Show when={isRedis()} fallback={
          <>
            <div class="object-tabs">
              <For each={["tables", "views", "functions"] as ObjectTab[]}>
                {(tab) => (
                  <button
                    class={`object-tab ${activeTab() === tab ? "active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    <Icon svg={getTabIcon(tab)} size={12} />
                    <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
                    <span class="object-tab-count">{counts()[tab]}</span>
                  </button>
                )}
              </For>
            </div>

            <div class="object-list">
              <Show when={loading()}>
                <div class="object-empty">Loading...</div>
              </Show>
              <Show when={error()}>
                <div class="object-error">{error()}</div>
              </Show>
              <Show when={!loading() && !error()}>
                <Show when={currentList().length === 0}>
                  <div class="object-empty">
                    No {activeTab()}
                  </div>
                </Show>
                <For each={currentList()}>
                  {(name) => (
                    <div
                      class="object-item"
                      onClick={() => handleObjectClick(name)}
                      onContextMenu={(e) => handleContextMenu(e, name)}
                    >
                      <span class="object-item-icon">
                        <Icon svg={getTabIcon(activeTab())} size={12} />
                      </span>
                      <span class="object-item-label">{name}</span>
                      <Show when={activeTab() === "tables"}>
                        <span class="object-item-actions">
                          <button
                            title="Columns"
                            onClick={(e) => { e.stopPropagation(); openMetadata(name, "columns"); }}
                          >
                            <Icon svg={columnsSvg} size={12} />
                          </button>
                          <button
                            title="Indexes"
                            onClick={(e) => { e.stopPropagation(); openMetadata(name, "indexes"); }}
                          >
                            <Icon svg={lightningSvg} size={12} />
                          </button>
                          <button
                            title="Constraints"
                            onClick={(e) => { e.stopPropagation(); openMetadata(name, "constraints"); }}
                          >
                            <Icon svg={lockSvg} size={12} />
                          </button>
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </>
        }>
          {/* Redis tabs */}
          <div class="object-tabs">
            <For each={[...REDIS_TABS]}>
              {(tab) => (
                <button
                  class={`object-tab ${redisTab() === tab ? "active" : ""}`}
                  onClick={() => handleRedisTabClick(tab)}
                >
                  <Icon svg={rowsSvg} size={12} />
                  <span>{tab.charAt(0).toUpperCase() + tab.slice(1).replace("-", " ")}</span>
                </button>
              )}
            </For>
          </div>
          <div class="object-list">
            <div class="object-empty">
              Click a tab to browse Redis data
            </div>
          </div>
        </Show>
      </Show>

      <Show when={contextMenu()}>
        <ContextMenu
          x={contextMenu()!.x}
          y={contextMenu()!.y}
          items={contextMenu()!.items}
          onClose={() => setContextMenu(null)}
        />
      </Show>
    </div>
  );
}
