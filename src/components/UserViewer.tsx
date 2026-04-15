// ABOUTME: User/role management viewer with permission browser.
// ABOUTME: Lists database users and shows their grants at server/database/schema/table levels.

import { createSignal, createMemo, For, Show } from "solid-js";
import type { DatabaseUser, UserGrant, DatabaseType } from "../lib/types";
import { Icon } from "./Icon";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import caretRightSvg from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import caretDownSvg from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import circleNotchSvg from "@phosphor-icons/core/assets/regular/circle-notch.svg?raw";

interface Props {
  users: DatabaseUser[];
  selectedUser: string | null;
  selectedUserHost: string | null;
  grants: UserGrant[] | null;
  grantsLoading: boolean;
  dbType: DatabaseType | null;
  database: string | null;
  onUserSelect: (username: string, host?: string) => void;
  onRefresh: () => Promise<void>;
}

export function UserViewer(props: Props) {
  const [filter, setFilter] = createSignal("");
  const [refreshing, setRefreshing] = createSignal(false);
  const [expandedSections, setExpandedSections] = createSignal<string[]>(["server", "database", "schema", "table", "column"]);

  const filteredUsers = createMemo(() => {
    const f = filter().toLowerCase();
    if (!f) return props.users;
    return props.users.filter(
      (u) => u.name.toLowerCase().includes(f) || (u.host && u.host.toLowerCase().includes(f))
    );
  });

  const selectedUserInfo = createMemo(() =>
    props.users.find(
      (u) =>
        u.name === props.selectedUser &&
        (props.dbType !== "mysql" || u.host === props.selectedUserHost)
    )
  );

  // Filter out grants that are already covered by a higher-level grant.
  // Hierarchy: server > database > schema > table > column
  const effectiveGrants = createMemo(() => {
    if (!props.grants) return [];
    const grants = props.grants;

    // Build lookup sets for each level: "privilege" or "privilege:object"
    const serverPrivs = new Set<string>();
    const dbPrivs = new Set<string>();   // "priv:db"
    const schemaPrivs = new Set<string>(); // "priv:schema"
    const tablePrivs = new Set<string>(); // "priv:schema.table"

    for (const g of grants) {
      switch (g.object_type) {
        case "server":
          serverPrivs.add(g.privilege);
          break;
        case "database":
          dbPrivs.add(`${g.privilege}:${g.object_name || ""}`);
          break;
        case "schema":
          schemaPrivs.add(`${g.privilege}:${g.object_schema || ""}`);
          break;
        case "table":
          tablePrivs.add(`${g.privilege}:${g.object_schema || ""}.${g.object_name || ""}`);
          break;
      }
    }

    return grants.filter((g) => {
      const priv = g.privilege;
      switch (g.object_type) {
        case "server":
          return true; // always show top-level
        case "database":
          return !serverPrivs.has(priv);
        case "schema":
          return !serverPrivs.has(priv) &&
            !dbPrivs.has(`${priv}:${g.object_catalog || ""}`);
        case "table":
          return !serverPrivs.has(priv) &&
            !schemaPrivs.has(`${priv}:${g.object_schema || ""}`);
        case "column":
          return !serverPrivs.has(priv) &&
            !schemaPrivs.has(`${priv}:${g.object_schema || ""}`) &&
            !tablePrivs.has(`${priv}:${g.object_schema || ""}.${g.object_name || ""}`);
        default:
          return true;
      }
    });
  });

  const grantsByType = createMemo(() => {
    const grouped: Record<string, UserGrant[]> = {};
    for (const g of effectiveGrants()) {
      if (!grouped[g.object_type]) grouped[g.object_type] = [];
      grouped[g.object_type].push(g);
    }
    return grouped;
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const sectionOrder = ["server", "database", "schema", "table", "column", "function"];
  const sectionLabels: Record<string, string> = {
    server: "Server / Global",
    database: "Database",
    schema: "Schema",
    table: "Table",
    column: "Column",
    function: "Function / Routine",
  };

  // Group grants within a section by object for nicer display
  const groupGrantsByObject = (grants: UserGrant[]) => {
    const groups: Record<string, UserGrant[]> = {};
    for (const g of grants) {
      const key =
        g.object_type === "server"
          ? "global"
          : g.object_type === "column"
            ? `${g.object_schema || ""}.${g.object_name || ""}.${g.column_name || ""}`
            : g.object_schema && g.object_name && g.object_schema !== g.object_name
              ? `${g.object_schema}.${g.object_name}`
              : g.object_name || g.object_schema || "unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(g);
    }
    return groups;
  };

  return (
    <div class="user-viewer">
      <div class="user-viewer-sidebar">
        <div class="user-viewer-sidebar-header">
          <input
            type="text"
            class="user-search-input"
            placeholder="Filter users..."
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <button
            class="refresh-button"
            onClick={handleRefresh}
            disabled={refreshing()}
            title="Refresh"
          >
            <Icon svg={arrowsClockwiseSvg} size={14} />
          </button>
        </div>
        <div class="user-viewer-list">
          <For each={filteredUsers()}>
            {(user) => (
              <div
                class={`user-list-item ${
                  props.selectedUser === user.name &&
                  (props.dbType !== "mysql" || props.selectedUserHost === user.host)
                    ? "selected"
                    : ""
                }`}
                onClick={() =>
                  props.onUserSelect(user.name, user.host ?? undefined)
                }
              >
                <div class="user-list-item-name">
                  <span class="user-name">{user.name}</span>
                  <Show when={user.host}>
                    <span class="user-host">@{user.host}</span>
                  </Show>
                </div>
                <div class="user-list-item-badges">
                  <Show when={user.is_superuser}>
                    <span class="user-badge badge-super">super</span>
                  </Show>
                  <Show when={user.can_login}>
                    <span class="user-badge badge-login">login</span>
                  </Show>
                  <Show when={!user.can_login}>
                    <span class="user-badge badge-nologin">no login</span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="user-viewer-detail">
        <Show
          when={selectedUserInfo()}
          fallback={
            <div class="user-viewer-empty">
              <p>Select a user to view their permissions.</p>
            </div>
          }
        >
          <div class="user-detail-header">
            <div class="user-detail-title">
              <span class="user-detail-name">{selectedUserInfo()!.name}</span>
              <Show when={selectedUserInfo()!.host}>
                <span class="user-detail-host">@{selectedUserInfo()!.host}</span>
              </Show>
            </div>
            <div class="user-detail-properties">
              <Show when={selectedUserInfo()!.is_superuser}>
                <span class="user-prop-badge badge-super">Superuser</span>
              </Show>
              <Show when={selectedUserInfo()!.can_login}>
                <span class="user-prop-badge badge-login">Can Login</span>
              </Show>
              <Show when={!selectedUserInfo()!.can_login}>
                <span class="user-prop-badge badge-nologin">Cannot Login</span>
              </Show>
              <Show when={selectedUserInfo()!.can_create_db}>
                <span class="user-prop-badge badge-create">Create DB</span>
              </Show>
              <Show when={selectedUserInfo()!.can_create_role}>
                <span class="user-prop-badge badge-create">Create Role</span>
              </Show>
              <Show when={selectedUserInfo()!.is_replication}>
                <span class="user-prop-badge badge-repl">Replication</span>
              </Show>
              <Show when={selectedUserInfo()!.valid_until}>
                <span class="user-prop-badge badge-expiry">
                  Expires: {selectedUserInfo()!.valid_until}
                </span>
              </Show>
            </div>
            <Show when={selectedUserInfo()!.member_of.length > 0}>
              <div class="user-detail-membership">
                <span class="membership-label">Member of:</span>
                <For each={selectedUserInfo()!.member_of}>
                  {(role) => <span class="membership-role">{role}</span>}
                </For>
              </div>
            </Show>
          </div>

          <div class="user-grants-area">
            <Show when={props.grantsLoading}>
              <div class="grants-loading">
                <Icon svg={circleNotchSvg} size={20} class="spinner" />
                <span>Loading permissions...</span>
              </div>
            </Show>
            <Show when={!props.grantsLoading && props.grants}>
              <Show when={props.grants!.length === 0}>
                <div class="grants-empty">No explicit grants found for this user.</div>
              </Show>
              <For each={sectionOrder.filter((s) => grantsByType()[s])}>
                {(section) => {
                  const grants = () => grantsByType()[section] || [];
                  const objectGroups = () => groupGrantsByObject(grants());
                  const expanded = () => expandedSections().includes(section);
                  return (
                    <>
                      <Show when={section === "table" && props.dbType === "postgres" && props.database}>
                        <div class="grants-database-notice">
                          Showing table/column grants for database <strong>{props.database}</strong>. Connect to other databases to see their grants.
                        </div>
                      </Show>
                      <div class="grant-section">
                        <div
                          class="grant-section-header"
                          onClick={() => toggleSection(section)}
                        >
                          <span class="grant-section-arrow">
                            <Show when={expanded()} fallback={<Icon svg={caretRightSvg} size={14} />}>
                              <Icon svg={caretDownSvg} size={14} />
                            </Show>
                          </span>
                          <span class="grant-section-title">
                            {sectionLabels[section] || section}
                          </span>
                          <span class="grant-section-count">{grants().length}</span>
                        </div>
                        <Show when={expanded()}>
                          <div class="grant-section-body">
                            <For each={Object.entries(objectGroups())}>
                              {([objectKey, objectGrants]) => (
                                <div class="grant-object-group">
                                  <Show when={section !== "server"}>
                                    <div class="grant-object-name">{objectKey}</div>
                                  </Show>
                                  <div class="grant-privileges">
                                    <For each={objectGrants}>
                                      {(grant) => (
                                        <span
                                          class={`grant-pill ${grant.is_grantable ? "grantable" : ""} ${grant.inherited_from ? "inherited" : ""}`}
                                          title={
                                            (grant.is_grantable ? "WITH GRANT OPTION" : "") +
                                            (grant.grantor ? ` (granted by ${grant.grantor})` : "") +
                                            (grant.inherited_from
                                              ? ` (via ${grant.inherited_from})`
                                              : "")
                                          }
                                        >
                                          {grant.privilege}
                                          <Show when={grant.is_grantable}>
                                            <span class="grant-option-marker">*</span>
                                          </Show>
                                          <Show when={grant.inherited_from}>
                                            <span class="grant-inherited-tag">via {grant.inherited_from}</span>
                                          </Show>
                                        </span>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </>
                  );
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
