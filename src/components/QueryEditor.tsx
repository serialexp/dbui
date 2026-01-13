// ABOUTME: SQL query editor using CodeMirror.
// ABOUTME: Provides syntax highlighting and query execution.

import { onMount, onCleanup, createEffect } from "solid-js";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, Decoration, DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { DatabaseType } from "../lib/types";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (query: string) => void;
  dbType: DatabaseType | null;
  disabled: boolean;
}

export function QueryEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  const getQueryRangeAtCursor = (
    doc: string,
    cursorPos: number
  ): { query: string; start: number; end: number } | null => {
    // Split queries by semicolon
    const queries: { query: string; start: number; end: number }[] = [];
    let currentQuery = "";
    let queryStart = 0;

    for (let i = 0; i < doc.length; i++) {
      const char = doc[i];
      currentQuery += char;

      if (char === ";") {
        queries.push({
          query: currentQuery.trim(),
          start: queryStart,
          end: i + 1,
        });
        currentQuery = "";
        queryStart = i + 1;
      }
    }

    // Don't forget the last query if there's no trailing semicolon
    if (currentQuery.trim()) {
      queries.push({
        query: currentQuery.trim(),
        start: queryStart,
        end: doc.length,
      });
    }

    // Find which query contains the cursor
    for (const q of queries) {
      if (cursorPos >= q.start && cursorPos <= q.end) {
        return q;
      }
    }

    return null;
  };

  const getQueryAtCursor = (): string => {
    if (!view) return props.value;

    const doc = view.state.doc.toString();
    const cursorPos = view.state.selection.main.head;
    const range = getQueryRangeAtCursor(doc, cursorPos);

    return range?.query || doc.trim() || props.value;
  };

  // State effect and field for query highlighting
  const setQueryHighlight = StateEffect.define<{ from: number; to: number } | null>();

  const queryHighlightField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(highlights, tr) {
      highlights = highlights.map(tr.changes);
      for (let effect of tr.effects) {
        if (effect.is(setQueryHighlight)) {
          if (effect.value === null) {
            highlights = Decoration.none;
          } else {
            const mark = Decoration.mark({
              class: "cm-query-highlight",
            });
            highlights = Decoration.set([mark.range(effect.value.from, effect.value.to)]);
          }
        }
      }
      return highlights;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const updateQueryHighlight = (view: EditorView) => {
    const doc = view.state.doc.toString();
    const cursorPos = view.state.selection.main.head;
    const range = getQueryRangeAtCursor(doc, cursorPos);

    if (range) {
      view.dispatch({
        effects: setQueryHighlight.of({ from: range.start, to: range.end }),
      });
    } else {
      view.dispatch({
        effects: setQueryHighlight.of(null),
      });
    }
  };

  const handleExecute = () => {
    const queryToRun = getQueryAtCursor();
    props.onExecute(queryToRun);
  };

  onMount(() => {
    if (!containerRef) return;

    const dialect =
      props.dbType === "mysql"
        ? MySQL
        : props.dbType === "sqlite"
          ? SQLite
          : PostgreSQL;

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
              handleExecute();
              return true;
            },
          },
        ]),
        queryHighlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            props.onChange(update.state.doc.toString());
          }
          // Update highlight when cursor moves or document changes
          if (update.selectionSet || update.docChanged) {
            updateQueryHighlight(update.view);
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
          ".cm-query-highlight": {
            backgroundColor: "rgba(120, 160, 200, 0.15)",
          },
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: containerRef,
    });

    // Initial highlight
    updateQueryHighlight(view);
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
          onClick={handleExecute}
          disabled={props.disabled}
        >
          Run Query
        </button>
      </div>
    </div>
  );
}
