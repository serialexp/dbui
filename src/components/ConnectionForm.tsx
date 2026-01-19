// ABOUTME: Modal form for creating and editing database connections.
// ABOUTME: Supports PostgreSQL, MySQL, and SQLite connection configuration.

import { createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import type { DatabaseType, SaveConnectionInput, UpdateConnectionInput, Category, ConnectionConfig } from "../lib/types";
import { saveConnection, updateConnection } from "../lib/tauri";

interface Props {
  categories: Category[];
  connection?: ConnectionConfig;
  onClose: () => void;
  onSaved: () => void;
}

export function ConnectionForm(props: Props) {
  const [name, setName] = createSignal("");
  const [dbType, setDbType] = createSignal<DatabaseType>("postgres");
  const [host, setHost] = createSignal("localhost");
  const [port, setPort] = createSignal(5432);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [database, setDatabase] = createSignal("");
  const [filePath, setFilePath] = createSignal("");
  const [connectionUrl, setConnectionUrl] = createSignal("");
  const [categoryId, setCategoryId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [updatingFromUrl, setUpdatingFromUrl] = createSignal(false);
  const [updatingFromFields, setUpdatingFromFields] = createSignal(false);

  const isEditing = () => !!props.connection;

  onMount(() => {
    if (props.connection) {
      const conn = props.connection;
      setName(conn.name);
      setDbType(conn.db_type);
      setCategoryId(conn.category_id);

      if (conn.db_type === "sqlite") {
        setFilePath(conn.host);
      } else {
        setHost(conn.host);
        setPort(conn.port);
        setUsername(conn.username);
        setPassword(conn.password);
        setDatabase(conn.database || "");
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const parseConnectionUrl = (url: string) => {
    if (!url.trim()) return;

    setUpdatingFromUrl(true);
    try {
      // SQLite: sqlite:/path or just /path or file.db
      if (url.startsWith("sqlite:")) {
        setDbType("sqlite");
        const path = url.replace("sqlite:", "");
        setFilePath(path);

        // Auto-populate connection name with filename if name is empty
        if (!name().trim() && path) {
          const filename = path.split('/').pop()?.replace(/\.db$/i, '') || path;
          if (filename) {
            setName(filename);
          }
        }
        return;
      }

      // Try to parse as URL
      const match = url.match(
        /^(postgres|postgresql|mysql):\/\/(?:([^:@]+)(?::([^@]*))?@)?([^:\/]+)(?::(\d+))?(?:\/(.*))?$/
      );

      if (match) {
        const [, protocol, user, pass, h, p, db] = match;
        const type = protocol === "mysql" ? "mysql" : "postgres";
        setDbType(type);
        setUsername(user || "");
        setPassword(pass || "");
        setHost(h || "localhost");
        setPort(p ? parseInt(p) : type === "mysql" ? 3306 : 5432);
        setDatabase(db || "");

        // Auto-populate connection name with database name if name is empty
        if (!name().trim() && db) {
          setName(db);
        }
      }
    } finally {
      setUpdatingFromUrl(false);
    }
  };

  const buildConnectionUrl = (): string => {
    const type = dbType();

    if (type === "sqlite") {
      const path = filePath();
      return path ? `sqlite:${path}` : "";
    }

    const protocol = type === "mysql" ? "mysql" : "postgres";
    const user = username();
    const pass = password();
    const h = host();
    const p = port();
    const db = database();

    let url = `${protocol}://`;
    if (user) {
      url += user;
      if (pass) {
        url += `:${pass}`;
      }
      url += "@";
    }
    url += h;
    if (p && p !== (type === "mysql" ? 3306 : 5432)) {
      url += `:${p}`;
    }
    if (db) {
      url += `/${db}`;
    }
    return url;
  };

  // Update URL when fields change
  createEffect(() => {
    if (updatingFromUrl()) return;

    // Access all reactive values to track them
    dbType();
    host();
    port();
    username();
    password();
    database();
    filePath();

    setUpdatingFromFields(true);
    setConnectionUrl(buildConnectionUrl());
    setUpdatingFromFields(false);
  });

  // Auto-populate name from database when database changes (and name is empty)
  createEffect(() => {
    if (updatingFromUrl()) return;

    const db = database();
    const path = filePath();

    if (!name().trim()) {
      if (dbType() === "sqlite" && path) {
        const filename = path.split('/').pop()?.replace(/\.db$/i, '') || '';
        if (filename) {
          setName(filename);
        }
      } else if (db) {
        setName(db);
      }
    }
  });

  const handleUrlChange = (url: string) => {
    if (updatingFromFields()) return;
    setConnectionUrl(url);
    parseConnectionUrl(url);
  };

  const handleDbTypeChange = (type: DatabaseType) => {
    setDbType(type);
    if (type === "postgres") {
      setPort(5432);
    } else if (type === "mysql") {
      setPort(3306);
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      if (isEditing()) {
        const input: UpdateConnectionInput = {
          id: props.connection!.id,
          name: name(),
          db_type: dbType(),
          host: dbType() === "sqlite" ? filePath() : host(),
          port: dbType() === "sqlite" ? 0 : port(),
          username: dbType() === "sqlite" ? "" : username(),
          password: dbType() === "sqlite" ? "" : password(),
          database: dbType() === "sqlite" ? null : database() || null,
          category_id: categoryId(),
        };
        await updateConnection(input);
      } else {
        const input: SaveConnectionInput = {
          name: name(),
          db_type: dbType(),
          host: dbType() === "sqlite" ? filePath() : host(),
          port: dbType() === "sqlite" ? 0 : port(),
          username: dbType() === "sqlite" ? "" : username(),
          password: dbType() === "sqlite" ? "" : password(),
          database: dbType() === "sqlite" ? null : database() || null,
          category_id: categoryId(),
        };
        await saveConnection(input);
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const isServerBased = () => dbType() !== "sqlite";

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isEditing() ? "Edit Connection" : "New Connection"}</h2>
        <form onSubmit={handleSubmit}>
          <div class="form-group">
            <label for="name">Connection Name</label>
            <input
              id="name"
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="My Database"
              required
            />
          </div>

          <div class="form-group">
            <label for="connectionUrl">Connection URL</label>
            <input
              id="connectionUrl"
              type="text"
              value={connectionUrl()}
              onInput={(e) => handleUrlChange(e.currentTarget.value)}
              placeholder="postgres://user:pass@localhost:5432/db"
            />
          </div>

          <div class="form-group">
            <label>Database Type</label>
            <div class="radio-group">
              <label>
                <input
                  type="radio"
                  name="dbType"
                  checked={dbType() === "postgres"}
                  onChange={() => handleDbTypeChange("postgres")}
                />
                PostgreSQL
              </label>
              <label>
                <input
                  type="radio"
                  name="dbType"
                  checked={dbType() === "mysql"}
                  onChange={() => handleDbTypeChange("mysql")}
                />
                MySQL
              </label>
              <label>
                <input
                  type="radio"
                  name="dbType"
                  checked={dbType() === "sqlite"}
                  onChange={() => handleDbTypeChange("sqlite")}
                />
                SQLite
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="category">Category</label>
            <Show
              when={props.categories.length > 0}
              fallback={
                <div class="category-hint">
                  No categories yet. Create categories from the sidebar settings to organize your connections.
                </div>
              }
            >
              <div class="category-select-wrapper">
                <select
                  id="category"
                  class="category-select"
                  value={categoryId() || ""}
                  onChange={(e) =>
                    setCategoryId(e.currentTarget.value || null)
                  }
                >
                  <option value="">None</option>
                  <For each={props.categories}>
                    {(cat) => <option value={cat.id}>{cat.name}</option>}
                  </For>
                </select>
                <Show when={categoryId()}>
                  {(() => {
                    const cat = props.categories.find((c) => c.id === categoryId());
                    return cat ? (
                      <div
                        class="category-color-indicator"
                        style={{ "background-color": cat.color }}
                      />
                    ) : null;
                  })()}
                </Show>
              </div>
            </Show>
          </div>

          <Show when={dbType() === "sqlite"}>
            <div class="form-group">
              <label for="filePath">Database File Path</label>
              <input
                id="filePath"
                type="text"
                value={filePath()}
                onInput={(e) => setFilePath(e.currentTarget.value)}
                placeholder="/path/to/database.db"
                required
              />
            </div>
          </Show>

          <Show when={isServerBased()}>
            <div class="form-row">
              <div class="form-group flex-1">
                <label for="host">Host</label>
                <input
                  id="host"
                  type="text"
                  value={host()}
                  onInput={(e) => setHost(e.currentTarget.value)}
                  placeholder="localhost"
                  required
                />
              </div>
              <div class="form-group port-field">
                <label for="port">Port</label>
                <input
                  id="port"
                  type="number"
                  value={port()}
                  onInput={(e) => setPort(parseInt(e.currentTarget.value) || 0)}
                  required
                />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label for="username">Username</label>
                <input
                  id="username"
                  type="text"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                />
              </div>
              <div class="form-group flex-1">
                <label for="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
              </div>
            </div>

            <div class="form-group">
              <label for="database">Database</label>
              <input
                id="database"
                type="text"
                value={database()}
                onInput={(e) => setDatabase(e.currentTarget.value)}
                placeholder="Leave empty to browse all"
              />
            </div>
          </Show>

          {error() && <div class="error">{error()}</div>}

          <div class="form-actions">
            <button type="button" onClick={() => props.onClose()}>
              Cancel
            </button>
            <button type="submit" class="primary" disabled={saving()}>
              {saving() ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
