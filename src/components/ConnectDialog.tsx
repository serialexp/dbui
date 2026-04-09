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
  saveLastSelected,
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
  const [loadingStatus, setLoadingStatus] = createSignal<string>("Connecting...");
  const [error, setError] = createSignal<string | null>(null);
  const [selectedDatabase, setSelectedDatabase] = createSignal<string | null>(null);
  const [schemasFetched, setSchemasFetched] = createSignal<string[]>([]);
  const [loadingSchemas, setLoadingSchemas] = createSignal(false);

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

  const getLastSelected = (conn: ConnectionConfig): { database: string; schema: string }[] => {
    return conn.last_selected ?? [];
  };

  const handlePickConnection = async (conn: ConnectionConfig) => {
    setSelectedConnection(conn);
    setLoading(true);
    setError(null);

    try {
      setLoadingStatus(`Connecting to ${conn.name}...`);
      await connect(conn.id);
      setLoadingStatus("Listing databases...");
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
            checked: false,
            alreadyExists: props.existingContexts.some((c) => c.id === id),
          });
        }
      } else if (conn.db_type === "postgres") {
        // Postgres: just list databases now, schemas are fetched lazily
        // when the user selects a database in the picker.
        for (const db of databases) {
          discovered.push({
            database: db,
            schema: "",
            checked: false,
            alreadyExists: false,
          });
        }
        setSchemasFetched([]);
      } else {
        // MySQL: each database is a context, no schemas
        for (const db of databases) {
          const id = makeContextId(conn.id, db, "");
          discovered.push({
            database: db,
            schema: "",
            checked: false,
            alreadyExists: props.existingContexts.some((c) => c.id === id),
          });
        }
      }

      const lastSelected = getLastSelected(conn);

      if (conn.db_type === "postgres" && lastSelected.length > 0) {
        // For Postgres, auto-fetch schemas for databases that had previous selections
        setEntries(discovered);
        setStep("select");

        const dbsToFetch = [...new Set(lastSelected.map((s) => s.database))]
          .filter((db) => discovered.some((e) => e.database === db));

        // Select the first previously-used database in the left column
        if (dbsToFetch.length > 0) {
          setSelectedDatabase(dbsToFetch[0]);
        } else {
          setSelectedDatabase(null);
        }

        // Fetch schemas for all previously-used databases, then pre-check
        for (const db of dbsToFetch) {
          try {
            await switchDatabase(conn.id, db);
            const schemas = await listSchemas(conn.id, db);
            setEntries((prev) => {
              const without = prev.filter((e) => e.database !== db || e.schema !== "");
              const newEntries: DiscoveredEntry[] = schemas.map((schema) => {
                const id = makeContextId(conn.id, db, schema);
                const alreadyExists = props.existingContexts.some((c) => c.id === id);
                const wasSelected = lastSelected.some((s) => s.database === db && s.schema === schema);
                return {
                  database: db,
                  schema,
                  checked: wasSelected && !alreadyExists,
                  alreadyExists,
                };
              });
              return [...without, ...newEntries];
            });
            setSchemasFetched((prev) => [...prev, db]);
          } catch {
            setEntries((prev) => prev.filter((e) => e.database !== db));
          }
        }
      } else {
        // Non-Postgres or no previous selections: mark previously selected entries
        if (lastSelected.length > 0) {
          for (const entry of discovered) {
            if (!entry.alreadyExists) {
              entry.checked = lastSelected.some(
                (s) => s.database === entry.database && s.schema === entry.schema
              );
            }
          }
        }
        setEntries(discovered);
        if (conn.db_type !== "postgres") {
          setSelectedDatabase(discovered.length > 0 ? discovered[0].database : null);
        } else {
          setSelectedDatabase(null);
        }
        setStep("select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const selectDatabase = async (db: string) => {
    setSelectedDatabase(db);
    const conn = selectedConnection();
    if (!conn || conn.db_type !== "postgres") return;
    if (schemasFetched().includes(db)) return;

    setLoadingSchemas(true);
    try {
      await switchDatabase(conn.id, db);
      const schemas = await listSchemas(conn.id, db);

      // Remove the placeholder entry for this database,
      // replace with real schema entries.
      setEntries((prev) => {
        const without = prev.filter((e) => e.database !== db || e.schema !== "");
        const newEntries: DiscoveredEntry[] = schemas.map((schema) => {
          const id = makeContextId(conn.id, db, schema);
          return {
            database: db,
            schema,
            checked: false,
            alreadyExists: props.existingContexts.some((c) => c.id === id),
          };
        });
        return [...without, ...newEntries];
      });
      setSchemasFetched((prev) => [...prev, db]);
    } catch {
      // Database not accessible — remove its placeholder
      setEntries((prev) => prev.filter((e) => e.database !== db));
    } finally {
      setLoadingSchemas(false);
    }
  };

  const toggleEntry = (index: number) => {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === index && !e.alreadyExists ? { ...e, checked: !e.checked } : e,
      ),
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

    // Remember selections for next time (include already-connected ones)
    const allActive = [
      ...selected.map((e) => ({ database: e.database, schema: e.schema })),
      ...props.existingContexts
        .filter((c) => c.connectionId === conn.id)
        .map((c) => ({ database: c.database, schema: c.schema })),
    ];
    saveLastSelected(conn.id, allActive).catch(() => {});

    props.onContextsAdded(contexts);
    props.onClose();
  };

  const checkedCount = () => entries().filter((e) => e.checked && !e.alreadyExists).length;

  /** Unique database names in discovery order. */
  const databaseList = () => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const e of entries()) {
      if (!seen.has(e.database)) {
        seen.add(e.database);
        result.push(e.database);
      }
    }
    return result;
  };

  /** Schemas for the currently selected database (excludes placeholders). */
  const schemasForSelected = () => {
    const db = selectedDatabase();
    if (!db) return [];
    return entries()
      .map((e, i) => ({ entry: e, index: i }))
      .filter(({ entry }) => entry.database === db && (entry.schema !== "" || !hasSchemas()));
  };

  /** All currently checked entries (for the selection summary). */
  const checkedEntries = () => entries().filter((e) => e.checked && !e.alreadyExists);

  /** Whether a database has any schema selected. */
  const hasCheckedSchema = (database: string) =>
    entries().some((e) => e.database === database && e.checked);

  /** Whether the connection type uses schemas (Postgres). */
  const hasSchemas = () => selectedConnection()?.db_type === "postgres";

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
          <div class="connect-dialog-loading">{loadingStatus()}</div>
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
            <div class="connect-dialog-picker" classList={{ "single-column": !hasSchemas() }}>
              <Show when={hasSchemas()} fallback={
                /* Single column for MySQL/SQLite/Redis: click to toggle */
                <div class="connect-dialog-picker-col">
                  <div class="connect-dialog-picker-label">Databases</div>
                  <div class="connect-dialog-picker-list">
                    <For each={entries().map((e, i) => ({ entry: e, index: i }))}>
                      {({ entry, index }) => (
                        <div
                          class="connect-dialog-picker-item"
                          classList={{
                            checked: entry.checked,
                            disabled: entry.alreadyExists,
                          }}
                          onClick={() => !entry.alreadyExists && toggleEntry(index)}
                        >
                          <span>{entry.database}</span>
                          <Show when={entry.alreadyExists}>
                            <span class="connect-dialog-already">connected</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              }>
                {/* Left column: databases */}
                <div class="connect-dialog-picker-col">
                  <div class="connect-dialog-picker-label">Databases</div>
                  <div class="connect-dialog-picker-list">
                    <For each={databaseList()}>
                      {(db) => (
                        <div
                          class="connect-dialog-picker-item"
                          classList={{
                            active: selectedDatabase() === db,
                            "has-checked": hasCheckedSchema(db),
                          }}
                          onClick={() => selectDatabase(db)}
                        >
                          <span>{db}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                {/* Right column: schemas for selected database */}
                <div class="connect-dialog-picker-col">
                  <div class="connect-dialog-picker-label">
                    Schemas
                    <Show when={selectedDatabase() && schemasForSelected().some(({ entry }) => !entry.alreadyExists)}>
                      <button
                        class="connect-dialog-select-all"
                        onClick={() => {
                          const items = schemasForSelected();
                          const allCheckable = items.filter(({ entry }) => !entry.alreadyExists);
                          const allChecked = allCheckable.every(({ entry }) => entry.checked);
                          setEntries((prev) =>
                            prev.map((e, i) => {
                              const match = items.find(({ index }) => index === i);
                              if (match && !e.alreadyExists) {
                                return { ...e, checked: !allChecked };
                              }
                              return e;
                            })
                          );
                        }}
                      >
                        {schemasForSelected().filter(({ entry }) => !entry.alreadyExists).every(({ entry }) => entry.checked)
                          ? "Deselect all"
                          : "Select all"}
                      </button>
                    </Show>
                  </div>
                  <div class="connect-dialog-picker-list">
                    <Show when={selectedDatabase()} fallback={
                      <div class="connect-dialog-empty">Select a database</div>
                    }>
                      <Show when={loadingSchemas()}>
                        <div class="connect-dialog-loading">Loading schemas...</div>
                      </Show>
                      <For each={schemasForSelected()}>
                        {({ entry, index }) => (
                          <div
                            class="connect-dialog-picker-item"
                            classList={{
                              checked: entry.checked,
                              disabled: entry.alreadyExists,
                            }}
                            onClick={() => !entry.alreadyExists && toggleEntry(index)}
                          >
                            <span>{entry.schema}</span>
                            <Show when={entry.alreadyExists}>
                              <span class="connect-dialog-already">connected</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>

            {/* Selected combinations summary */}
            <Show when={checkedEntries().length > 0}>
              <div class="connect-dialog-selection-summary">
                <div class="connect-dialog-picker-label">
                  Selected ({checkedEntries().length})
                </div>
                <div class="connect-dialog-selection-list">
                  <For each={checkedEntries()}>
                    {(entry) => (
                      <span class="connect-dialog-selection-tag">
                        {hasSchemas()
                          ? `${entry.database} / ${entry.schema}`
                          : entry.database}
                        <button
                          class="connect-dialog-selection-remove"
                          onClick={() => {
                            const idx = entries().indexOf(entry);
                            if (idx !== -1) toggleEntry(idx);
                          }}
                        >
                          <Icon svg={xSvg} size={10} />
                        </button>
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
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
