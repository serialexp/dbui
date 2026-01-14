// ABOUTME: Displays function definitions with syntax highlighting.
// ABOUTME: Shows function metadata and SQL/PL source code.

import { Show } from "solid-js";
import { EditorView, basicSetup } from "codemirror";
import { sql, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { onMount } from "solid-js";
import type { FunctionInfo, DatabaseType } from "../lib/types";
import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import { Icon } from "./Icon";

interface Props {
  functionInfo: FunctionInfo | null;
  dbType: DatabaseType | null;
  onClose: () => void;
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

  return (
    <Show when={props.functionInfo}>
      <div class="function-viewer">
        <div class="function-viewer-header">
          <div class="function-viewer-title">
            <h3>{props.functionInfo!.name}</h3>
            <Show when={props.functionInfo!.return_type}>
              <span class="function-return-type">
                → {props.functionInfo!.return_type}
              </span>
            </Show>
            <Show when={props.functionInfo!.language}>
              <span class="function-language">{props.functionInfo!.language}</span>
            </Show>
          </div>
          <button class="close-btn" onClick={props.onClose}>
            <Icon svg={xSvg} size={16} />
          </button>
        </div>
        <div class="function-viewer-content">
          <div ref={editorContainer} class="function-definition-editor" />
        </div>
      </div>
    </Show>
  );
}
