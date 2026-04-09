// ABOUTME: Displays the full value of a selected cell from the results table.
// ABOUTME: Supports toggling between raw and formatted (pretty-printed) views.

import { createSignal, Show, createMemo } from "solid-js";
import type { CellSelection } from "../lib/types";
import { Icon } from "./Icon";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import copySvg from "@phosphor-icons/core/assets/regular/copy.svg?raw";
import checkSvg from "@phosphor-icons/core/assets/regular/check.svg?raw";

interface Props {
  selection: CellSelection | null;
  onClose: () => void;
}

type ViewMode = "raw" | "formatted";

function detectValueType(
  value: unknown
): "null" | "string" | "number" | "boolean" | "json" {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object") return "json";
    } catch {
      // Not JSON, just a string
    }
    return "string";
  }
  if (typeof value === "object") return "json";
  return "string";
}

function formatValue(value: unknown, mode: ViewMode): string {
  if (value === null || value === undefined) return "NULL";

  if (mode === "raw") {
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  // Formatted mode
  const type = detectValueType(value);
  if (type === "json") {
    try {
      const obj = typeof value === "string" ? JSON.parse(value) : value;
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(value);
    }
  }
  if (type === "number") {
    return Number(value).toLocaleString();
  }
  return String(value);
}

function highlightJson(json: string): string {
  return json.replace(
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, key, str, bool, nil, num) => {
      if (key) return `<span class="json-key">${key}</span>:`;
      if (str) return `<span class="json-string">${str}</span>`;
      if (bool) return `<span class="json-bool">${bool}</span>`;
      if (nil) return `<span class="json-null">${nil}</span>`;
      if (num) return `<span class="json-number">${num}</span>`;
      return match;
    }
  );
}

export function CellInspector(props: Props) {
  const [viewMode, setViewMode] = createSignal<ViewMode>("raw");
  const [copied, setCopied] = createSignal(false);

  const formattedValue = () => {
    if (!props.selection) return "";
    return formatValue(props.selection.value, viewMode());
  };

  const isJsonFormatted = createMemo(() => {
    if (!props.selection || viewMode() !== "formatted") return false;
    return detectValueType(props.selection.value) === "json";
  });

  const highlightedHtml = createMemo(() => {
    if (!isJsonFormatted()) return "";
    return highlightJson(formattedValue());
  });

  const isNull = () =>
    props.selection?.value === null || props.selection?.value === undefined;

  const copyToClipboard = async () => {
    const value = formattedValue();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  return (
    <Show when={props.selection}>
      <div class="cell-inspector">
        <div class="inspector-header">
          <div class="inspector-title">
            <div class="inspector-label">Cell Value</div>
            <div class="inspector-context">
              Row {(props.selection?.rowIndex ?? 0) + 1}, Column "
              {props.selection?.columnName}"
            </div>
          </div>
          <button
            class="copy-button"
            onClick={copyToClipboard}
            title={copied() ? "Copied!" : "Copy to clipboard"}
          >
            <Show when={copied()} fallback={<Icon svg={copySvg} />}>
              <Icon svg={checkSvg} />
            </Show>
          </button>
          <button class="close-button" onClick={props.onClose} title="Close">
            <Icon svg={xSvg} />
          </button>
        </div>
        <div class="inspector-controls">
          <button
            class={viewMode() === "raw" ? "toggle-button active" : "toggle-button"}
            onClick={() => setViewMode("raw")}
          >
            Raw
          </button>
          <button
            class={
              viewMode() === "formatted" ? "toggle-button active" : "toggle-button"
            }
            onClick={() => setViewMode("formatted")}
          >
            Formatted
          </button>
        </div>
        <Show
          when={isJsonFormatted()}
          fallback={
            <div class="inspector-content" classList={{ null: isNull() }}>
              {formattedValue()}
            </div>
          }
        >
          <div
            class="inspector-content"
            innerHTML={highlightedHtml()}
          />
        </Show>
      </div>
    </Show>
  );
}
