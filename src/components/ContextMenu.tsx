// ABOUTME: Right-click context menu for tree node actions.
// ABOUTME: Shows context-sensitive options like Create Database and Create Schema.

import { For, Show, onMount, onCleanup } from "solid-js";

export interface ContextMenuAction {
  kind?: "action";
  label: string;
  action: () => void;
}

export interface ContextMenuHeader {
  kind: "header";
  label: string;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuHeader;

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu(props: Props) {
  let menuRef: HTMLDivElement | undefined;

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    });
  });

  return (
    <div
      ref={menuRef}
      class="context-menu"
      style={{ position: "fixed", left: `${props.x}px`, top: `${props.y}px` }}
    >
      <For each={props.items}>
        {(item) => (
          <Show
            when={item.kind === "header"}
            fallback={
              <div
                class="context-menu-item"
                onClick={() => {
                  (item as ContextMenuAction).action();
                  props.onClose();
                }}
              >
                {item.label}
              </div>
            }
          >
            <div class="context-menu-header">{item.label}</div>
          </Show>
        )}
      </For>
    </div>
  );
}
