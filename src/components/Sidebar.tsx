// ABOUTME: Left sidebar containing connections and database object tree.
// ABOUTME: Provides connection management and database navigation.

import { createSignal, Show, onMount } from "solid-js";
import type { ConnectionConfig } from "../lib/types";
import { listConnections, deleteConnection } from "../lib/tauri";
import { ConnectionForm } from "./ConnectionForm";
import { ObjectTree } from "./ObjectTree";

interface Props {
  activeConnectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onTableSelect: (database: string, schema: string, table: string) => void;
}

export function Sidebar(props: Props) {
  const [connections, setConnections] = createSignal<ConnectionConfig[]>([]);
  const [showForm, setShowForm] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadConnections = async () => {
    try {
      const conns = await listConnections();
      setConnections(conns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onMount(() => {
    loadConnections();
  });

  const handleDelete = async (id: string, e: Event) => {
    e.stopPropagation();
    if (!confirm("Delete this connection?")) return;

    try {
      await deleteConnection(id);
      await loadConnections();
      if (props.activeConnectionId === id) {
        props.onConnectionChange(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Connections</h2>
        <button class="add-btn" onClick={() => setShowForm(true)}>
          +
        </button>
      </div>

      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>

      <ObjectTree
        connections={connections()}
        activeConnectionId={props.activeConnectionId}
        onConnectionChange={props.onConnectionChange}
        onTableSelect={props.onTableSelect}
      />

      <Show when={showForm()}>
        <ConnectionForm
          onClose={() => setShowForm(false)}
          onSaved={loadConnections}
        />
      </Show>
    </aside>
  );
}
