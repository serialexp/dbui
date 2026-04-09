// ABOUTME: Main application component for DBUI.
// ABOUTME: Orchestrates sidebar, query editor, and results display.

import { Show, onMount, onCleanup } from "solid-js";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { MetadataView, WorkingContext } from "./lib/types";
import {
  executeQuery,
  extractQueryTable,
  listConnections,
  getFunctionDefinition,
  getViewDefinition,
  getViewDependencies,
  saveQueryHistory,
  listColumns,
  listIndexes,
  listConstraints,
  cancelQueries,
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
import { DependencyGraph } from "./components/DependencyGraph";
import { ConnectionPath } from "./components/ConnectionPath";
import { QueryHistory } from "./components/QueryHistory";
import { TabBar } from "./components/TabBar";
import "./styles/app.css";

function AppContent() {
  const {
    store,
    activeTab,
    createTab,
    setActiveTab,
    updateTab,
    updateActiveTab,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    pushQueryToNavHistory,
    setShowHistory,
  } = useStore();

  /** Find an existing tab matching a connection/db/schema/table/viewType combo. */
  const findExistingTab = (
    connectionId: string,
    database: string,
    schema: string,
    table: string,
    viewType: string
  ) =>
    store.tabs.find(
      (t) =>
        t.connectionId === connectionId &&
        t.database === database &&
        t.schema === schema &&
        t.table === table &&
        t.viewType === viewType
    );

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

    // Re-use existing tab if one matches — reset query to default
    const existing = findExistingTab(connectionId, database, schema, table, "data");
    if (existing) {
      setActiveTab(existing.id);
      const tableRef = schema ? `${schema}.${table}` : table;
      const defaultQuery = `SELECT * FROM ${tableRef} LIMIT 100;`;
      updateActiveTab({
        query: defaultQuery,
        tableContext: { connectionId, database, schema, table },
      });
      await handleExecute(defaultQuery, true);
      return;
    }

    const tableRef = schema ? `${schema}.${table}` : table;
    const newQuery = `SELECT * FROM ${tableRef} LIMIT 100;`;

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

  const handleShowProcesses = async (ctx: WorkingContext) => {
    const connections = await listConnections();
    const conn = connections.find((c) => c.id === ctx.connectionId);
    if (!conn) return;

    const query =
      ctx.dbType === "postgres"
        ? `SELECT pid, usename, datname, state, query_start, wait_event_type, query
FROM pg_stat_activity
WHERE state IS NOT NULL
ORDER BY query_start DESC;`
        : `SHOW FULL PROCESSLIST;`;

    createTab({
      connectionId: ctx.connectionId,
      connectionName: conn.name,
      dbType: ctx.dbType,
      categoryColor: ctx.categoryColor,
      database: ctx.database,
      schema: ctx.schema,
      table: null,
      viewType: null,
      query,
    });

    const newTab = activeTab();
    if (newTab) {
      await handleExecute(query, true);
    }
  };

  const handleShowUsers = async (ctx: WorkingContext) => {
    const connections = await listConnections();
    const conn = connections.find((c) => c.id === ctx.connectionId);
    if (!conn) return;

    const query =
      ctx.dbType === "postgres"
        ? `SELECT rolname AS "Role", rolsuper AS "Superuser", rolcreaterole AS "Create Role",
       rolcreatedb AS "Create DB", rolcanlogin AS "Can Login", rolreplication AS "Replication",
       rolvaliduntil AS "Valid Until"
FROM pg_catalog.pg_roles
ORDER BY rolname;`
        : `SELECT user AS "User", host AS "Host", account_locked AS "Locked",
       password_expired AS "Password Expired", password_lifetime AS "Password Lifetime"
FROM mysql.user
ORDER BY user;`;

    createTab({
      connectionId: ctx.connectionId,
      connectionName: conn.name,
      dbType: ctx.dbType,
      categoryColor: ctx.categoryColor,
      database: ctx.database,
      schema: ctx.schema,
      table: null,
      viewType: null,
      query,
    });

    const newTab = activeTab();
    if (newTab) {
      await handleExecute(query, true);
    }
  };

  const handleMetadataSelect = async (view: MetadataView) => {
    if (!view) return;

    // Re-use existing tab if one matches
    const existing = findExistingTab(
      view.connectionId, view.database, view.schema, view.table, view.type
    );
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

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
      selectedMetadataRows: [],
      lastClickedMetadataRow: null,
      selectedCell: null,
    });
  };

  const handleMetadataRowToggle = (rowIndex: number, shiftKey: boolean) => {
    const tab = activeTab();
    if (!tab?.metadataView) return;

    const current = [...tab.selectedMetadataRows];
    const lastRow = tab.lastClickedMetadataRow;

    if (shiftKey && lastRow !== null && lastRow !== rowIndex) {
      const start = Math.min(lastRow, rowIndex);
      const end = Math.max(lastRow, rowIndex);
      for (let i = start; i <= end; i++) {
        if (!current.includes(i)) current.push(i);
      }
      updateActiveTab({ selectedMetadataRows: current });
    } else {
      const idx = current.indexOf(rowIndex);
      if (idx !== -1) {
        current.splice(idx, 1);
      } else {
        current.push(rowIndex);
      }
      updateActiveTab({ selectedMetadataRows: current, lastClickedMetadataRow: rowIndex });
    }
  };

  const handleMetadataToggleAll = () => {
    const tab = activeTab();
    if (!tab?.metadataView) return;
    const total = tab.metadataView.data.length;
    const allSelected = tab.selectedMetadataRows.length === total && total > 0;
    if (allSelected) {
      updateActiveTab({ selectedMetadataRows: [] });
    } else {
      updateActiveTab({ selectedMetadataRows: Array.from({ length: total }, (_, i) => i) });
    }
  };

  const handleMetadataRefresh = async () => {
    const tab = activeTab();
    if (!tab?.metadataView) return;

    const { connectionId, database, schema, table, type } = tab.metadataView;
    let data;
    switch (type) {
      case "columns":
        data = await listColumns(connectionId, database, schema, table);
        break;
      case "indexes":
        data = await listIndexes(connectionId, database, schema, table);
        break;
      case "constraints":
        data = await listConstraints(connectionId, database, schema, table);
        break;
    }

    updateActiveTab({
      metadataView: { ...tab.metadataView, data },
      selectedMetadataRows: [],
      lastClickedMetadataRow: null,
    });
  };

  const handleMetadataDrop = async (names: string[]) => {
    const tab = activeTab();
    if (!tab?.metadataView) return;

    const { connectionId, database, schema, table, type } = tab.metadataView;
    const ref = schema ? `${schema}.${table}` : table;
    let query: string;
    switch (type) {
      case "columns":
        query = names
          .map((name) => `ALTER TABLE ${ref} DROP COLUMN ${name};`)
          .join("\n");
        break;
      case "indexes":
        query = names
          .map((name) => schema ? `DROP INDEX ${schema}.${name};` : `DROP INDEX ${name};`)
          .join("\n");
        break;
      case "constraints":
        query = names
          .map((name) => `ALTER TABLE ${ref} DROP CONSTRAINT ${name};`)
          .join("\n");
        break;
    }

    // Reuse existing data tab for this table, or create one
    const existing = findExistingTab(connectionId, database, schema, table, "data");
    if (existing) {
      updateTab(existing.id, { query });
      setActiveTab(existing.id);
      return;
    }

    const connections = await listConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;

    createTab({
      connectionId,
      connectionName: conn.name,
      dbType: conn.db_type,
      categoryColor: null,
      database,
      schema,
      table,
      viewType: "data",
      query,
      metadataView: null,
      tableContext: { connectionId, database, schema, table },
    });

    try {
      const columns = await listColumns(connectionId, database, schema, table);
      const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
      updateActiveTab({ primaryKeyColumns: pkCols });
    } catch {
      updateActiveTab({ primaryKeyColumns: [] });
    }
  };

  const handleFunctionRefresh = async () => {
    const tab = activeTab();
    if (!tab?.connectionId || !tab.database || !tab.schema || !tab.table) return;

    const info = await getFunctionDefinition(
      tab.connectionId,
      tab.database,
      tab.schema,
      tab.table
    );
    updateActiveTab({ functionInfo: info });
  };

  const handleFunctionSelect = async (
    connectionId: string,
    database: string,
    schema: string,
    functionName: string
  ) => {
    // Re-use existing tab if one matches
    const existing = findExistingTab(connectionId, database, schema, functionName, "function");
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

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

  const handleViewDefinitionSelect = async (
    connectionId: string,
    database: string,
    schema: string,
    viewName: string
  ) => {
    const existing = findExistingTab(connectionId, database, schema, viewName, "function");
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    const connections = await listConnections();
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;

    try {
      const info = await getViewDefinition(connectionId, database, schema, viewName);

      createTab({
        connectionId,
        connectionName: conn.name,
        dbType: conn.db_type,
        categoryColor: null,
        database,
        schema,
        table: viewName,
        viewType: "function",
        functionInfo: info,
        metadataView: null,
        selectedCell: null,
      });
    } catch (err) {
      console.error("Failed to load view definition:", err);
    }
  };

  const handleShowDependencyGraph = async (ctx: WorkingContext) => {
    // Reuse existing dependency tab for this schema
    const existing = store.tabs.find(
      (t) =>
        t.connectionId === ctx.connectionId &&
        t.database === ctx.database &&
        t.schema === ctx.schema &&
        t.viewType === "dependencies"
    );
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    const connections = await listConnections();
    const conn = connections.find((c) => c.id === ctx.connectionId);
    if (!conn) return;

    try {
      const deps = await getViewDependencies(ctx.connectionId, ctx.database, ctx.schema);

      createTab({
        connectionId: ctx.connectionId,
        connectionName: conn.name,
        dbType: ctx.dbType,
        categoryColor: ctx.categoryColor,
        database: ctx.database,
        schema: ctx.schema,
        table: null,
        viewType: "dependencies",
        dependencies: deps,
      });
    } catch (err) {
      console.error("Failed to load view dependencies:", err);
    }
  };

  const handleDependencyRefresh = async () => {
    const tab = activeTab();
    if (!tab?.connectionId || !tab.database || !tab.schema) return;
    const deps = await getViewDependencies(tab.connectionId, tab.database, tab.schema);
    updateActiveTab({ dependencies: deps });
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
      // Analyze the query to see if it's a simple single-table SELECT.
      // If so, set (or keep) the table context so delete checkboxes remain available.
      const tableInfo = tab.dbType
        ? await extractQueryTable(queryToExecute, tab.dbType).catch(() => null)
        : null;
      if (tableInfo) {
        const tableSchema = tableInfo.schema || sch;
        updateActiveTab({
          tableContext: { connectionId: connId, database: db, schema: tableSchema, table: tableInfo.table },
        });
        // Fetch primary key columns for the detected table
        listColumns(connId, db, tableSchema, tableInfo.table)
          .then((columns) => {
            const pkCols = columns.filter((c) => c.is_primary_key).map((c) => c.name);
            updateActiveTab({ primaryKeyColumns: pkCols });
          })
          .catch(() => updateActiveTab({ primaryKeyColumns: [] }));
      } else {
        updateActiveTab({
          tableContext: null,
          primaryKeyColumns: [],
        });
      }
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

  const handleCancelQuery = async () => {
    const tab = activeTab();
    if (!tab?.connectionId) return;

    // Attempt to cancel on the backend
    cancelQueries(tab.connectionId).catch(console.error);

    // Always reset the UI so it's no longer stuck
    updateActiveTab({
      loading: false,
      error: "Query cancelled.",
    });
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

  const handleGenerateKill = (rowIndices: number[]) => {
    const tab = activeTab();
    if (!tab || !tab.result) return;

    const res = tab.result;
    // Find the process ID column: "pid" for Postgres, "Id" for MySQL
    const pidColIndex = res.columns.findIndex(
      (c) => c.toLowerCase() === "pid" || c.toLowerCase() === "id"
    );
    if (pidColIndex === -1) return;

    const pids = rowIndices.map((i) => res.rows[i][pidColIndex]);

    let killQuery: string;
    if (tab.dbType === "postgres") {
      const calls = pids.map((pid) => `SELECT pg_terminate_backend(${pid});`);
      killQuery = calls.join("\n");
    } else {
      const calls = pids.map((pid) => `KILL ${pid};`);
      killQuery = calls.join("\n");
    }

    updateActiveTab({ query: killQuery });
  };

  const isProcessListTab = () => {
    const tab = activeTab();
    if (!tab || !tab.result) return false;
    const cols = tab.result.columns.map((c) => c.toLowerCase());
    // Postgres pg_stat_activity has "pid", MySQL SHOW PROCESSLIST has "Id"
    return (
      (cols.includes("pid") && cols.includes("query")) ||
      (cols.includes("id") && cols.includes("command"))
    );
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

  const handleFilterByValue = (columnName: string, value: unknown, mode: "exact" | "prefix" | "suffix" | "contains") => {
    const tab = activeTab();
    if (!tab) return;

    const ctx = tab.tableContext;
    let condition: string;
    if (value === null || value === undefined) {
      condition = `${columnName} IS NULL`;
    } else if (mode === "exact") {
      if (typeof value === "number" || typeof value === "boolean") {
        condition = `${columnName} = ${value}`;
      } else {
        const escaped = String(value).replace(/'/g, "''");
        condition = `${columnName} = '${escaped}'`;
      }
    } else {
      const escaped = String(value).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const pattern = mode === "prefix" ? `${escaped}%`
        : mode === "suffix" ? `%${escaped}`
        : `%${escaped}%`;
      condition = `${columnName} LIKE '${pattern}'`;
    }

    let query: string;
    if (ctx) {
      const tableRef = ctx.schema ? `${ctx.schema}.${ctx.table}` : ctx.table;
      query = `SELECT * FROM ${tableRef} WHERE ${condition} LIMIT 100;`;
      updateActiveTab({ query });
      handleExecute(query, true);
    } else {
      query = `-- Add table name: SELECT * FROM <table> WHERE ${condition} LIMIT 100;`;
      updateActiveTab({ query });
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
        onViewDefinitionSelect={handleViewDefinitionSelect}
        onShowDependencyGraph={handleShowDependencyGraph}
        onCategoryColorChange={handleCategoryColorChange}
        onShowProcesses={handleShowProcesses}
        onShowUsers={handleShowUsers}
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

          <Show when={!tab()!.metadataView && !tab()!.functionInfo && !tab()!.dependencies}>
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
              selectedRows={tab()!.selectedMetadataRows}
              lastClickedRow={tab()!.lastClickedMetadataRow}
              onRowToggle={handleMetadataRowToggle}
              onToggleAll={handleMetadataToggleAll}
              onRefresh={handleMetadataRefresh}
              onDrop={handleMetadataDrop}
              dbType={tab()!.dbType}
            />
          </Show>

          <Show when={tab()!.functionInfo}>
            <FunctionViewer
              functionInfo={tab()!.functionInfo}
              dbType={tab()!.dbType}
              onRefresh={handleFunctionRefresh}
            />
          </Show>

          <Show when={tab()!.dependencies}>
            <DependencyGraph
              dependencies={tab()!.dependencies!}
              onRefresh={handleDependencyRefresh}
            />
          </Show>

          <Show when={!tab()!.metadataView && !tab()!.functionInfo && !tab()!.dependencies}>
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
                  onGenerateKill={isProcessListTab() ? handleGenerateKill : undefined}
                  onFilterByValue={handleFilterByValue}
                  onCancel={handleCancelQuery}
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
