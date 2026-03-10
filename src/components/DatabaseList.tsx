// ABOUTME: Flat list of connected database working contexts grouped by category.
// ABOUTME: Shows db-type icon, database/schema label, and category color border.

import { For, Show } from "solid-js";
import { Icon } from "./Icon";
import type { WorkingContext, Category } from "../lib/types";

import ejectSvg from "@phosphor-icons/core/assets/regular/eject.svg?raw";
import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import listSvg from "@phosphor-icons/core/assets/regular/list.svg?raw";

interface Props {
  contexts: WorkingContext[];
  categories: Category[];
  activeContextId: string | null;
  onContextSelect: (ctx: WorkingContext) => void;
  onDisconnect: (ctx: WorkingContext) => void;
  onConnectClick: () => void;
  onShowProcesses: (ctx: WorkingContext) => void;
}

interface GroupedContexts {
  category: Category | null;
  contexts: WorkingContext[];
}

export function DatabaseList(props: Props) {
  const getConnectionIcon = (dbType: string) => {
    const iconMap: Record<string, string> = {
      postgres: "/icons/postgresql.svg",
      mysql: "/icons/mysql.svg",
      sqlite: "/icons/sqlite.svg",
      redis: "/icons/redis.svg",
    };
    return iconMap[dbType] || "/icons/postgresql.svg";
  };

  const formatLabel = (ctx: WorkingContext): string => {
    if (ctx.dbType === "sqlite") {
      return ctx.connectionName;
    }
    if (ctx.dbType === "redis") {
      return `${ctx.connectionName} / ${ctx.database}`;
    }
    if (ctx.dbType === "postgres" && ctx.schema) {
      return `${ctx.database} / ${ctx.schema}`;
    }
    return ctx.database;
  };

  const grouped = (): GroupedContexts[] => {
    const categoryMap = new Map<string, Category>();
    for (const cat of props.categories) {
      categoryMap.set(cat.id, cat);
    }

    const groups = new Map<string | null, WorkingContext[]>();

    for (const ctx of props.contexts) {
      const key = ctx.categoryId;
      const existing = groups.get(key) || [];
      existing.push(ctx);
      groups.set(key, existing);
    }

    const result: GroupedContexts[] = [];

    // Categorized groups first (in category order)
    for (const cat of props.categories) {
      const contexts = groups.get(cat.id);
      if (contexts && contexts.length > 0) {
        result.push({ category: cat, contexts });
      }
    }

    // Uncategorized last
    const uncategorized = groups.get(null);
    if (uncategorized && uncategorized.length > 0) {
      result.push({ category: null, contexts: uncategorized });
    }

    return result;
  };

  return (
    <div class="database-list">
      <Show when={props.contexts.length === 0}>
        <div class="database-list-empty">
          No databases connected
        </div>
      </Show>

      <For each={grouped()}>
        {(group) => (
          <div class="db-category-group">
            <Show when={group.category}>
              <div class="db-category-label">
                <div
                  class="db-category-dot"
                  style={{ "background-color": group.category!.color }}
                />
                <span>{group.category!.name}</span>
              </div>
            </Show>
            <For each={group.contexts}>
              {(ctx) => (
                <div
                  class={`db-entry ${props.activeContextId === ctx.id ? "active" : ""}`}
                  style={{
                    "border-left-color": ctx.categoryColor || "transparent",
                  }}
                  onClick={() => props.onContextSelect(ctx)}
                >
                  <img
                    class="db-entry-icon"
                    src={getConnectionIcon(ctx.dbType)}
                    width={14}
                    height={14}
                    alt={ctx.dbType}
                  />
                  <span class="db-entry-label">{formatLabel(ctx)}</span>
                  <div class="db-entry-actions">
                    <Show when={ctx.dbType === "postgres" || ctx.dbType === "mysql"}>
                      <button
                        class="db-entry-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onShowProcesses(ctx);
                        }}
                        title="Show running queries"
                      >
                        <Icon svg={listSvg} size={12} />
                      </button>
                    </Show>
                    <button
                      class="db-entry-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDisconnect(ctx);
                      }}
                      title="Disconnect"
                    >
                      <Icon svg={ejectSvg} size={12} />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </For>

      <button class="connect-btn" onClick={() => props.onConnectClick()}>
        <Icon svg={plusSvg} size={14} />
        <span>Connect</span>
      </button>
    </div>
  );
}
