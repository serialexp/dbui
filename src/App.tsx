// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { createSignal, Show } from "solid-js";
import type { DatabaseType, QueryResult, CellSelection, MetadataView } from "./lib/types";
import { executeQuery, listConnections } from "./lib/tauri";
import { Sidebar } from "./components/Sidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import { CellInspector } from "./components/CellInspector";
import { MetadataTable } from "./components/MetadataTable";
import "./styles/app.css";

function App() {
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [activeDbType, setActiveDbType] = createSignal<DatabaseType | null>(null);
  const [query, setQuery] = createSignal("SELECT 1;");
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selectedCell, setSelectedCell] = createSignal<CellSelection | null>(null);
  const [metadataView, setMetadataView] = createSignal<MetadataView>(null);
  const [selectedMetadataRow, setSelectedMetadataRow] = createSignal<number | null>(null);

  const handleConnectionChange = async (id: string | null) => {
    setActiveConnectionId(id);
    if (id) {
      const connections = await listConnections();
      const conn = connections.find((c) => c.id === id);
      if (conn) {
        setActiveDbType(conn.db_type);
      }
    } else {
      setActiveDbType(null);
    }
    setResult(null);
    setError(null);
    setSelectedCell(null);
    setMetadataView(null);
  };

  const handleTableSelect = async (database: string, schema: string, table: string) => {
    const newQuery = `SELECT * FROM ${schema}.${table} LIMIT 100;`;
    setQuery(newQuery);
    setMetadataView(null);
    await handleExecute(newQuery);
  };

  const handleQueryGenerate = (query: string) => {
    setQuery(query);
  };

  const handleMetadataSelect = (view: MetadataView) => {
    setMetadataView(view);
    setSelectedMetadataRow(null);
    setSelectedCell(null);
  };

  const handleMetadataRowSelect = (rowIndex: number) => {
    setSelectedMetadataRow(rowIndex);
  };

  const handleMetadataClose = () => {
    setMetadataView(null);
    setSelectedMetadataRow(null);
  };

  const handleExecute = async (queryToExecute: string) => {
    const connId = activeConnectionId();
    if (!connId) {
      setError("No connection selected");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedCell(null);
    setMetadataView(null);

    try {
      const res = await executeQuery(connId, queryToExecute);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="app">
      <Sidebar
        activeConnectionId={activeConnectionId()}
        onConnectionChange={handleConnectionChange}
        onTableSelect={handleTableSelect}
        onQueryGenerate={handleQueryGenerate}
        onMetadataSelect={handleMetadataSelect}
      />
      <main class="main-content">
        <Show when={!metadataView()}>
          <QueryEditor
            value={query()}
            onChange={setQuery}
            onExecute={handleExecute}
            dbType={activeDbType()}
            disabled={!activeConnectionId() || loading()}
          />
        </Show>

        <Show when={metadataView()}>
          <MetadataTable
            view={metadataView()!}
            selectedRow={selectedMetadataRow()}
            onRowSelect={handleMetadataRowSelect}
            onClose={handleMetadataClose}
            dbType={activeDbType()}
          />
        </Show>

        <Show when={!metadataView()}>
          <div class="results-area">
            <div class="results-table-wrapper">
              <ResultsTable
                result={result()}
                error={error()}
                loading={loading()}
                selectedCell={selectedCell()}
                onCellSelect={setSelectedCell}
              />
            </div>
            <CellInspector
              selection={selectedCell()}
              onClose={() => setSelectedCell(null)}
            />
          </div>
        </Show>
      </main>
    </div>
  );
}

export default App;
