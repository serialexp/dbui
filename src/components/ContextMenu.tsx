// ABOUTME: Right-click context menu for tree node actions.
// ABOUTME: Shows context-sensitive options like Create Database and Create Schema.

import { For, onMount, onCleanup } from "solid-js";

export interface ContextMenuItem {
  label: string;
  action: () => void;
}

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
          <div
            class="context-menu-item"
            onClick={() => {
              item.action();
              props.onClose();
            }}
          >
            {item.label}
          </div>
        )}
      </For>
    </div>
  );
}
