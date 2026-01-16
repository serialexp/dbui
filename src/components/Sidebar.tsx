// ABOUTME: Left sidebar containing connections and database object tree.
// ABOUTME: Provides connection management and database navigation.

import { createSignal, Show, onMount } from "solid-js";
import { Icon } from "./Icon";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { ConnectionConfig, Category, MetadataView } from "../lib/types";
import { listConnections, deleteConnection, listCategories } from "../lib/tauri";
import { ConnectionForm } from "./ConnectionForm";
import { ObjectTree } from "./ObjectTree";
import { CategoryManager } from "./CategoryManager";
import { CloudImportModal } from "./CloudImportModal";

import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import gearSvg from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import cloudArrowDownSvg from "@phosphor-icons/core/assets/regular/cloud-arrow-down.svg?raw";

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
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [showForm, setShowForm] = createSignal(false);
  const [editingConnection, setEditingConnection] = createSignal<ConnectionConfig | null>(null);
  const [showCategoryManager, setShowCategoryManager] = createSignal(false);
  const [showCloudImport, setShowCloudImport] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadConnections = async () => {
    try {
      const conns = await listConnections();
      setConnections(conns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadCategories = async () => {
    try {
      const cats = await listCategories();
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadAll = async () => {
    await Promise.all([loadConnections(), loadCategories()]);
  };

  onMount(() => {
    loadAll();
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

  const handleEdit = (connection: ConnectionConfig) => {
    setEditingConnection(connection);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingConnection(null);
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Connections</h2>
        <div class="sidebar-header-actions">
          <button
            class="sidebar-icon-btn"
            onClick={() => setShowCategoryManager(true)}
            title="Manage Categories"
          >
            <Icon svg={gearSvg} size={16} />
          </button>
          <button
            class="sidebar-icon-btn"
            onClick={() => setShowCloudImport(true)}
            title="Import from Cloud"
          >
            <Icon svg={cloudArrowDownSvg} size={16} />
          </button>
          <button class="add-btn" onClick={() => setShowForm(true)}>
            <Icon svg={plusSvg} size={16} />
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>

      <ObjectTree
        connections={connections()}
        categories={categories()}
        activeConnectionId={props.activeConnectionId}
        onConnectionChange={props.onConnectionChange}
        onDatabaseSwitch={props.onDatabaseSwitch}
        onTableSelect={props.onTableSelect}
        onQueryGenerate={props.onQueryGenerate}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onMetadataSelect={props.onMetadataSelect}
        onFunctionSelect={props.onFunctionSelect}
      />

      <Show when={showForm() || editingConnection()}>
        <ConnectionForm
          categories={categories()}
          connection={editingConnection() || undefined}
          onClose={handleCloseForm}
          onSaved={loadConnections}
        />
      </Show>

      <Show when={showCategoryManager()}>
        <CategoryManager
          onClose={() => setShowCategoryManager(false)}
          onCategoriesChange={loadAll}
        />
      </Show>

      <Show when={showCloudImport()}>
        <CloudImportModal
          categories={categories()}
          onClose={() => setShowCloudImport(false)}
          onSaved={loadConnections}
        />
      </Show>
    </aside>
  );
}
