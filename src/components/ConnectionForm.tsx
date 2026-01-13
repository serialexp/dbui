// ABOUTME: Modal form for creating and editing database connections.
// ABOUTME: Supports PostgreSQL and MySQL connection configuration.

import { createSignal } from "solid-js";
import type { DatabaseType, SaveConnectionInput } from "../lib/types";
import { saveConnection } from "../lib/tauri";

interface Props {
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
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const handleDbTypeChange = (type: DatabaseType) => {
    setDbType(type);
    setPort(type === "postgres" ? 5432 : 3306);
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const input: SaveConnectionInput = {
        name: name(),
        db_type: dbType(),
        host: host(),
        port: port(),
        username: username(),
        password: password(),
        database: database() || null,
      };
      await saveConnection(input);
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Connection</h2>
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
            </div>
          </div>

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
                required
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
            <label for="database">Database (optional)</label>
            <input
              id="database"
              type="text"
              value={database()}
              onInput={(e) => setDatabase(e.currentTarget.value)}
              placeholder="Leave empty to browse all"
            />
          </div>

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
