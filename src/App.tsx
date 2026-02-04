// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { createSignal, Show, onMount, onCleanup } from "solid-js";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { DatabaseType, QueryResult, CellSelection, MetadataView, FunctionInfo, TableContext } from "./lib/types";
import { executeQuery, listConnections, getFunctionDefinition, saveQueryHistory, getQueryHistory, listColumns } from "./lib/tauri";
import { generateDeleteQuery, mergeDeleteQuery, parseDeleteQuery } from "./lib/deleteQueryGenerator";
import { generateUpdateQuery, type RowEdit } from "./lib/updateQueryGenerator";
import { Sidebar } from "./components/Sidebar";
import { QueryEditor } from "./components/QueryEditor";
import { ResultsTable } from "./components/ResultsTable";
import { CellInspector } from "./components/CellInspector";
import { MetadataTable } from "./components/MetadataTable";
import { FunctionViewer } from "./components/FunctionViewer";
import { ConnectionPath } from "./components/ConnectionPath";
import { QueryHistory } from "./components/QueryHistory";
import "./styles/app.css";

function App() {
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [activeConnectionName, setActiveConnectionName] = createSignal<string | null>(null);
  const [activeDbType, setActiveDbType] = createSignal<DatabaseType | null>(null);
  const [activeDatabase, setActiveDatabase] = createSignal<string | null>(null);
  const [activeSchema, setActiveSchema] = createSignal<string | null>(null);
  const [activeTable, setActiveTable] = createSignal<string | null>(null);
  const [activeViewType, setActiveViewType] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("SELECT 1;");
  const [queryNavHistory, setQueryNavHistory] = createSignal<{ id: string; query: string }[]>([]);
  const [queryNavIndex, setQueryNavIndex] = createSignal(-1);
  const [result, setResult] = createSignal<QueryResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selectedCell, setSelectedCell] = createSignal<CellSelection | null>(null);
  const [metadataView, setMetadataView] = createSignal<MetadataView>(null);
  const [selectedMetadataRow, setSelectedMetadataRow] = createSignal<number | null>(null);
  const [functionInfo, setFunctionInfo] = createSignal<FunctionInfo | null>(null);
  const [showHistory, setShowHistory] = createSignal(false);
  const [categoryColor, setCategoryColor] = createSignal<string | null>(null);
  const [tableContext, setTableContext] = createSignal<TableContext | null>(null);
  const [primaryKeyColumns, setPrimaryKeyColumns] = createSignal<string[]>([]);
  const [hasPendingChanges, setHasPendingChanges] = createSignal(false);

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
      setActiveTable(null);
      setActiveViewType(null);
    }
    setResult(null);
    setError(null);
    setSelectedCell(null);
    setMetadataView(null);
  };

  const handleDatabaseSwitch = async (database: string, schema: string | null) => {
    setActiveDatabase(database);
    setActiveSchema(schema);
    setActiveTable(null);
    setActiveViewType(null);

    // Load query history for this connection/database
    const connId = activeConnectionId();
    if (connId) {
      try {
        const history = await getQueryHistory({
          connection_id: connId,
          database: database,
          limit: 50,
        });
        if (history.length > 0) {
          // History comes newest-first, reverse to get chronological order
          const chronological = [...history].reverse();
          const navEntries = chronological.map(entry => ({ id: entry.id, query: entry.query }));
          setQueryNavHistory(navEntries);
          setQueryNavIndex(navEntries.length - 1);
          setQuery(history[0].query);
        }
      } catch (err) {
        console.error("Failed to load query history:", err);
      }
    }
  };

  const pushQueryToNavHistory = (id: string, queryText: string) => {
    const history = queryNavHistory();
    const index = queryNavIndex();
    // Don't add if same as current
    if (index >= 0 && history[index]?.id === id) return;
    // Truncate forward history and add new entry
    const newHistory = [...history.slice(0, index + 1), { id, query: queryText }];
    setQueryNavHistory(newHistory);
    setQueryNavIndex(newHistory.length - 1);
  };

  const canGoBack = () => queryNavIndex() > 0;
  const canGoForward = () => queryNavIndex() < queryNavHistory().length - 1;

  const handleQueryBack = () => {
    if (!canGoBack()) return;
    const newIndex = queryNavIndex() - 1;
    setQueryNavIndex(newIndex);
    setQuery(queryNavHistory()[newIndex].query);
  };

  const handleQueryForward = () => {
    if (!canGoForward()) return;
    const newIndex = queryNavIndex() + 1;
    setQueryNavIndex(newIndex);
    setQuery(queryNavHistory()[newIndex].query);
  };

  const handleTableSelect = async (database: string, schema: string, table: string) => {
    const connId = activeConnectionId();
    if (!connId) return;

    setActiveDatabase(database);
    setActiveSchema(schema);
    setActiveTable(table);
    setActiveViewType("data");
    const newQuery = `SELECT * FROM ${schema}.${table} LIMIT 100;`;
    setQuery(newQuery);
    setMetadataView(null);

    setTableContext({ connectionId: connId, database, schema, table });

    try {
      const columns = await listColumns(connId, database, schema, table);
      const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
      setPrimaryKeyColumns(pkCols);
    } catch {
      setPrimaryKeyColumns([]);
    }

    await handleExecute(newQuery, true);
  };

  const handleQueryGenerate = (query: string) => {
    setQuery(query);
  };

  const handleMetadataSelect = (view: MetadataView) => {
    if (view) {
      setActiveDatabase(view.database);
      setActiveSchema(view.schema);
      setActiveTable(view.table);
      setActiveViewType(view.type);
    }
    setMetadataView(view);
    setSelectedMetadataRow(null);
    setSelectedCell(null);
  };

  const handleMetadataRowSelect = (rowIndex: number) => {
    setSelectedMetadataRow(rowIndex);
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
      setActiveTable(functionName);  // Use function name as "table" for breadcrumb
      setActiveViewType("function");
      const info = await getFunctionDefinition(connectionId, database, schema, functionName);
      setFunctionInfo(info);
      setMetadataView(null);
      setSelectedCell(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExecute = async (queryToExecute: string, preserveTableContext = false) => {
    const connId = activeConnectionId();
    const db = activeDatabase();
    const sch = activeSchema() || "";

    if (!connId || !db) {
      setError("No connection or database selected");
      return;
    }

    if (hasPendingChanges()) {
      const confirmed = await confirm(
        "You have pending edits that will be lost after the query executes. Continue?",
        { title: "Pending Changes", kind: "warning" }
      );
      if (!confirmed) return;
    }

    if (!preserveTableContext) {
      setTableContext(null);
      setPrimaryKeyColumns([]);
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedCell(null);
    setMetadataView(null);

    try {
      const [res, backendTime] = await executeQuery(connId, queryToExecute, db);
      setResult(res);

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
      setError(errorMsg);

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

    } finally {
      setLoading(false);
    }
  };

  const getWhereColumns = (rows: unknown[][], columns: string[], pkCols: string[]): string[] => {
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
    const ctx = tableContext();
    const pkCols = primaryKeyColumns();
    const res = result();
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

    const currentQuery = query();
    const parsed = parseDeleteQuery(currentQuery);

    if (parsed && parsed.schema === ctx.schema && parsed.table === ctx.table) {
      const merged = mergeDeleteQuery(currentQuery, newConditions);
      if (merged) {
        setQuery(merged);
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
    setQuery(deleteQuery);
  };

  const handleGenerateUpdate = (edits: RowEdit[]) => {
    const ctx = tableContext();
    const pkCols = primaryKeyColumns();
    const res = result();
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
    setQuery(updateQuery);
  };

  const handleRowDoubleClick = (row: unknown[], columns: string[]) => {
    // Handle Redis BROWSE results - columns are "key" and "type"
    if (activeDbType() === "redis" && columns.length >= 2 && columns[0] === "key" && columns[1] === "type") {
      const key = String(row[0]);
      const type = String(row[1]);

      // Generate appropriate command based on type
      const commands: Record<string, string> = {
        string: `GET "${key}"`,
        list: `LRANGE "${key}" 0 -1`,
        hash: `HGETALL "${key}"`,
        set: `SMEMBERS "${key}"`,
        zset: `ZRANGE "${key}" 0 -1 WITHSCORES`,
        stream: `XRANGE "${key}" - + COUNT 100`,
      };

      const command = commands[type] || `TYPE "${key}"`;
      setQuery(command);
      handleExecute(command);
    }
  };

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        setShowHistory(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <div class="app">
      <Show when={categoryColor()}>
        <div
          class="category-overlay"
          style={{
            "box-shadow": `inset 0 0 30px ${categoryColor()}40, inset 0 0 15px ${categoryColor()}20`,
          }}
        />
      </Show>
      <Sidebar
        activeConnectionId={activeConnectionId()}
        onConnectionChange={handleConnectionChange}
        onDatabaseSwitch={handleDatabaseSwitch}
        onTableSelect={handleTableSelect}
        onQueryGenerate={handleQueryGenerate}
        onMetadataSelect={handleMetadataSelect}
        onFunctionSelect={handleFunctionSelect}
        onCategoryColorChange={setCategoryColor}
      />
      <main class="main-content">
        <ConnectionPath
          connectionId={activeConnectionId()}
          connectionName={activeConnectionName()}
          database={activeDatabase()}
          schema={activeSchema()}
          table={activeTable()}
          viewType={activeViewType()}
          onHistoryClick={() => setShowHistory(true)}
        />

        <Show when={!metadataView() && !functionInfo()}>
          <QueryEditor
            value={query()}
            onChange={setQuery}
            onExecute={handleExecute}
            dbType={activeDbType()}
            disabled={!activeConnectionId() || loading()}
            canGoBack={canGoBack()}
            canGoForward={canGoForward()}
            onBack={handleQueryBack}
            onForward={handleQueryForward}
          />
        </Show>

        <Show when={metadataView()}>
          <MetadataTable
            view={metadataView()!}
            selectedRow={selectedMetadataRow()}
            onRowSelect={handleMetadataRowSelect}
            dbType={activeDbType()}
          />
        </Show>

        <Show when={functionInfo()}>
          <FunctionViewer
            functionInfo={functionInfo()}
            dbType={activeDbType()}
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
                onRowDoubleClick={handleRowDoubleClick}
                tableContext={tableContext()}
                primaryKeyColumns={primaryKeyColumns()}
                onGenerateDelete={handleGenerateDelete}
                onGenerateUpdate={handleGenerateUpdate}
                onPendingChangesChange={setHasPendingChanges}
              />
            </div>
            <CellInspector
              selection={selectedCell()}
              onClose={() => setSelectedCell(null)}
            />
          </div>
        </Show>

        <Show when={showHistory()}>
          <QueryHistory
            onClose={() => setShowHistory(false)}
            onQuerySelect={(query) => {
              setQuery(query);
              setShowHistory(false);
            }}
            connectionId={activeConnectionId()}
            database={activeDatabase()}
            schema={activeSchema()}
          />
        </Show>
      </main>
    </div>
  );
}

export default App;
