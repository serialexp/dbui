// ABOUTME: Two-step dialog for connecting to a saved database connection.
// ABOUTME: Step 1: Pick a saved connection. Step 2: Select databases/schemas to add as working contexts.

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import type { ConnectionConfig, Category, WorkingContext, DatabaseType } from "../lib/types";
import {
  listConnections,
  listCategories,
  connect,
  listDatabases,
  listSchemas,
  switchDatabase,
} from "../lib/tauri";

import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import arrowLeftSvg from "@phosphor-icons/core/assets/regular/arrow-left.svg?raw";

interface Props {
  existingContexts: WorkingContext[];
  onContextsAdded: (contexts: WorkingContext[]) => void;
  onClose: () => void;
}

interface DiscoveredEntry {
  database: string;
  schema: string;
  checked: boolean;
  alreadyExists: boolean;
}

export function ConnectDialog(props: Props) {
  const [connections, setConnections] = createSignal<ConnectionConfig[]>([]);
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [step, setStep] = createSignal<"pick" | "select">("pick");
  const [selectedConnection, setSelectedConnection] = createSignal<ConnectionConfig | null>(null);
  const [entries, setEntries] = createSignal<DiscoveredEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const getConnectionIcon = (dbType: string) => {
    const iconMap: Record<string, string> = {
      postgres: "/icons/postgresql.svg",
      mysql: "/icons/mysql.svg",
      sqlite: "/icons/sqlite.svg",
      redis: "/icons/redis.svg",
    };
    return iconMap[dbType] || "/icons/postgresql.svg";
  };

  const getCategoryForConnection = (conn: ConnectionConfig): Category | undefined => {
    if (!conn.category_id) return undefined;
    return categories().find((c) => c.id === conn.category_id);
  };

  const makeContextId = (connectionId: string, database: string, schema: string): string => {
    return `${connectionId}:${database}:${schema}`;
  };

  const handlePickConnection = async (conn: ConnectionConfig) => {
    setSelectedConnection(conn);
    setLoading(true);
    setError(null);

    try {
      await connect(conn.id);
      const databases = await listDatabases(conn.id);

      const discovered: DiscoveredEntry[] = [];

      if (conn.db_type === "sqlite") {
        // SQLite: single database, schema "main"
        const db = databases[0] || "main";
        const id = makeContextId(conn.id, db, "main");
        discovered.push({
          database: db,
          schema: "main",
          checked: !props.existingContexts.some((c) => c.id === id),
          alreadyExists: props.existingContexts.some((c) => c.id === id),
        });
      } else if (conn.db_type === "redis") {
        // Redis: each database index is a context
        const visibleCount = conn.visible_databases ?? 4;
        const visibleDbs = databases.slice(0, visibleCount);
        for (const db of visibleDbs) {
          const id = makeContextId(conn.id, db, "");
          discovered.push({
            database: db,
            schema: "",
            checked: !props.existingContexts.some((c) => c.id === id),
            alreadyExists: props.existingContexts.some((c) => c.id === id),
          });
        }
      } else if (conn.db_type === "postgres") {
        // Postgres: discover schemas per database.
        // Must switch database before listing schemas since the backend
        // queries information_schema on the currently connected database.
        for (const db of databases) {
          try {
            await switchDatabase(conn.id, db);
            const schemas = await listSchemas(conn.id, db);
            for (const schema of schemas) {
              const id = makeContextId(conn.id, db, schema);
              discovered.push({
                database: db,
                schema,
                checked: !props.existingContexts.some((c) => c.id === id),
                alreadyExists: props.existingContexts.some((c) => c.id === id),
              });
            }
          } catch {
            // Skip databases we can't connect to
          }
        }
      } else {
        // MySQL: each database is a context, no schemas
        for (const db of databases) {
          const id = makeContextId(conn.id, db, "");
          discovered.push({
            database: db,
            schema: "",
            checked: !props.existingContexts.some((c) => c.id === id),
            alreadyExists: props.existingContexts.some((c) => c.id === id),
          });
        }
      }

      setEntries(discovered);
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleEntry = (index: number) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === index && !e.alreadyExists ? { ...e, checked: !e.checked } : e,
      ),
    );
  };

  const toggleAll = (checked: boolean) => {
    setEntries((prev) =>
      prev.map((e) => (e.alreadyExists ? e : { ...e, checked })),
    );
  };

  const handleConfirm = () => {
    const conn = selectedConnection();
    if (!conn) return;

    const category = getCategoryForConnection(conn);
    const selected = entries().filter((e) => e.checked && !e.alreadyExists);

    const contexts: WorkingContext[] = selected.map((e) => ({
      id: makeContextId(conn.id, e.database, e.schema),
      connectionId: conn.id,
      connectionName: conn.name,
      dbType: conn.db_type as DatabaseType,
      database: e.database,
      schema: e.schema,
      categoryId: conn.category_id,
      categoryColor: category?.color || null,
    }));

    props.onContextsAdded(contexts);
    props.onClose();
  };

  const checkedCount = () => entries().filter((e) => e.checked && !e.alreadyExists).length;

  const entriesByDatabase = (): { database: string; entries: { entry: DiscoveredEntry; index: number }[] }[] => {
    const map = new Map<string, { entry: DiscoveredEntry; index: number }[]>();
    const order: string[] = [];

    entries().forEach((entry, index) => {
      if (!map.has(entry.database)) {
        map.set(entry.database, []);
        order.push(entry.database);
      }
      map.get(entry.database)!.push({ entry, index });
    });

    return order.map((db) => ({ database: db, entries: map.get(db)! }));
  };

  const isDbFullyChecked = (dbEntries: { entry: DiscoveredEntry }[]): boolean => {
    return dbEntries.every((e) => e.entry.checked || e.entry.alreadyExists);
  };

  const toggleDatabase = (database: string, checked: boolean) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.database === database && !e.alreadyExists ? { ...e, checked } : e,
      ),
    );
  };

  const groupedConnections = () => {
    const categoryMap = new Map<string, Category>();
    for (const cat of categories()) {
      categoryMap.set(cat.id, cat);
    }

    const groups: { category: Category | null; connections: ConnectionConfig[] }[] = [];
    const byCategory = new Map<string | null, ConnectionConfig[]>();

    for (const conn of connections()) {
      const key = conn.category_id;
      const existing = byCategory.get(key) || [];
      existing.push(conn);
      byCategory.set(key, existing);
    }

    for (const cat of categories()) {
      const conns = byCategory.get(cat.id);
      if (conns && conns.length > 0) {
        groups.push({ category: cat, connections: conns });
      }
    }

    const uncategorized = byCategory.get(null);
    if (uncategorized && uncategorized.length > 0) {
      groups.push({ category: null, connections: uncategorized });
    }

    return groups;
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal connect-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <div class="connect-dialog-title">
            <Show when={step() === "select"}>
              <button class="connect-dialog-back" onClick={() => setStep("pick")}>
                <Icon svg={arrowLeftSvg} size={16} />
              </button>
            </Show>
            <h2>{step() === "pick" ? "Connect to Database" : `Select Databases`}</h2>
          </div>
          <button class="modal-close-btn" onClick={() => props.onClose()}>
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <Show when={error()}>
          <div class="connect-dialog-error">{error()}</div>
        </Show>

        <Show when={loading()}>
          <div class="connect-dialog-loading">Connecting...</div>
        </Show>

        {/* Step 1: Pick a connection */}
        <Show when={step() === "pick" && !loading()}>
          <div class="connect-dialog-list">
            <Show when={connections().length === 0}>
              <div class="connect-dialog-empty">
                No saved connections. Create one in the Connection Manager.
              </div>
            </Show>
            <For each={groupedConnections()}>
              {(group) => (
                <>
                  <Show when={group.category}>
                    <div class="connect-dialog-category">
                      <div
                        class="db-category-dot"
                        style={{ "background-color": group.category!.color }}
                      />
                      <span>{group.category!.name}</span>
                    </div>
                  </Show>
                  <For each={group.connections}>
                    {(conn) => (
                      <div
                        class="connect-dialog-entry"
                        onClick={() => handlePickConnection(conn)}
                      >
                        <img
                          src={getConnectionIcon(conn.db_type)}
                          width={18}
                          height={18}
                          alt={conn.db_type}
                        />
                        <div class="connect-dialog-entry-info">
                          <span class="connect-dialog-entry-name">{conn.name}</span>
                          <span class="connect-dialog-entry-detail">
                            {conn.db_type === "sqlite"
                              ? conn.host
                              : `${conn.host}:${conn.port}`}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </div>
        </Show>

        {/* Step 2: Select databases/schemas */}
        <Show when={step() === "select" && !loading()}>
          <div class="connect-dialog-select">
            <div class="connect-dialog-select-header">
              <label class="connect-dialog-select-all">
                <input
                  type="checkbox"
                  checked={entries().every((e) => e.checked || e.alreadyExists)}
                  onChange={(e) => toggleAll(e.currentTarget.checked)}
                />
                Select all
              </label>
              <span class="connect-dialog-select-count">
                {checkedCount()} selected
              </span>
            </div>
            <div class="connect-dialog-entries">
              <For each={entriesByDatabase()}>
                {(group) => (
                  <div class="connect-dialog-db-group">
                    <div class="connect-dialog-db-header">
                      <span class="connect-dialog-db-name">{group.database}</span>
                      <button
                        class="connect-dialog-db-toggle"
                        onClick={() => toggleDatabase(group.database, !isDbFullyChecked(group.entries))}
                      >
                        {isDbFullyChecked(group.entries) ? "deselect all" : "select all"}
                      </button>
                    </div>
                    <div class="connect-dialog-schema-row">
                      <For each={group.entries}>
                        {({ entry, index }) => (
                          <label
                            class={`connect-dialog-schema-check ${entry.alreadyExists ? "disabled" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={entry.checked}
                              disabled={entry.alreadyExists}
                              onChange={() => toggleEntry(index)}
                            />
                            <span>{entry.schema || entry.database}</span>
                            <Show when={entry.alreadyExists}>
                              <span class="connect-dialog-already">connected</span>
                            </Show>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div class="connect-dialog-actions">
            <button onClick={() => props.onClose()}>Cancel</button>
            <button
              class="primary"
              onClick={handleConfirm}
              disabled={checkedCount() === 0}
            >
              Add {checkedCount()} database{checkedCount() !== 1 ? "s" : ""}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
