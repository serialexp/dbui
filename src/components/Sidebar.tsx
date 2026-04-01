// ABOUTME: Left sidebar with two sections: Databases list and Objects browser.
// ABOUTME: Manages working contexts (connected databases) and object navigation.

import { createSignal, Show, onMount } from "solid-js";
import { Icon } from "./Icon";
import type { WorkingContext, Category, MetadataView } from "../lib/types";
import { disconnect, listCategories, switchDatabase } from "../lib/tauri";
import { DatabaseList } from "./DatabaseList";
import { ObjectPanel } from "./ObjectPanel";
import { ConnectDialog } from "./ConnectDialog";
import { ConnectionManager } from "./ConnectionManager";
import { CloudImportModal } from "./CloudImportModal";
import { Toast } from "./Toast";

import gearSvg from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import cloudArrowDownSvg from "@phosphor-icons/core/assets/regular/cloud-arrow-down.svg?raw";

interface Props {
  activeConnectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onDatabaseSwitch: (database: string, schema: string | null) => void;
  onTableSelect: (connectionId: string, database: string, schema: string, table: string) => void;
  onQueryGenerate: (query: string) => void;
  onMetadataSelect: (view: MetadataView) => void;
  onFunctionSelect: (connectionId: string, database: string, schema: string, functionName: string) => void;
  onCategoryColorChange?: (color: string | null) => void;
  onShowProcesses: (ctx: WorkingContext) => void;
  onShowUsers: (ctx: WorkingContext) => void;
}

export function Sidebar(props: Props) {
  const [contexts, setContexts] = createSignal<WorkingContext[]>([]);
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [activeContextId, setActiveContextId] = createSignal<string | null>(null);
  const [showConnectDialog, setShowConnectDialog] = createSignal(false);
  const [showConnectionManager, setShowConnectionManager] = createSignal(false);
  const [showCloudImport, setShowCloudImport] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadCategories = async () => {
    try {
      const cats = await listCategories();
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onMount(() => {
    loadCategories();
  });

  const activeContext = (): WorkingContext | null => {
    const id = activeContextId();
    if (!id) return null;
    return contexts().find((c) => c.id === id) || null;
  };

  const handleContextSelect = async (ctx: WorkingContext) => {
    setActiveContextId(ctx.id);

    try {
      await switchDatabase(ctx.connectionId, ctx.database);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    props.onConnectionChange(ctx.connectionId);
    props.onDatabaseSwitch(ctx.database, ctx.schema || null);
    props.onCategoryColorChange?.(ctx.categoryColor);
  };

  const handleDisconnect = async (ctx: WorkingContext) => {
    const remaining = contexts().filter(
      (c) => c.connectionId === ctx.connectionId && c.id !== ctx.id
    );

    // Only disconnect the backend connection if this is the last context for it
    if (remaining.length === 0) {
      try {
        await disconnect(ctx.connectionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    // Remove only this context
    setContexts((prev) => prev.filter((c) => c.id !== ctx.id));

    // Clear active if it was the removed context
    if (activeContextId() === ctx.id) {
      // Select another context from the same connection if available, otherwise clear
      if (remaining.length > 0) {
        handleContextSelect(remaining[0]);
      } else {
        setActiveContextId(null);
        props.onConnectionChange(null);
        props.onCategoryColorChange?.(null);
      }
    }
  };

  const handleContextsAdded = (newContexts: WorkingContext[]) => {
    setContexts((prev) => [...prev, ...newContexts]);

    // Auto-select the first new context if nothing is selected
    if (!activeContextId() && newContexts.length > 0) {
      handleContextSelect(newContexts[0]);
    }
  };

  const handleConnectionsChange = () => {
    loadCategories();
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Databases</h2>
        <div class="sidebar-header-actions">
          <button
            class="sidebar-icon-btn"
            onClick={() => setShowConnectionManager(true)}
            title="Connection Manager"
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
        </div>
      </div>

      <Show when={error()}>
        <Toast message={error()!} type="error" onDismiss={() => setError(null)} />
      </Show>

      <DatabaseList
        contexts={contexts()}
        categories={categories()}
        activeContextId={activeContextId()}
        onContextSelect={handleContextSelect}
        onDisconnect={handleDisconnect}
        onConnectClick={() => setShowConnectDialog(true)}
        onShowProcesses={props.onShowProcesses}
        onShowUsers={props.onShowUsers}
      />

      <ObjectPanel
        context={activeContext()}
        onTableSelect={props.onTableSelect}
        onFunctionSelect={props.onFunctionSelect}
        onMetadataSelect={props.onMetadataSelect}
        onQueryGenerate={props.onQueryGenerate}
      />

      <Show when={showConnectDialog()}>
        <ConnectDialog
          existingContexts={contexts()}
          onContextsAdded={handleContextsAdded}
          onClose={() => setShowConnectDialog(false)}
        />
      </Show>

      <Show when={showConnectionManager()}>
        <ConnectionManager
          onClose={() => setShowConnectionManager(false)}
          onConnectionsChange={handleConnectionsChange}
        />
      </Show>

      <Show when={showCloudImport()}>
        <CloudImportModal
          categories={categories()}
          onClose={() => setShowCloudImport(false)}
          onSaved={handleConnectionsChange}
        />
      </Show>
    </aside>
  );
}
