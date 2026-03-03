// ABOUTME: Modal for managing saved connections and categories.
// ABOUTME: Wraps ConnectionForm and CategoryManager in a tabbed interface.

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icon";
import { ConnectionForm } from "./ConnectionForm";
import { CategoryManager } from "./CategoryManager";
import type { ConnectionConfig, Category } from "../lib/types";
import { listConnections, listCategories, deleteConnection } from "../lib/tauri";

import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import pencilSvg from "@phosphor-icons/core/assets/regular/pencil.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";

type ManagerTab = "connections" | "categories";

interface Props {
  onClose: () => void;
  onConnectionsChange: () => void;
}

export function ConnectionManager(props: Props) {
  const [tab, setTab] = createSignal<ManagerTab>("connections");
  const [connections, setConnections] = createSignal<ConnectionConfig[]>([]);
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [editingConnection, setEditingConnection] = createSignal<ConnectionConfig | null>(null);
  const [showNewForm, setShowNewForm] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadAll = async () => {
    try {
      const [conns, cats] = await Promise.all([
        listConnections(),
        listCategories(),
      ]);
      setConnections(conns);
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onMount(() => {
    loadAll();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingConnection() && !showNewForm()) {
        props.onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const handleDelete = async (conn: ConnectionConfig) => {
    const confirmed = await confirm(`Delete connection "${conn.name}"?`, {
      title: "Confirm Delete",
      kind: "warning",
    });
    if (!confirmed) return;

    try {
      await deleteConnection(conn.id);
      await loadAll();
      props.onConnectionsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaved = async () => {
    await loadAll();
    props.onConnectionsChange();
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

  const getCategoryColor = (categoryId: string | null): string | null => {
    if (!categoryId) return null;
    return categories().find((c) => c.id === categoryId)?.color || null;
  };

  return (
    <>
      <div class="modal-overlay" onClick={() => props.onClose()}>
        <div class="modal connection-manager-modal" onClick={(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2>Connection Manager</h2>
            <button class="modal-close-btn" onClick={() => props.onClose()}>
              <Icon svg={xSvg} size={18} />
            </button>
          </div>

          <div class="manager-tabs">
            <button
              class={`manager-tab ${tab() === "connections" ? "active" : ""}`}
              onClick={() => setTab("connections")}
            >
              Connections
            </button>
            <button
              class={`manager-tab ${tab() === "categories" ? "active" : ""}`}
              onClick={() => setTab("categories")}
            >
              Categories
            </button>
          </div>

          <Show when={error()}>
            <div class="error" style={{ margin: "12px 20px" }}>{error()}</div>
          </Show>

          <Show when={tab() === "connections"}>
            <div class="manager-tab-content">
              <div class="manager-connection-list">
                <For each={connections()}>
                  {(conn) => (
                    <div
                      class="manager-connection-item"
                      style={{
                        "border-left": getCategoryColor(conn.category_id)
                          ? `3px solid ${getCategoryColor(conn.category_id)}`
                          : "3px solid transparent",
                      }}
                    >
                      <img
                        src={getConnectionIcon(conn.db_type)}
                        width={16}
                        height={16}
                        alt={conn.db_type}
                      />
                      <div class="manager-connection-info">
                        <span class="manager-connection-name">{conn.name}</span>
                        <span class="manager-connection-detail">
                          {conn.db_type === "sqlite"
                            ? conn.host
                            : `${conn.host}:${conn.port}`}
                        </span>
                      </div>
                      <div class="manager-connection-actions">
                        <button
                          class="manager-action-btn"
                          onClick={() => setEditingConnection(conn)}
                          title="Edit"
                        >
                          <Icon svg={pencilSvg} size={14} />
                        </button>
                        <button
                          class="manager-action-btn delete"
                          onClick={() => handleDelete(conn)}
                          title="Delete"
                        >
                          <Icon svg={trashSvg} size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={connections().length === 0}>
                  <div class="manager-empty">No saved connections</div>
                </Show>
              </div>
              <div class="manager-footer">
                <button class="manager-add-btn" onClick={() => setShowNewForm(true)}>
                  <Icon svg={plusSvg} size={16} />
                  Add Connection
                </button>
              </div>
            </div>
          </Show>

          <Show when={tab() === "categories"}>
            <div class="manager-categories-embed">
              <CategoryManager
                onClose={() => setTab("connections")}
                onCategoriesChange={() => {
                  loadAll();
                  props.onConnectionsChange();
                }}
              />
            </div>
          </Show>
        </div>
      </div>

      <Show when={showNewForm()}>
        <ConnectionForm
          categories={categories()}
          onClose={() => setShowNewForm(false)}
          onSaved={handleSaved}
        />
      </Show>

      <Show when={editingConnection()}>
        <ConnectionForm
          categories={categories()}
          connection={editingConnection()!}
          onClose={() => setEditingConnection(null)}
          onSaved={handleSaved}
        />
      </Show>
    </>
  );
}
