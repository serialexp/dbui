// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { createSignal } from "solid-js";
import type { DatabaseType, QueryResult } from "./lib/types";
import { executeQuery, listConnections } from "./lib/tauri";
import { Sidebar } from "./components/Sidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import "./styles/app.css";

function App() {
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [activeDbType, setActiveDbType] = createSignal<DatabaseType | null>(null);
  const [query, setQuery] = createSignal("SELECT 1;");
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

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
  };

  const handleTableSelect = (database: string, schema: string, table: string) => {
    setQuery(`SELECT * FROM ${schema}.${table} LIMIT 100;`);
  };

  const handleExecute = async () => {
    const connId = activeConnectionId();
    if (!connId) {
      setError("No connection selected");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await executeQuery(connId, query());
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
      />
      <main class="main-content">
        <QueryEditor
          value={query()}
          onChange={setQuery}
          onExecute={handleExecute}
          dbType={activeDbType()}
          disabled={!activeConnectionId() || loading()}
        />
        <ResultsTable
          result={result()}
          error={error()}
          loading={loading()}
        />
      </main>
    </div>
  );
}

export default App;
