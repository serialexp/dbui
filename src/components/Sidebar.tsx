// ABOUTME: Left sidebar containing connections and database object tree.
// ABOUTME: Provides connection management and database navigation.

import { createSignal, Show, onMount } from "solid-js";
import { Icon } from "./Icon";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig, MetadataView } from "../lib/types";
import { listConnections, deleteConnection } from "../lib/tauri";
import { ConnectionForm } from "./ConnectionForm";
import { ObjectTree } from "./ObjectTree";

import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";

interface Props {
  activeConnectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onDatabaseSwitch: (database: string, schema: string | null) => void;
  onTableSelect: (database: string, schema: string, table: string) => void;
  onQueryGenerate: (query: string) => void;
  onMetadataSelect: (view: MetadataView) => void;
  onFunctionSelect: (connectionId: string, database: string, schema: string, functionName: string) => void;
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
    console.log("handleDelete called with id:", id);
    e.stopPropagation();

    const confirmed = await confirm("Delete this connection?", {
      title: "Confirm Delete",
      kind: "warning",
    });

    if (!confirmed) return;

    try {
      console.log("Deleting connection:", id);
      await deleteConnection(id);
      console.log("Reloading connections");
      await loadConnections();
      if (props.activeConnectionId === id) {
        props.onConnectionChange(null);
      }
    } catch (err) {
      console.error("Delete error:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Connections</h2>
        <button class="add-btn" onClick={() => setShowForm(true)}>
          <Icon svg={plusSvg} size={16} />
        </button>
      </div>

      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>

      <ObjectTree
        connections={connections()}
        activeConnectionId={props.activeConnectionId}
        onConnectionChange={props.onConnectionChange}
        onDatabaseSwitch={props.onDatabaseSwitch}
        onTableSelect={props.onTableSelect}
        onQueryGenerate={props.onQueryGenerate}
        onDelete={handleDelete}
        onMetadataSelect={props.onMetadataSelect}
        onFunctionSelect={props.onFunctionSelect}
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
