// ABOUTME: SQL query editor using CodeMirror.
// ABOUTME: Provides syntax highlighting and query execution.

import { onMount, onCleanup, createEffect } from "solid-js";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { DatabaseType } from "../lib/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  dbType: DatabaseType | null;
  disabled: boolean;
}

export function QueryEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  onMount(() => {
    if (!containerRef) return;

    const dialect = props.dbType === "mysql" ? MySQL : PostgreSQL;

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        sql({ dialect }),
        oneDark,
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              props.onExecute();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            props.onChange(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": {
            height: "200px",
            fontSize: "14px",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: containerRef,
    });
  });

  onCleanup(() => {
    view?.destroy();
  });

  createEffect(() => {
    if (view && props.value !== view.state.doc.toString()) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: props.value,
        },
      });
    }
  });

  return (
    <div class="query-editor">
      <div class="editor-header">
        <span>Query</span>
        <span class="shortcut-hint">Cmd/Ctrl+Enter to run</span>
      </div>
      <div ref={containerRef} class="editor-container" />
      <div class="editor-footer">
        <button
          class="run-btn"
          onClick={() => props.onExecute()}
          disabled={props.disabled}
        >
          Run Query
        </button>
      </div>
    </div>
  );
}
