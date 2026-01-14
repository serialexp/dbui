// ABOUTME: Displays the active connection path breadcrumb.
// ABOUTME: Shows connection name, database, and schema to provide context.

import { Show } from "solid-js";
import { Icon } from "./Icon";
import plugsConnectedSvg from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import databaseSvg from "@phosphor-icons/core/assets/regular/database.svg?raw";
import foldersSvg from "@phosphor-icons/core/assets/regular/folders.svg?raw";
import gridNineSvg from "@phosphor-icons/core/assets/regular/grid-nine.svg?raw";
import rowsSvg from "@phosphor-icons/core/assets/regular/rows.svg?raw";
import lightningSvg from "@phosphor-icons/core/assets/regular/lightning.svg?raw";
import lockSvg from "@phosphor-icons/core/assets/regular/lock.svg?raw";
import functionSvg from "@phosphor-icons/core/assets/regular/function.svg?raw";

interface Props {
  connectionName: string | null;
  database: string | null;
  schema: string | null;
  viewType: string | null;
}

export function ConnectionPath(props: Props) {
  const getViewIcon = (viewType: string) => {
    switch (viewType) {
      case "data":
        return gridNineSvg;
      case "columns":
        return rowsSvg;
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
        <Show when={props.viewType}>
          <span class="path-separator">›</span>
          <Icon svg={getViewIcon(props.viewType!)} size={14} />
          <span class="path-segment view">{getViewLabel(props.viewType!)}</span>
        </Show>
      </div>
    </Show>
  );
}
