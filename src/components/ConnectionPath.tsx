// ABOUTME: Displays the active connection path breadcrumb.
// ABOUTME: Shows connection name, database, and schema to provide context.

import { Show, createSignal, createEffect } from "solid-js";
import { Icon } from "./Icon";
import { getQueryHistory } from "../lib/tauri";
import plugsConnectedSvg from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import databaseSvg from "@phosphor-icons/core/assets/regular/database.svg?raw";
import foldersSvg from "@phosphor-icons/core/assets/regular/folders.svg?raw";
import tableSvg from "@phosphor-icons/core/assets/regular/table.svg?raw";
import rowsSvg from "@phosphor-icons/core/assets/regular/rows.svg?raw";
import columnsSvg from "@phosphor-icons/core/assets/regular/columns.svg?raw";
import lightningSvg from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import lockSvg from "@phosphor-icons/core/assets/regular/lock.svg?raw";
import functionSvg from "@phosphor-icons/core/assets/regular/function.svg?raw";
import clockCounterClockwiseSvg from "@phosphor-icons/core/assets/regular/clock-counter-clockwise.svg?raw";

interface Props {
  connectionId: string | null;
  connectionName: string | null;
  database: string | null;
  schema: string | null;
  table: string | null;
  viewType: string | null;
  onHistoryClick?: () => void;
}

export function ConnectionPath(props: Props) {
  const [historyCount, setHistoryCount] = createSignal<number>(0);

  createEffect(async () => {
    const connectionId = props.connectionId;
    const database = props.database;

    if (connectionId && database) {
      try {
        const entries = await getQueryHistory({
          connection_id: connectionId,
          database: database,
        });
        setHistoryCount(entries.length);
      } catch {
        setHistoryCount(0);
      }
    } else {
      setHistoryCount(0);
    }
  });

  const getViewIcon = (viewType: string) => {
    switch (viewType) {
      case "data":
        return rowsSvg;
      case "columns":
        return columnsSvg;
      case "indexes":
        return lightningSvg;
      case "constraints":
        return lockSvg;
      case "function":
        return functionSvg;
      default:
        return null;
    }
  };

  const getViewLabel = (viewType: string) => {
    return viewType.charAt(0).toUpperCase() + viewType.slice(1);
  };

  return (
    <Show when={props.connectionName}>
      <div class="connection-path">
        <Icon svg={plugsConnectedSvg} size={14} />
        <span class="path-segment connection">{props.connectionName}</span>
        <Show when={props.database}>
          <span class="path-separator">›</span>
          <Icon svg={databaseSvg} size={14} />
          <span class="path-segment database">{props.database}</span>
        </Show>
        <Show when={props.schema}>
          <span class="path-separator">›</span>
          <Icon svg={foldersSvg} size={14} />
          <span class="path-segment schema">{props.schema}</span>
        </Show>
        <Show when={props.table}>
          <span class="path-separator">›</span>
          <Icon svg={props.viewType === "function" ? functionSvg : tableSvg} size={14} />
          <span class="path-segment table">{props.table}</span>
        </Show>
        <Show when={props.viewType && props.viewType !== "function"}>
          <span class="path-separator">›</span>
          <Icon svg={getViewIcon(props.viewType!)} size={14} />
          <span class="path-segment view">{getViewLabel(props.viewType!)}</span>
        </Show>
        <Show when={props.database && historyCount() > 0}>
          <span class="path-spacer" />
          <button class="path-history" onClick={() => props.onHistoryClick?.()}>
            <Icon svg={clockCounterClockwiseSvg} size={14} />
            <span class="path-history-count">{historyCount()}</span>
          </button>
        </Show>
      </div>
    </Show>
  );
}
