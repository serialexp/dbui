// ABOUTME: Preview modal for an AI-generated SQL suggestion + its motivation.
// ABOUTME: Lets the user insert the suggestion below the current query or replace it.

import { onMount, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";

interface Props {
  motivation: string;
  sql: string;
  onInsert: () => void;
  onReplace: () => void;
  onClose: () => void;
}

export function SuggestionModal(props: Props) {
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal suggestion-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>AI Suggestion</h2>
          <button class="modal-close-btn" onClick={() => props.onClose()}>
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <div class="modal-body suggestion-body">
          <div class="suggestion-section">
            <span class="suggestion-label">Motivation</span>
            <p class="suggestion-motivation">{props.motivation}</p>
          </div>
          <div class="suggestion-section">
            <span class="suggestion-label">Suggested SQL</span>
            <pre class="suggestion-sql">{props.sql}</pre>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" onClick={() => props.onClose()}>
            Dismiss
          </button>
          <button class="btn-secondary" onClick={() => props.onReplace()}>
            Replace editor
          </button>
          <button class="btn-primary" onClick={() => props.onInsert()}>
            Insert below
          </button>
        </div>
      </div>
    </div>
  );
}
