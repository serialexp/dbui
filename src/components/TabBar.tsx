// ABOUTME: Horizontal tab bar for switching between query tabs.
// ABOUTME: Displays tab titles with close buttons and active tab highlighting.

import { For, Show, createMemo } from "solid-js";
import { useStore, type Tab } from "../lib/store";
import { Icon } from "./Icon";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";

interface Props {
  onCloseWithPending: (tabId: string) => Promise<boolean>;
}

export function TabBar(props: Props) {
  const { store, activeTab, setActiveTab, closeTab, createTab } = useStore();

  // Compute display titles, disambiguating duplicates by finding first different path element
  const displayTitles = createMemo(() => {
    const titles = new Map<string, string>();
    const tabs = store.tabs;

    for (const tab of tabs) {
      const baseTitle = tab.title;
      const duplicates = tabs.filter((t) => t.title === baseTitle && t.id !== tab.id);

      if (duplicates.length === 0) {
        titles.set(tab.id, baseTitle);
        continue;
      }

      // Find first different path element (schema, database, connection)
      const disambiguator = findDisambiguator(tab, duplicates);
      titles.set(tab.id, disambiguator ? `${baseTitle} (${disambiguator})` : baseTitle);
    }

    return titles;
  });

  const findDisambiguator = (tab: Tab, duplicates: Tab[]): string | null => {
    // Check schema first - if all duplicates have same schema, skip
    const schemas = new Set([tab.schema, ...duplicates.map((d) => d.schema)]);
    if (schemas.size > 1 && tab.schema) {
      return tab.schema;
    }

    // Check database
    const databases = new Set([tab.database, ...duplicates.map((d) => d.database)]);
    if (databases.size > 1 && tab.database) {
      return tab.database;
    }

    // Check connection name
    const connections = new Set([tab.connectionName, ...duplicates.map((d) => d.connectionName)]);
    if (connections.size > 1 && tab.connectionName) {
      return tab.connectionName;
    }

    return null;
  };

  const handleCloseTab = async (tabId: string, e: MouseEvent) => {
    e.stopPropagation();

    const tab = store.tabs.find((t) => t.id === tabId);
    if (tab?.hasPendingChanges) {
      const confirmed = await props.onCloseWithPending(tabId);
      if (!confirmed) return;
    }

    closeTab(tabId);
  };

  const handleNewTab = () => {
    const currentTab = activeTab();
    createTab({
      connectionId: currentTab?.connectionId ?? null,
      connectionName: currentTab?.connectionName ?? null,
      dbType: currentTab?.dbType ?? null,
      categoryColor: currentTab?.categoryColor ?? null,
      database: currentTab?.database ?? null,
      schema: currentTab?.schema ?? null,
    });
  };

  return (
    <div class="tab-bar">
      <div class="tab-list">
        <For each={store.tabs}>
          {(tab) => (
            <button
              class="tab"
              classList={{
                active: tab.id === store.activeTabId,
                "has-pending": tab.hasPendingChanges,
              }}
              style={tab.categoryColor ? { "border-left": `3px solid ${tab.categoryColor}` } : {}}
              onClick={() => setActiveTab(tab.id)}
              title={displayTitles().get(tab.id)}
            >
              <span class="tab-title">{displayTitles().get(tab.id)}</span>
              <span
                class="tab-close"
                onClick={(e) => handleCloseTab(tab.id, e)}
              >
                <Icon svg={xSvg} size={12} />
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={store.tabs.length > 0}>
        <button class="tab-new" onClick={handleNewTab} title="New tab">
          <Icon svg={plusSvg} size={14} />
        </button>
      </Show>
    </div>
  );
}
