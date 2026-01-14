// ABOUTME: Displays the active connection path breadcrumb.
// ABOUTME: Shows connection name, database, and schema to provide context.

import { Show } from "solid-js";
import { Icon } from "./Icon";
import plugsConnectedSvg from "@phosphor-icons/core/assets/regular/plugs-connected.svg?raw";
import databaseSvg from "@phosphor-icons/core/assets/regular/database.svg?raw";
import foldersSvg from "@phosphor-icons/core/assets/regular/folders.svg?raw";

interface Props {
  connectionName: string | null;
  database: string | null;
  schema: string | null;
}

export function ConnectionPath(props: Props) {
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
      </div>
    </Show>
  );
}
