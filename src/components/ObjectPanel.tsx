// ABOUTME: Tabbed panel for browsing database objects (tables, views, functions, and more).
// ABOUTME: Shows objects for the currently selected WorkingContext with context menu for metadata.

import { createSignal, createEffect, For, Show, on, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { WorkingContext, ObjectTab, MetadataView } from "../lib/types";
import {
  listTables,
  listViews,
  listFunctions,
  listMaterializedViews,
  listSequences,
  listTriggers,
  listProcedures,
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
import dotsThreeSvg from "@phosphor-icons/core/assets/bold/dots-three-bold.svg?raw";
import stackSvg from "@phosphor-icons/core/assets/regular/stack.svg?raw";
import listNumbersSvg from "@phosphor-icons/core/assets/regular/list-numbers.svg?raw";
import gearSvg from "@phosphor-icons/core/assets/regular/gear-six.svg?raw";
import codeSvg from "@phosphor-icons/core/assets/regular/code.svg?raw";
import flowArrowSvg from "@phosphor-icons/core/assets/regular/flow-arrow.svg?raw";

interface Props {
  context: WorkingContext | null;
  onTableSelect: (connectionId: string, database: string, schema: string, table: string) => void;
  onFunctionSelect: (connectionId: string, database: string, schema: string, functionName: string) => void;
  onViewDefinitionSelect: (connectionId: string, database: string, schema: string, viewName: string) => void;
  onShowDependencyGraph: (ctx: WorkingContext) => void;
  onMetadataSelect: (view: MetadataView) => void;
  onQueryGenerate: (query: string) => void;
}

const PRIMARY_TABS: ObjectTab[] = ["tables", "views", "functions"];
const MORE_TABS: ObjectTab[] = ["materialized_views", "sequences", "triggers", "procedures"];

const TAB_LABELS: Record<ObjectTab, string> = {
  tables: "Tables",
  views: "Views",
  functions: "Functions",
  materialized_views: "Materialized Views",
  sequences: "Sequences",
  triggers: "Triggers",
  procedures: "Procedures",
};

const REDIS_TABS = ["keys", "lists", "hashes", "sets", "sorted-sets"] as const;
type RedisTab = (typeof REDIS_TABS)[number];

export function ObjectPanel(props: Props) {
  const [activeTab, setActiveTab] = createSignal<ObjectTab>("tables");
  const [tables, setTables] = createSignal<string[]>([]);
  const [views, setViews] = createSignal<string[]>([]);
  const [functions, setFunctions] = createSignal<string[]>([]);
  const [materializedViews, setMaterializedViews] = createSignal<string[]>([]);
  const [sequences, setSequences] = createSignal<string[]>([]);
  const [triggers, setTriggers] = createSignal<string[]>([]);
  const [procedures, setProcedures] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [redisTab, setRedisTab] = createSignal<RedisTab>("keys");
  const [moreOpen, setMoreOpen] = createSignal(false);

  let moreRef: HTMLDivElement | undefined;

  const isRedis = () => props.context?.dbType === "redis";

  const getCount = (tab: ObjectTab): number => {
    switch (tab) {
      case "tables": return tables().length;
      case "views": return views().length;
      case "functions": return functions().length;
      case "materialized_views": return materializedViews().length;
      case "sequences": return sequences().length;
      case "triggers": return triggers().length;
      case "procedures": return procedures().length;
    }
  };

  const currentList = (): string[] => {
    switch (activeTab()) {
      case "tables": return tables();
      case "views": return views();
      case "functions": return functions();
      case "materialized_views": return materializedViews();
      case "sequences": return sequences();
      case "triggers": return triggers();
      case "procedures": return procedures();
    }
  };

  const loadObjects = async (ctx: WorkingContext) => {
    setLoading(true);
    setError(null);
    setTables([]);
    setViews([]);
    setFunctions([]);
    setMaterializedViews([]);
    setSequences([]);
    setTriggers([]);
    setProcedures([]);

    try {
      await switchDatabase(ctx.connectionId, ctx.database);

      const [t, v, f, mv, seq, trg, proc] = await Promise.all([
        listTables(ctx.connectionId, ctx.database, ctx.schema),
        listViews(ctx.connectionId, ctx.database, ctx.schema),
        listFunctions(ctx.connectionId, ctx.database, ctx.schema),
        listMaterializedViews(ctx.connectionId, ctx.database, ctx.schema),
        listSequences(ctx.connectionId, ctx.database, ctx.schema),
        listTriggers(ctx.connectionId, ctx.database, ctx.schema),
        listProcedures(ctx.connectionId, ctx.database, ctx.schema),
      ]);

      setTables(t);
      setViews(v);
      setFunctions(f);
      setMaterializedViews(mv);
      setSequences(seq);
      setTriggers(trg);
      setProcedures(proc);
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
          setMaterializedViews([]);
          setSequences([]);
          setTriggers([]);
          setProcedures([]);
          return;
        }
        loadObjects(props.context);
      },
    ),
  );

  // Close "More" dropdown on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (moreOpen() && moreRef && !moreRef.contains(e.target as Node)) {
      setMoreOpen(false);
    }
  };
  document.addEventListener("mousedown", handleClickOutside);
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));

  const handleObjectClick = (name: string) => {
    const ctx = props.context;
    if (!ctx) return;

    const tab = activeTab();
    if (tab === "functions" || tab === "procedures") {
      props.onFunctionSelect(ctx.connectionId, ctx.database, ctx.schema, name);
    } else {
      // Tables, views, materialized views use onTableSelect
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
      case "materialized_views": return stackSvg;
      case "sequences": return listNumbersSvg;
      case "triggers": return lightningSvg;
      case "procedures": return gearSvg;
    }
  };

  const isMoreTabActive = () => MORE_TABS.includes(activeTab());

  const handleMoreTabSelect = (tab: ObjectTab) => {
    setActiveTab(tab);
    setMoreOpen(false);
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
              <For each={PRIMARY_TABS}>
                {(tab) => (
                  <button
                    class={`object-tab ${activeTab() === tab ? "active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    <Icon svg={getTabIcon(tab)} size={12} />
                    <span>{TAB_LABELS[tab]}</span>
                    <span class="object-tab-count">{getCount(tab)}</span>
                  </button>
                )}
              </For>
              <div class="object-tab-more-wrapper" ref={moreRef}>
                <button
                  class="object-tab"
                  onClick={() => setMoreOpen(!moreOpen())}
                  title="More object types"
                >
                  <Icon svg={isMoreTabActive() ? getTabIcon(activeTab()) : dotsThreeSvg} size={12} />
                </button>
                <Show when={moreOpen()}>
                  <div class="object-more-dropdown">
                    <For each={MORE_TABS}>
                      {(tab) => (
                        <button
                          class={`object-more-item ${activeTab() === tab ? "active" : ""}`}
                          onClick={() => handleMoreTabSelect(tab)}
                        >
                          <Icon svg={getTabIcon(tab)} size={12} />
                          <span>{TAB_LABELS[tab]}</span>
                          <span class="object-tab-count">{getCount(tab)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
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
                    No {TAB_LABELS[activeTab()].toLowerCase()}
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
                      <Show when={activeTab() === "views" || activeTab() === "materialized_views"}>
                        <span class="object-item-actions">
                          <button
                            title="View definition"
                            onClick={(e) => {
                              e.stopPropagation();
                              const ctx = props.context;
                              if (ctx) props.onViewDefinitionSelect(ctx.connectionId, ctx.database, ctx.schema, name);
                            }}
                          >
                            <Icon svg={codeSvg} size={12} />
                          </button>
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <Show when={(activeTab() === "views" || activeTab() === "materialized_views") && props.context?.dbType === "postgres"}>
              <div class="object-panel-footer">
                <button
                  class="object-panel-footer-btn"
                  onClick={() => props.context && props.onShowDependencyGraph(props.context)}
                >
                  <Icon svg={flowArrowSvg} size={12} />
                  <span>View Dependencies</span>
                </button>
              </div>
            </Show>
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
