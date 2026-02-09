// ABOUTME: Centralized SolidJS store for tab and connection state management.
// ABOUTME: Replaces prop-drilling with context-based state access.

import { createContext, useContext, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type {
  DatabaseType,
  QueryResult,
  CellSelection,
  MetadataView,
  FunctionInfo,
  TableContext,
} from "./types";

export interface Tab {
  id: string;
  title: string;

  // Connection context
  connectionId: string | null;
  connectionName: string | null;
  dbType: DatabaseType | null;
  categoryColor: string | null;

  // Database path
  database: string | null;
  schema: string | null;
  table: string | null;
  viewType: "data" | "columns" | "indexes" | "constraints" | "function" | null;

  // Query state
  query: string;
  queryNavHistory: { id: string; query: string }[];
  queryNavIndex: number;

  // Results
  result: QueryResult | null;
  error: string | null;
  loading: boolean;

  // Selection
  selectedCell: CellSelection | null;
  selectedMetadataRow: number | null;

  // View mode
  metadataView: MetadataView;
  functionInfo: FunctionInfo | null;

  // Edit context
  tableContext: TableContext | null;
  primaryKeyColumns: string[];
  hasPendingChanges: boolean;
}

export interface AppStore {
  tabs: Tab[];
  activeTabId: string | null;
  showHistory: boolean;
}

function createDefaultTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: crypto.randomUUID(),
    title: "Query",
    connectionId: null,
    connectionName: null,
    dbType: null,
    categoryColor: null,
    database: null,
    schema: null,
    table: null,
    viewType: null,
    query: "SELECT 1;",
    queryNavHistory: [],
    queryNavIndex: -1,
    result: null,
    error: null,
    loading: false,
    selectedCell: null,
    selectedMetadataRow: null,
    metadataView: null,
    functionInfo: null,
    tableContext: null,
    primaryKeyColumns: [],
    hasPendingChanges: false,
    ...overrides,
  };
}

export function generateTabTitle(tab: Partial<Tab>): string {
  if (tab.functionInfo) {
    return tab.functionInfo.name;
  }
  if (tab.metadataView) {
    return `${tab.table} (${tab.metadataView.type})`;
  }
  if (tab.table && tab.viewType === "data") {
    return tab.table;
  }
  return "Query";
}

function createAppStore() {
  const [store, setStore] = createStore<AppStore>({
    tabs: [],
    activeTabId: null,
    showHistory: false,
  });

  const activeTab = () => store.tabs.find((t) => t.id === store.activeTabId);

  const activeTabIndex = () =>
    store.tabs.findIndex((t) => t.id === store.activeTabId);

  const createTab = (initial: Partial<Tab> = {}): string => {
    const newTab = createDefaultTab(initial);
    newTab.title = generateTabTitle(newTab);
    setStore(
      produce((s) => {
        s.tabs.push(newTab);
        s.activeTabId = newTab.id;
      })
    );
    return newTab.id;
  };

  const closeTab = (id: string) => {
    setStore(
      produce((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return;

        s.tabs.splice(idx, 1);

        if (s.activeTabId === id) {
          if (s.tabs.length === 0) {
            s.activeTabId = null;
          } else if (idx >= s.tabs.length) {
            s.activeTabId = s.tabs[s.tabs.length - 1].id;
          } else {
            s.activeTabId = s.tabs[idx].id;
          }
        }
      })
    );
  };

  const setActiveTab = (id: string) => {
    setStore("activeTabId", id);
  };

  const updateTab = (id: string, updates: Partial<Tab>) => {
    setStore(
      produce((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) return;
        Object.assign(tab, updates);
        // Auto-update title if relevant fields changed
        if (
          "table" in updates ||
          "metadataView" in updates ||
          "functionInfo" in updates ||
          "viewType" in updates
        ) {
          tab.title = generateTabTitle(tab);
        }
      })
    );
  };

  const updateActiveTab = (updates: Partial<Tab>) => {
    const id = store.activeTabId;
    if (id) updateTab(id, updates);
  };

  // Query navigation helpers for active tab
  const canGoBack = () => {
    const tab = activeTab();
    return tab ? tab.queryNavIndex > 0 : false;
  };

  const canGoForward = () => {
    const tab = activeTab();
    return tab ? tab.queryNavIndex < tab.queryNavHistory.length - 1 : false;
  };

  const goBack = () => {
    const tab = activeTab();
    if (!tab || !canGoBack()) return;
    const newIndex = tab.queryNavIndex - 1;
    updateActiveTab({
      queryNavIndex: newIndex,
      query: tab.queryNavHistory[newIndex].query,
    });
  };

  const goForward = () => {
    const tab = activeTab();
    if (!tab || !canGoForward()) return;
    const newIndex = tab.queryNavIndex + 1;
    updateActiveTab({
      queryNavIndex: newIndex,
      query: tab.queryNavHistory[newIndex].query,
    });
  };

  const pushQueryToNavHistory = (id: string, queryText: string) => {
    const tab = activeTab();
    if (!tab) return;

    const history = tab.queryNavHistory;
    const index = tab.queryNavIndex;

    // Don't add if same as current
    if (index >= 0 && history[index]?.id === id) return;

    // Truncate forward history and add new entry
    const newHistory = [...history.slice(0, index + 1), { id, query: queryText }];
    updateActiveTab({
      queryNavHistory: newHistory,
      queryNavIndex: newHistory.length - 1,
    });
  };

  const setShowHistory = (show: boolean) => {
    setStore("showHistory", show);
  };

  return {
    store,
    activeTab,
    activeTabIndex,
    createTab,
    closeTab,
    setActiveTab,
    updateTab,
    updateActiveTab,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    pushQueryToNavHistory,
    setShowHistory,
  };
}

type AppStoreContext = ReturnType<typeof createAppStore>;

const StoreContext = createContext<AppStoreContext>();

export function StoreProvider(props: { children: JSX.Element }) {
  const storeValue = createAppStore();
  return (
    <StoreContext.Provider value={storeValue}>
      {props.children}
    </StoreContext.Provider>
  );
}

export function useStore(): AppStoreContext {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return ctx;
}
