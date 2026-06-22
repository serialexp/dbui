// ABOUTME: SQL query editor using CodeMirror.
// ABOUTME: Provides syntax highlighting and query execution.

import { onMount, onCleanup, createEffect, createSignal, Show } from "solid-js";
import { EditorState, StateEffect, StateField, Prec } from "@codemirror/state";
import { EditorView, keymap, Decoration, DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql, PostgreSQL, MySQL, SQLite } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import type { DatabaseType } from "../lib/types";
import { Icon } from "./Icon";
import caretLeftSvg from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import caretRightSvg from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onExecute: (query: string) => void;
  dbType: DatabaseType | null;
  disabled: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  aiEnabled?: boolean;
  aiBusy?: boolean;
  aiError?: string | null;
  onGenerate?: (request: string) => void;
}

export function QueryEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  // Number of leading whitespace + SQL comment characters at the start of `s`.
  // Used to skip comment lines so the executed statement begins at its first
  // real token — the backend decides "returns rows" vs "rows affected" from the
  // first keyword, so a leading "-- comment" would otherwise misroute a SELECT.
  const leadingTriviaLength = (s: string): number => {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        i++;
        continue;
      }
      // Line comment: -- ... <newline>
      if (c === "-" && s[i + 1] === "-") {
        i += 2;
        while (i < s.length && s[i] !== "\n") i++;
        continue;
      }
      // Block comment: /* ... */ (nestable, like PostgreSQL)
      if (c === "/" && s[i + 1] === "*") {
        let depth = 1;
        i += 2;
        while (i < s.length && depth > 0) {
          if (s[i] === "/" && s[i + 1] === "*") {
            depth++;
            i += 2;
          } else if (s[i] === "*" && s[i + 1] === "/") {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
        continue;
      }
      break;
    }
    return i;
  };

  const getQueryRangeAtCursor = (
    doc: string,
    cursorPos: number
  ): { query: string; start: number; end: number } | null => {
    // Split queries by semicolon, respecting string literals, dollar quotes,
    // and comments (so a ';' inside a comment never splits a statement).
    const queries: { query: string; start: number; end: number }[] = [];
    let currentQuery = "";
    let queryStart = 0;
    let inSingleQuote = false;
    let inDollarQuote = false;
    let dollarQuoteTag = "";
    let inLineComment = false;
    let inBlockComment = false;
    let blockCommentDepth = 0;

    // Push the statement accumulated in `currentQuery`. The matching range
    // (start/end) keeps any leading comment so the cursor can still resolve a
    // statement while sitting on its comment, but the executed `query` text has
    // leading comments/whitespace stripped.
    const pushQuery = (rawEnd: number) => {
      const lead = leadingTriviaLength(currentQuery);
      const cleaned = currentQuery.slice(lead).trim();
      if (cleaned) {
        queries.push({ query: cleaned, start: queryStart, end: rawEnd });
      }
    };

    for (let i = 0; i < doc.length; i++) {
      const char = doc[i];
      const nextChar = doc[i + 1];
      currentQuery += char;

      // Inside a line comment: consume until newline.
      if (inLineComment) {
        if (char === "\n") inLineComment = false;
        continue;
      }

      // Inside a block comment: handle nesting and termination.
      if (inBlockComment) {
        if (char === "/" && nextChar === "*") {
          blockCommentDepth++;
          currentQuery += nextChar;
          i++;
        } else if (char === "*" && nextChar === "/") {
          blockCommentDepth--;
          currentQuery += nextChar;
          i++;
          if (blockCommentDepth === 0) inBlockComment = false;
        }
        continue;
      }

      // Comment starts (only outside of string / dollar-quote literals).
      if (!inSingleQuote && !inDollarQuote) {
        if (char === "-" && nextChar === "-") {
          inLineComment = true;
          currentQuery += nextChar;
          i++;
          continue;
        }
        if (char === "/" && nextChar === "*") {
          inBlockComment = true;
          blockCommentDepth = 1;
          currentQuery += nextChar;
          i++;
          continue;
        }
      }

      // Handle dollar quotes (PostgreSQL)
      if (char === "$" && !inSingleQuote) {
        if (!inDollarQuote) {
          // Start of potential dollar quote - capture the tag
          let tag = "$";
          let j = i + 1;
          while (j < doc.length && /[a-zA-Z0-9_]/.test(doc[j])) {
            tag += doc[j];
            j++;
          }
          if (j < doc.length && doc[j] === "$") {
            tag += "$";
            dollarQuoteTag = tag;
            inDollarQuote = true;
            // Skip the tag chars we just read
            for (let k = i + 1; k < j + 1; k++) {
              currentQuery += doc[k];
            }
            i = j;
            continue;
          }
        } else {
          // Check if this ends the dollar quote
          let potentialEnd = "$";
          let j = i + 1;
          while (j < doc.length && potentialEnd.length < dollarQuoteTag.length) {
            potentialEnd += doc[j];
            if (potentialEnd === dollarQuoteTag) {
              inDollarQuote = false;
              dollarQuoteTag = "";
              // Skip the tag chars we just read
              for (let k = i + 1; k < j + 1; k++) {
                currentQuery += doc[k];
              }
              i = j;
              break;
            }
            j++;
          }
          continue;
        }
      }

      // Handle single quotes
      if (char === "'" && !inDollarQuote) {
        if (inSingleQuote) {
          // Check for escaped quote ''
          if (nextChar === "'") {
            currentQuery += nextChar;
            i++; // Skip the escaped quote
          } else {
            inSingleQuote = false;
          }
        } else {
          inSingleQuote = true;
        }
        continue;
      }

      // Only split on semicolon if not inside any string or comment
      if (char === ";" && !inSingleQuote && !inDollarQuote) {
        pushQuery(i + 1);
        currentQuery = "";
        queryStart = i + 1;
      }
    }

    // Don't forget the last query if there's no trailing semicolon
    pushQuery(doc.length);

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
    if (props.disabled) return;
    const queryToRun = getQueryAtCursor();
    props.onExecute(queryToRun);
  };

  const [aiRequest, setAiRequest] = createSignal("");

  const handleGenerate = () => {
    const request = aiRequest().trim();
    if (!request || props.aiBusy || !props.onGenerate) return;
    props.onGenerate(request);
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
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                handleExecute();
                return true;
              },
            },
            {
              key: "Ctrl-Enter",
              run: () => {
                handleExecute();
                return true;
              },
            },
          ])
        ),
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
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            height: "200px",
            fontSize: "14px",
          },
          ".cm-scroller": {
            overflow: "auto",
          },
          ".cm-line:has(.cm-query-highlight)": {
            backgroundColor: "rgba(120, 160, 200, 0.1)",
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
        <div class="editor-header-left">
          <Show when={props.onBack && props.onForward}>
            <button
              class="nav-btn"
              onClick={props.onBack}
              disabled={!props.canGoBack}
              title="Previous query"
            >
              <Icon svg={caretLeftSvg} size={14} />
            </button>
            <button
              class="nav-btn"
              onClick={props.onForward}
              disabled={!props.canGoForward}
              title="Next query"
            >
              <Icon svg={caretRightSvg} size={14} />
            </button>
          </Show>
          <span>Query</span>
        </div>
        <span class="shortcut-hint">Cmd/Ctrl+Enter to run</span>
      </div>
      <Show when={props.aiEnabled}>
        <div class="ai-bar">
          <input
            type="text"
            class="ai-input"
            placeholder="Ask AI to write a query…"
            value={aiRequest()}
            disabled={props.aiBusy}
            onInput={(e) => setAiRequest(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGenerate();
              }
            }}
          />
          <button
            class="ai-btn"
            onClick={handleGenerate}
            disabled={props.aiBusy || !aiRequest().trim()}
            title="Generate SQL from your request"
          >
            {props.aiBusy ? "Generating…" : "Ask AI"}
          </button>
        </div>
        <Show when={props.aiError}>
          <div class="ai-error">{props.aiError}</div>
        </Show>
      </Show>
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
