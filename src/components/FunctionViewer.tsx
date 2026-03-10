// ABOUTME: Displays function definitions with syntax highlighting.
// ABOUTME: Shows function metadata and SQL/PL source code.

import { Show, createSignal, createEffect, on } from "solid-js";
import { EditorView, basicSetup } from "codemirror";
import { sql, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { onMount } from "solid-js";
import type { FunctionInfo, DatabaseType } from "../lib/types";
import { Icon } from "./Icon";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";

interface Props {
  functionInfo: FunctionInfo | null;
  dbType: DatabaseType | null;
  onRefresh: () => Promise<void>;
}

export function FunctionViewer(props: Props) {
  let editorContainer: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;

  onMount(() => {
    if (!editorContainer || !props.functionInfo) return;

    const sqlDialect = props.dbType === "postgres" ? PostgreSQL : props.dbType === "mysql" ? MySQL : undefined;

    const state = EditorState.create({
      doc: props.functionInfo.definition,
      extensions: [
        basicSetup,
        sql({ dialect: sqlDialect }),
        oneDark,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
      ],
    });

    editorView = new EditorView({
      state,
      parent: editorContainer,
    });

    return () => {
      editorView?.destroy();
    };
  });

  // Update editor content when functionInfo changes (e.g. after refresh)
  createEffect(
    on(
      () => props.functionInfo?.definition,
      (definition) => {
        if (!editorView || !definition) return;
        const current = editorView.state.doc.toString();
        if (current !== definition) {
          editorView.dispatch({
            changes: { from: 0, to: current.length, insert: definition },
          });
        }
      },
      { defer: true }
    )
  );

  const [refreshing, setRefreshing] = createSignal(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await props.onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Show when={props.functionInfo}>
      <div class="function-viewer">
        <div class="function-viewer-header">
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Show when={props.functionInfo!.return_type}>
              <span class="function-return-type">
                → {props.functionInfo!.return_type}
              </span>
            </Show>
            <Show when={props.functionInfo!.language}>
              <span class="function-language">{props.functionInfo!.language}</span>
            </Show>
          </div>
          <button
            class="refresh-button"
            onClick={handleRefresh}
            disabled={refreshing()}
            title="Refresh"
          >
            <Icon svg={arrowsClockwiseSvg} size={14} />
          </button>
        </div>
        <div class="function-viewer-content">
          <div ref={editorContainer} class="function-definition-editor" />
        </div>
      </div>
    </Show>
  );
}
