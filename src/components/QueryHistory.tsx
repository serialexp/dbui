// ABOUTME: Query history modal with search and filtering.
// ABOUTME: Displays executed queries with metadata and allows re-use.

import { createSignal, createEffect, For, Show, onMount } from "solid-js";
import type { QueryHistoryEntry, QueryHistoryFilter } from "../lib/types";
import { getQueryHistory, searchQueryHistory, deleteQueryHistory } from "../lib/tauri";
import { Icon } from "./Icon";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import circleNotchSvg from "@phosphor-icons/core/assets/regular/circle-notch.svg?raw";

interface Props {
  onClose: () => void;
  onQuerySelect: (query: string) => void;
  connectionId: string | null;
  database: string | null;
  schema: string | null;
}

export function QueryHistory(props: Props) {
  let searchInputRef: HTMLInputElement | undefined;
  const [entries, setEntries] = createSignal<QueryHistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchInputValue, setSearchInputValue] = createSignal("");
  const [startDate, setStartDate] = createSignal("");
  const [endDate, setEndDate] = createSignal("");
  const [successFilter, setSuccessFilter] = createSignal<"all" | "success" | "error">("all");
  const [loading, setLoading] = createSignal(false);
  const [selectedEntry, setSelectedEntry] = createSignal<QueryHistoryEntry | null>(null);
  const [searchDebounceTimer, setSearchDebounceTimer] = createSignal<number | null>(null);

  const buildFilter = (): QueryHistoryFilter => {
    const filter: QueryHistoryFilter = {
      limit: 50,
      offset: 0,
    };

    if (props.connectionId) {
      filter.connection_id = props.connectionId;
    }

    if (props.database) {
      filter.database = props.database;
    }

    if (props.schema) {
      filter.schema = props.schema;
    }

    if (startDate()) {
      filter.start_date = new Date(startDate()).toISOString();
    }

    if (endDate()) {
      filter.end_date = new Date(endDate()).toISOString();
    }

    const successVal = successFilter();
    if (successVal === "success") {
      filter.success_only = true;
    } else if (successVal === "error") {
      filter.success_only = false;
    }

    const search = searchQuery().trim();
    if (search) {
      filter.search_query = search;
    }

    return filter;
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const filter = buildFilter();
      const results = filter.search_query
        ? await searchQueryHistory(filter)
        : await getQueryHistory(filter);
      setEntries(results);

      // Add a small delay before hiding loading indicator if no results
      // so users can see that a search actually happened
      if (results.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (err) {
      console.error("Failed to load query history:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchInput = (value: string) => {
    setSearchInputValue(value);

    const timer = searchDebounceTimer();
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    const newTimer = window.setTimeout(() => {
      setSearchQuery(value);
    }, 500);

    setSearchDebounceTimer(newTimer);
  };

  const handleQuerySelect = (query: string) => {
    props.onQuerySelect(query);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQueryHistory(id);
      await loadHistory();
      if (selectedEntry()?.id === id) {
        setSelectedEntry(null);
      }
    } catch (err) {
      console.error("Failed to delete query:", err);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  createEffect(() => {
    if (successFilter() || startDate() || endDate() || searchQuery()) {
      loadHistory();
    }
  });

  createEffect(() => {
    loadHistory();
  });

  onMount(() => {
    searchInputRef?.focus();
  });

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal query-history-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Query History</h2>
          <button class="modal-close-btn" onClick={props.onClose} title="Close">
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <div class="history-filters">
          <input
            ref={searchInputRef}
            type="text"
            class="search-input"
            placeholder="Search queries..."
            value={searchInputValue()}
            onInput={(e) => handleSearchInput(e.currentTarget.value)}
          />

          <div class="date-filters">
            <input
              type="date"
              class="date-input"
              value={startDate()}
              onChange={(e) => {
                setStartDate(e.currentTarget.value);
              }}
              placeholder="Start date"
            />
            <span class="date-separator">to</span>
            <input
              type="date"
              class="date-input"
              value={endDate()}
              onChange={(e) => {
                setEndDate(e.currentTarget.value);
              }}
              placeholder="End date"
            />
          </div>

          <select
            class="filter-select"
            value={successFilter()}
            onChange={(e) => setSuccessFilter(e.currentTarget.value as any)}
          >
            <option value="all">All queries</option>
            <option value="success">Successful only</option>
            <option value="error">Failed only</option>
          </select>
        </div>

        <Show when={loading()}>
          <div class="history-loading">
            <Icon svg={circleNotchSvg} size={24} class="spinner" />
            <span>Loading...</span>
          </div>
        </Show>

        <Show when={!loading() && entries().length === 0}>
          <div class="history-empty">No query history found</div>
        </Show>

        <Show when={!loading() && entries().length > 0}>
          <div class="history-list">
            <For each={entries()}>
              {(entry) => (
                <div
                  class={`history-entry ${entry.success ? 'success' : 'error'} ${selectedEntry()?.id === entry.id ? 'selected' : ''}`}
                  onClick={() => setSelectedEntry(entry)}
                >
                  <div class="entry-header">
                    <span class="entry-timestamp">{formatTimestamp(entry.timestamp)}</span>
                    <div class="entry-metadata">
                      <span class="entry-timing">{entry.execution_time_ms}ms</span>
                      <span class="entry-row-count">{entry.row_count} rows</span>
                      <span class={`entry-status ${entry.success ? 'success' : 'error'}`}>
                        {entry.success ? '✓' : '✗'}
                      </span>
                    </div>
                  </div>
                  <div class="entry-query-preview">
                    {entry.query.length > 100
                      ? entry.query.substring(0, 100) + '...'
                      : entry.query}
                  </div>
                  <Show when={!entry.success && entry.error_message}>
                    <div class="entry-error">{entry.error_message}</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={selectedEntry()}>
          <div class="entry-detail-overlay" onClick={() => setSelectedEntry(null)}>
            <div class="entry-detail" onClick={(e) => e.stopPropagation()}>
              <div class="detail-header">
                <h3>Query Details</h3>
                <button
                  class="detail-close-btn"
                  onClick={() => setSelectedEntry(null)}
                  title="Close"
                >
                  <Icon svg={xSvg} size={16} />
                </button>
              </div>

              <div class="detail-metadata">
                <div class="metadata-row">
                  <span class="metadata-label">Database:</span>
                  <span class="metadata-value">{selectedEntry()!.database}</span>
                </div>
                <div class="metadata-row">
                  <span class="metadata-label">Schema:</span>
                  <span class="metadata-value">{selectedEntry()!.schema || "N/A"}</span>
                </div>
                <div class="metadata-row">
                  <span class="metadata-label">Executed:</span>
                  <span class="metadata-value">{formatTimestamp(selectedEntry()!.timestamp)}</span>
                </div>
                <div class="metadata-row">
                  <span class="metadata-label">Execution Time:</span>
                  <span class="metadata-value">{selectedEntry()!.execution_time_ms}ms</span>
                </div>
                <div class="metadata-row">
                  <span class="metadata-label">Rows:</span>
                  <span class="metadata-value">{selectedEntry()!.row_count}</span>
                </div>
                <div class="metadata-row">
                  <span class="metadata-label">Status:</span>
                  <span class={`metadata-value ${selectedEntry()!.success ? 'success' : 'error'}`}>
                    {selectedEntry()!.success ? 'Success' : 'Failed'}
                  </span>
                </div>
                <Show when={!selectedEntry()!.success && selectedEntry()!.error_message}>
                  <div class="metadata-row">
                    <span class="metadata-label">Error:</span>
                    <span class="metadata-value error">{selectedEntry()!.error_message}</span>
                  </div>
                </Show>
              </div>

              <div class="detail-query">
                <h4>Query</h4>
                <pre class="query-text">{selectedEntry()!.query}</pre>
              </div>

              <div class="detail-actions">
                <button
                  class="btn-primary"
                  onClick={() => handleQuerySelect(selectedEntry()!.query)}
                >
                  Use This Query
                </button>
                <button
                  class="btn-danger"
                  onClick={() => handleDelete(selectedEntry()!.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
