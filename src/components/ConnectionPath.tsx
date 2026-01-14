// ABOUTME: Displays the active connection path breadcrumb.
// ABOUTME: Shows connection name, database, and schema to provide context.

import { Show } from "solid-js";

interface Props {
  connectionName: string | null;
  database: string | null;
  schema: string | null;
}

export function ConnectionPath(props: Props) {
  return (
    <Show when={props.connectionName}>
      <div class="connection-path">
        <span class="path-segment connection">{props.connectionName}</span>
        <Show when={props.database}>
          <span class="path-separator">›</span>
          <span class="path-segment database">{props.database}</span>
        </Show>
        <Show when={props.schema}>
          <span class="path-separator">›</span>
          <span class="path-segment schema">{props.schema}</span>
        </Show>
      </div>
    </Show>
  );
}
