// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { Show, onMount, onCleanup } from "solid-js";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { MetadataView } from "./lib/types";
import {
  executeQuery,
  listConnections,
  getFunctionDefinition,
  saveQueryHistory,
  listColumns,
} from "./lib/tauri";
import {
  generateDeleteQuery,
  mergeDeleteQuery,
  parseDeleteQuery,
} from "./lib/deleteQueryGenerator";
import { generateUpdateQuery, type RowEdit } from "./lib/updateQueryGenerator";
import { StoreProvider, useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import { CellInspector } from "./components/CellInspector";
import { MetadataTable } from "./components/MetadataTable";
import { FunctionViewer } from "./components/FunctionViewer";
import { ConnectionPath } from "./components/ConnectionPath";
import { QueryHistory } from "./components/QueryHistory";
import { TabBar } from "./components/TabBar";
import "./styles/app.css";

function AppContent() {
  const {
    store,
    activeTab,
    createTab,
    updateActiveTab,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    pushQueryToNavHistory,
    setShowHistory,
  } = useStore();

  // Connection/database changes in sidebar are just for navigation
  // Tabs are created when clicking on tables/functions/metadata
  const handleConnectionChange = async (_id: string | null) => {
    // Sidebar handles its own connection state
  };

  const handleDatabaseSwitch = async (_database: string, _schema: string | null) => {
    // Sidebar handles its own database state
  };

  const handleTableSelect = async (
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ) => {
    const connections = await listConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;

    const newQuery = `SELECT * FROM ${schema}.${table} LIMIT 100;`;

    // Create a new tab for the table
    createTab({
      connectionId,
      connectionName: conn.name,
      dbType: conn.db_type,
      categoryColor: null, // Will be set by category effect if needed
      database,
      schema,
      table,
      viewType: "data",
      query: newQuery,
      metadataView: null,
      tableContext: { connectionId, database, schema, table },
    });

    // Get the newly active tab and fetch primary key columns
    const newTab = activeTab();
    if (!newTab) return;

    try {
      const columns = await listColumns(connectionId, database, schema, table);
      const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
      updateActiveTab({ primaryKeyColumns: pkCols });
    } catch {
      updateActiveTab({ primaryKeyColumns: [] });
    }

    await handleExecute(newQuery, true);
  };

  const handleQueryGenerate = (query: string) => {
    updateActiveTab({ query });
  };

  const handleMetadataSelect = async (view: MetadataView) => {
    if (!view) return;

    const connections = await listConnections();
    const conn = connections.find((c) => c.id === view.connectionId);
    if (!conn) return;

    // Create a new tab for metadata
    createTab({
      connectionId: view.connectionId,
      connectionName: conn.name,
      dbType: conn.db_type,
      categoryColor: null,
      database: view.database,
      schema: view.schema,
      table: view.table,
      viewType: view.type,
      metadataView: view,
      selectedMetadataRow: null,
      selectedCell: null,
    });
  };

  const handleMetadataRowSelect = (rowIndex: number) => {
    updateActiveTab({ selectedMetadataRow: rowIndex });
  };

  const handleFunctionSelect = async (
    connectionId: string,
    database: string,
    schema: string,
    functionName: string
  ) => {
    const connections = await listConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;

    try {
      const info = await getFunctionDefinition(
        connectionId,
        database,
        schema,
        functionName
      );

      // Create a new tab for the function
      createTab({
        connectionId,
        connectionName: conn.name,
        dbType: conn.db_type,
        categoryColor: null,
        database,
        schema,
        table: functionName,
        viewType: "function",
        functionInfo: info,
        metadataView: null,
        selectedCell: null,
      });
    } catch (err) {
      console.error("Failed to load function:", err);
    }
  };

  const handleExecute = async (
    queryToExecute: string,
    preserveTableContext = false
  ) => {
    const tab = activeTab();
    if (!tab) return;

    const connId = tab.connectionId;
    const db = tab.database;
    const sch = tab.schema || "";

    if (!connId || !db) {
      updateActiveTab({ error: "No connection or database selected" });
      return;
    }

    if (tab.hasPendingChanges) {
      const confirmed = await confirm(
        "You have pending edits that will be lost after the query executes. Continue?",
        { title: "Pending Changes", kind: "warning" }
      );
      if (!confirmed) return;
    }

    if (!preserveTableContext) {
      updateActiveTab({
        tableContext: null,
        primaryKeyColumns: [],
      });
    }

    updateActiveTab({
      loading: true,
      error: null,
      result: null,
      selectedCell: null,
      metadataView: null,
    });

    try {
      const [res, backendTime] = await executeQuery(connId, queryToExecute, db);
      updateActiveTab({ result: res, loading: false });

      const historyId = crypto.randomUUID();
      pushQueryToNavHistory(historyId, queryToExecute);

      saveQueryHistory({
        id: historyId,
        connection_id: connId,
        database: db,
        schema: sch,
        query: queryToExecute,
        timestamp: new Date().toISOString(),
        execution_time_ms: backendTime,
        row_count: res.row_count,
        success: true,
        error_message: null,
      }).catch(console.error);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      updateActiveTab({ error: errorMsg, loading: false });

      const historyId = crypto.randomUUID();
      pushQueryToNavHistory(historyId, queryToExecute);

      saveQueryHistory({
        id: historyId,
        connection_id: connId,
        database: db,
        schema: sch,
        query: queryToExecute,
        timestamp: new Date().toISOString(),
        execution_time_ms: 0,
        row_count: 0,
        success: false,
        error_message: errorMsg,
      }).catch(console.error);
    }
  };

  const getWhereColumns = (
    rows: unknown[][],
    columns: string[],
    pkCols: string[]
  ): string[] => {
    if (pkCols.length === 0) {
      return columns;
    }
    const hasNullPk = rows.some((row) =>
      pkCols.some((pk) => {
        const colIndex = columns.indexOf(pk);
        return row[colIndex] === null || row[colIndex] === undefined;
      })
    );
    return hasNullPk ? columns : pkCols;
  };

  const handleGenerateDelete = (rowIndices: number[]) => {
    const tab = activeTab();
    if (!tab) return;

    const ctx = tab.tableContext;
    const pkCols = tab.primaryKeyColumns;
    const res = tab.result;
    if (!ctx || !res) return;

    const selectedRows = rowIndices.map((i) => res.rows[i]);
    const whereCols = getWhereColumns(selectedRows, res.columns, pkCols);

    const newConditions = selectedRows.map((row) => {
      const conditions = whereCols.map((col) => {
        const colIndex = res.columns.indexOf(col);
        const value = row[colIndex];
        if (value === null || value === undefined) {
          return `${col} IS NULL`;
        }
        if (typeof value === "string") {
          const escaped = value.replace(/'/g, "''");
          return `${col} = '${escaped}'`;
        }
        return `${col} = ${value}`;
      });
      return `(${conditions.join(" AND ")})`;
    });

    const currentQuery = tab.query;
    const parsed = parseDeleteQuery(currentQuery);

    if (parsed && parsed.schema === ctx.schema && parsed.table === ctx.table) {
      const merged = mergeDeleteQuery(currentQuery, newConditions);
      if (merged) {
        updateActiveTab({ query: merged });
        return;
      }
    }

    const deleteQuery = generateDeleteQuery(
      ctx.table,
      ctx.schema,
      whereCols,
      res.columns,
      selectedRows
    );
    updateActiveTab({ query: deleteQuery });
  };

  const handleGenerateUpdate = (edits: RowEdit[]) => {
    const tab = activeTab();
    if (!tab) return;

    const ctx = tab.tableContext;
    const pkCols = tab.primaryKeyColumns;
    const res = tab.result;
    if (!ctx || !res) return;

    const editedRows = edits.map((e) => e.originalRow);
    const whereCols = getWhereColumns(editedRows, res.columns, pkCols);

    const updateQuery = generateUpdateQuery(
      ctx.table,
      ctx.schema,
      whereCols,
      res.columns,
      edits
    );
    updateActiveTab({ query: updateQuery });
  };

  const handleRowDoubleClick = (row: unknown[], columns: string[]) => {
    const tab = activeTab();
    if (!tab) return;

    if (
      tab.dbType === "redis" &&
      columns.length >= 2 &&
      columns[0] === "key" &&
      columns[1] === "type"
    ) {
      const key = String(row[0]);
      const type = String(row[1]);

      const commands: Record<string, string> = {
        string: `GET "${key}"`,
        list: `LRANGE "${key}" 0 -1`,
        hash: `HGETALL "${key}"`,
        set: `SMEMBERS "${key}"`,
        zset: `ZRANGE "${key}" 0 -1 WITHSCORES`,
        stream: `XRANGE "${key}" - + COUNT 100`,
      };

      const command = commands[type] || `TYPE "${key}"`;
      updateActiveTab({ query: command });
      handleExecute(command);
    }
  };

  const handleCloseWithPending = async (_tabId: string): Promise<boolean> => {
    return await confirm(
      "This tab has pending edits that will be lost. Close anyway?",
      { title: "Pending Changes", kind: "warning" }
    );
  };

  const handleCategoryColorChange = (color: string | null) => {
    updateActiveTab({ categoryColor: color });
  };

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "h") {
        e.preventDefault();
        setShowHistory(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const tab = () => activeTab();

  return (
    <div class="app">
      <Show when={tab()?.categoryColor}>
        <div
          class="category-overlay"
          style={{
            "box-shadow": `inset 0 0 30px ${tab()?.categoryColor}40, inset 0 0 15px ${tab()?.categoryColor}20`,
          }}
        />
      </Show>
      <Sidebar
        activeConnectionId={tab()?.connectionId ?? null}
        onConnectionChange={handleConnectionChange}
        onDatabaseSwitch={handleDatabaseSwitch}
        onTableSelect={handleTableSelect}
        onQueryGenerate={handleQueryGenerate}
        onMetadataSelect={handleMetadataSelect}
        onFunctionSelect={handleFunctionSelect}
        onCategoryColorChange={handleCategoryColorChange}
      />
      <main class="main-content">
        <Show when={store.tabs.length > 0}>
          <TabBar onCloseWithPending={handleCloseWithPending} />
        </Show>

        <Show
          when={tab()}
          fallback={
            <div class="empty-state">
              <p>Select a table or connection from the sidebar to get started.</p>
            </div>
          }
        >
          <ConnectionPath
            connectionId={tab()!.connectionId}
            connectionName={tab()!.connectionName}
            database={tab()!.database}
            schema={tab()!.schema}
            table={tab()!.table}
            viewType={tab()!.viewType}
            onHistoryClick={() => setShowHistory(true)}
          />

          <Show when={!tab()!.metadataView && !tab()!.functionInfo}>
            <QueryEditor
              value={tab()!.query}
              onChange={(q) => updateActiveTab({ query: q })}
              onExecute={handleExecute}
              dbType={tab()!.dbType}
              disabled={!tab()!.connectionId || tab()!.loading}
              canGoBack={canGoBack()}
              canGoForward={canGoForward()}
              onBack={goBack}
              onForward={goForward}
            />
          </Show>

          <Show when={tab()!.metadataView}>
            <MetadataTable
              view={tab()!.metadataView!}
              selectedRow={tab()!.selectedMetadataRow}
              onRowSelect={handleMetadataRowSelect}
              dbType={tab()!.dbType}
            />
          </Show>

          <Show when={tab()!.functionInfo}>
            <FunctionViewer
              functionInfo={tab()!.functionInfo}
              dbType={tab()!.dbType}
            />
          </Show>

          <Show when={!tab()!.metadataView && !tab()!.functionInfo}>
            <div class="results-area">
              <div class="results-table-wrapper">
                <ResultsTable
                  result={tab()!.result}
                  error={tab()!.error}
                  loading={tab()!.loading}
                  selectedCell={tab()!.selectedCell}
                  onCellSelect={(sel) => updateActiveTab({ selectedCell: sel })}
                  onRowDoubleClick={handleRowDoubleClick}
                  tableContext={tab()!.tableContext}
                  primaryKeyColumns={tab()!.primaryKeyColumns}
                  onGenerateDelete={handleGenerateDelete}
                  onGenerateUpdate={handleGenerateUpdate}
                  onPendingChangesChange={(p) =>
                    updateActiveTab({ hasPendingChanges: p })
                  }
                  dbType={tab()!.dbType}
                />
              </div>
              <CellInspector
                selection={tab()!.selectedCell}
                onClose={() => updateActiveTab({ selectedCell: null })}
              />
            </div>
          </Show>
        </Show>

        <Show when={store.showHistory}>
          <QueryHistory
            onClose={() => setShowHistory(false)}
            onQuerySelect={(query) => {
              updateActiveTab({ query });
              setShowHistory(false);
            }}
            connectionId={tab()?.connectionId ?? null}
            database={tab()?.database ?? null}
            schema={tab()?.schema ?? null}
          />
        </Show>
      </main>
    </div>
  );
}

function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

export default App;
