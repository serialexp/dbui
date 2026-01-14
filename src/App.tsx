// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { createSignal, Show } from "solid-js";
import type { DatabaseType, QueryResult, CellSelection, MetadataView, FunctionInfo } from "./lib/types";
import { executeQuery, listConnections, getFunctionDefinition } from "./lib/tauri";
import { Sidebar } from "./components/Sidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import { CellInspector } from "./components/CellInspector";
import { MetadataTable } from "./components/MetadataTable";
import { FunctionViewer } from "./components/FunctionViewer";
import { ConnectionPath } from "./components/ConnectionPath";
import "./styles/app.css";

function App() {
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [activeConnectionName, setActiveConnectionName] = createSignal<string | null>(null);
  const [activeDbType, setActiveDbType] = createSignal<DatabaseType | null>(null);
  const [activeDatabase, setActiveDatabase] = createSignal<string | null>(null);
  const [activeSchema, setActiveSchema] = createSignal<string | null>(null);
  const [activeViewType, setActiveViewType] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("SELECT 1;");
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selectedCell, setSelectedCell] = createSignal<CellSelection | null>(null);
  const [metadataView, setMetadataView] = createSignal<MetadataView>(null);
  const [selectedMetadataRow, setSelectedMetadataRow] = createSignal<number | null>(null);
  const [functionInfo, setFunctionInfo] = createSignal<FunctionInfo | null>(null);

  const handleConnectionChange = async (id: string | null) => {
    setActiveConnectionId(id);
    if (id) {
      const connections = await listConnections();
      const conn = connections.find((c) => c.id === id);
      if (conn) {
        setActiveDbType(conn.db_type);
        setActiveConnectionName(conn.name);
      }
    } else {
      setActiveDbType(null);
      setActiveConnectionName(null);
      setActiveDatabase(null);
      setActiveSchema(null);
      setActiveViewType(null);
    }
    setResult(null);
    setError(null);
    setSelectedCell(null);
    setMetadataView(null);
  };

  const handleDatabaseSwitch = (database: string, schema: string | null) => {
    setActiveDatabase(database);
    setActiveSchema(schema);
    setActiveViewType(null);
  };

  const handleTableSelect = async (database: string, schema: string, table: string) => {
    setActiveDatabase(database);
    setActiveSchema(schema);
    setActiveViewType("data");
    const newQuery = `SELECT * FROM ${schema}.${table} LIMIT 100;`;
    setQuery(newQuery);
    setMetadataView(null);
    await handleExecute(newQuery);
  };

  const handleQueryGenerate = (query: string) => {
    setQuery(query);
  };

  const handleMetadataSelect = (view: MetadataView) => {
    if (view) {
      setActiveDatabase(view.database);
      setActiveSchema(view.schema);
      setActiveViewType(view.type);
    }
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
    setActiveViewType(null);
  };

  const handleFunctionSelect = async (
    connectionId: string,
    database: string,
    schema: string,
    functionName: string
  ) => {
    try {
      setActiveDatabase(database);
      setActiveSchema(schema);
      setActiveViewType("function");
      const info = await getFunctionDefinition(connectionId, database, schema, functionName);
      setFunctionInfo(info);
      setMetadataView(null);
      setSelectedCell(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFunctionClose = () => {
    setFunctionInfo(null);
    setActiveViewType(null);
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
        onDatabaseSwitch={handleDatabaseSwitch}
        onTableSelect={handleTableSelect}
        onQueryGenerate={handleQueryGenerate}
        onMetadataSelect={handleMetadataSelect}
        onFunctionSelect={handleFunctionSelect}
      />
      <main class="main-content">
        <ConnectionPath
          connectionName={activeConnectionName()}
          database={activeDatabase()}
          schema={activeSchema()}
          viewType={activeViewType()}
        />

        <Show when={!metadataView() && !functionInfo()}>
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

        <Show when={functionInfo()}>
          <FunctionViewer
            functionInfo={functionInfo()}
            dbType={activeDbType()}
            onClose={handleFunctionClose}
          />
        </Show>

        <Show when={!metadataView() && !functionInfo()}>
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
