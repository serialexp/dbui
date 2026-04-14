// ABOUTME: Modal form for creating and editing database connections.
// ABOUTME: Supports PostgreSQL, MySQL, and SQLite connection configuration.

import { createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import type { DatabaseType, SslMode, SaveConnectionInput, UpdateConnectionInput, Category, ConnectionConfig, SshTunnelConfig, SshAuthMethod } from "../lib/types";
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
  const [categoryId, setCategoryId] = createSignal<string | null>(null);
  const [connectionUrl, setConnectionUrl] = createSignal("");
  const [visibleDatabases, setVisibleDatabases] = createSignal<number>(4);
  const [sslMode, setSslMode] = createSignal<SslMode>("disable");
  const [sshEnabled, setSshEnabled] = createSignal(false);
  const [sshHost, setSshHost] = createSignal("");
  const [sshPort, setSshPort] = createSignal(22);
  const [sshUsername, setSshUsername] = createSignal("");
  const [sshAuthType, setSshAuthType] = createSignal<SshAuthMethod["type"]>("agent");
  const [sshKeyPath, setSshKeyPath] = createSignal("");
  const [sshKeyPassphrase, setSshKeyPassphrase] = createSignal("");
  const [sshPassword, setSshPassword] = createSignal("");
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
      setVisibleDatabases(conn.visible_databases ?? 4);
      setSslMode(conn.ssl_mode ?? "disable");

      if (conn.db_type === "sqlite") {
        setFilePath(conn.host);
      } else {
        setHost(conn.host);
        setPort(conn.port);
        setUsername(conn.username);
        setPassword(conn.password);
        setDatabase(conn.database || "");
      }

      if (conn.ssh_tunnel) {
        setSshEnabled(true);
        setSshHost(conn.ssh_tunnel.host);
        setSshPort(conn.ssh_tunnel.port);
        setSshUsername(conn.ssh_tunnel.username);
        setSshAuthType(conn.ssh_tunnel.auth.type);
        if (conn.ssh_tunnel.auth.type === "privatekey") {
          setSshKeyPath(conn.ssh_tunnel.auth.path);
          setSshKeyPassphrase(conn.ssh_tunnel.auth.passphrase ?? "");
        } else if (conn.ssh_tunnel.auth.type === "password") {
          setSshPassword(conn.ssh_tunnel.auth.password);
        }
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
          const filename =
            path.split("/").pop()?.replace(/\.db$/i, "") || path;
          if (filename) {
            setName(filename);
          }
        }
        return;
      }

      // Redis: redis://[user:pass@]host[:port][/db]
      const redisMatch = url.match(
        /^redis:\/\/(?:([^:@]+)(?::([^@]*))?@)?([^:\/]+)(?::(\d+))?(?:\/(\d+))?$/
      );

      if (redisMatch) {
        const [, user, pass, h, p, db] = redisMatch;
        setDbType("redis");
        setUsername(user || "");
        setPassword(pass || "");
        setHost(h || "localhost");
        setPort(p ? parseInt(p) : 6379);
        setDatabase(db || "0");

        // Auto-populate connection name with host if name is empty
        if (!name().trim() && h) {
          setName(`Redis - ${h}`);
        }
        return;
      }

      // Try to parse as SQL URL
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

    if (type === "redis") {
      const user = username();
      const pass = password();
      const h = host();
      const p = port();
      const db = database();

      let url = "redis://";
      if (user || pass) {
        if (user) {
          url += user;
        }
        if (pass) {
          url += `:${pass}`;
        }
        url += "@";
      }
      url += h;
      if (p && p !== 6379) {
        url += `:${p}`;
      }
      if (db && db !== "0") {
        url += `/${db}`;
      }
      return url;
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
        const filename = path.split("/").pop()?.replace(/\.db$/i, "") || "";
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
    } else if (type === "redis") {
      setPort(6379);
    }
  };

  const buildSshConfig = (): SshTunnelConfig | null => {
    if (!sshEnabled() || dbType() === "sqlite") return null;
    let auth: SshAuthMethod;
    if (sshAuthType() === "privatekey") {
      auth = {
        type: "privatekey",
        path: sshKeyPath(),
        passphrase: sshKeyPassphrase() || null,
      };
    } else if (sshAuthType() === "password") {
      auth = { type: "password", password: sshPassword() };
    } else {
      auth = { type: "agent" };
    }
    return {
      host: sshHost(),
      port: sshPort(),
      username: sshUsername(),
      auth,
    };
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const ssh_tunnel = buildSshConfig();
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
          visible_databases: dbType() === "redis" ? visibleDatabases() : null,
          ssl_mode: sslMode(),
          ssh_tunnel,
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
          visible_databases: dbType() === "redis" ? visibleDatabases() : null,
          ssl_mode: sslMode(),
          ssh_tunnel,
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
  const isRedis = () => dbType() === "redis";

  const selectedCategory = () =>
    props.categories.find((c) => c.id === categoryId());

  return (
    <div class="modal-overlay">
      <div class="modal">
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

          <Show when={!isEditing()}>
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
          </Show>

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
              <label>
                <input
                  type="radio"
                  name="dbType"
                  checked={dbType() === "redis"}
                  onChange={() => handleDbTypeChange("redis")}
                />
                Redis
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
                  onInput={(e) =>
                    setPort(parseInt(e.currentTarget.value) || 0)
                  }
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

            <Show when={!isRedis()}>
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

            <Show when={!isRedis()}>
              <div class="form-group">
                <label>SSL Mode</label>
                <div class="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="sslMode"
                      checked={sslMode() === "disable"}
                      onChange={() => setSslMode("disable")}
                    />
                    Disable
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="sslMode"
                      checked={sslMode() === "prefer"}
                      onChange={() => setSslMode("prefer")}
                    />
                    Prefer
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="sslMode"
                      checked={sslMode() === "require"}
                      onChange={() => setSslMode("require")}
                    />
                    Require
                  </label>
                </div>
              </div>
            </Show>

            <div class="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={sshEnabled()}
                  onChange={(e) => setSshEnabled(e.currentTarget.checked)}
                />
                {" "}Connect via SSH tunnel
              </label>
            </div>

            <Show when={sshEnabled()}>
              <div class="ssh-tunnel-section" style={{ "border-left": "2px solid var(--border, #444)", "padding-left": "12px", "margin-bottom": "12px" }}>
                <div class="form-row">
                  <div class="form-group flex-1">
                    <label for="sshHost">SSH Host</label>
                    <input
                      id="sshHost"
                      type="text"
                      value={sshHost()}
                      onInput={(e) => setSshHost(e.currentTarget.value)}
                      placeholder="bastion.example.com"
                      required
                    />
                  </div>
                  <div class="form-group port-field">
                    <label for="sshPort">Port</label>
                    <input
                      id="sshPort"
                      type="number"
                      value={sshPort()}
                      onInput={(e) => setSshPort(parseInt(e.currentTarget.value) || 22)}
                      required
                    />
                  </div>
                </div>

                <div class="form-group">
                  <label for="sshUsername">SSH Username</label>
                  <input
                    id="sshUsername"
                    type="text"
                    value={sshUsername()}
                    onInput={(e) => setSshUsername(e.currentTarget.value)}
                    required
                  />
                </div>

                <div class="form-group">
                  <label>SSH Authentication</label>
                  <div class="radio-group">
                    <label>
                      <input
                        type="radio"
                        name="sshAuthType"
                        checked={sshAuthType() === "agent"}
                        onChange={() => setSshAuthType("agent")}
                      />
                      SSH Agent
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="sshAuthType"
                        checked={sshAuthType() === "privatekey"}
                        onChange={() => setSshAuthType("privatekey")}
                      />
                      Private Key
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="sshAuthType"
                        checked={sshAuthType() === "password"}
                        onChange={() => setSshAuthType("password")}
                      />
                      Password
                    </label>
                  </div>
                </div>

                <Show when={sshAuthType() === "privatekey"}>
                  <div class="form-group">
                    <label for="sshKeyPath">Private Key Path</label>
                    <input
                      id="sshKeyPath"
                      type="text"
                      value={sshKeyPath()}
                      onInput={(e) => setSshKeyPath(e.currentTarget.value)}
                      placeholder="~/.ssh/id_ed25519"
                      required
                    />
                  </div>
                  <div class="form-group">
                    <label for="sshKeyPassphrase">Key Passphrase (optional)</label>
                    <input
                      id="sshKeyPassphrase"
                      type="password"
                      value={sshKeyPassphrase()}
                      onInput={(e) => setSshKeyPassphrase(e.currentTarget.value)}
                    />
                  </div>
                </Show>

                <Show when={sshAuthType() === "password"}>
                  <div class="form-group">
                    <label for="sshPassword">SSH Password</label>
                    <input
                      id="sshPassword"
                      type="password"
                      value={sshPassword()}
                      onInput={(e) => setSshPassword(e.currentTarget.value)}
                      required
                    />
                  </div>
                </Show>

                <Show when={sshAuthType() === "agent"}>
                  <div class="field-hint">Uses SSH_AUTH_SOCK (Unix) or the OpenSSH / Pageant agent (Windows).</div>
                </Show>
              </div>
            </Show>

            <Show when={isRedis()}>
              <div class="form-group">
                <label for="visibleDatabases">Visible Databases</label>
                <input
                  id="visibleDatabases"
                  type="number"
                  min="1"
                  max="16"
                  value={visibleDatabases()}
                  onInput={(e) => setVisibleDatabases(parseInt(e.currentTarget.value) || 4)}
                />
                <span class="field-hint">Number of Redis databases to show (1-16)</span>
              </div>
            </Show>
          </Show>

          {error() && <div class="error">{error()}</div>}

          <div class="form-actions">
            <button type="button" onClick={() => props.onClose()}>
              Cancel
            </button>
            <button type="submit" class="primary" disabled={saving()}>
              {saving() ? "Saving..." : isEditing() ? "Update" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
