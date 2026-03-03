// ABOUTME: Simple name-only dialog for creating databases and schemas.
// ABOUTME: Used from context menus for creating databases and schemas.

import { createSignal, onMount, onCleanup } from "solid-js";

interface Props {
  title: string;
  placeholder: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export function CreateNameDialog(props: Props) {
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    inputRef?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const trimmed = name().trim();
    if (!trimmed) return;

    setError(null);
    setSaving(true);
    try {
      await props.onSubmit(trimmed);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal create-name-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <form onSubmit={handleSubmit}>
          <div class="form-group">
            <label for="create-name">Name</label>
            <input
              ref={inputRef}
              id="create-name"
              type="text"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder={props.placeholder}
              required
            />
          </div>
          {error() && <div class="error">{error()}</div>}
          <div class="form-actions">
            <button type="button" onClick={() => props.onClose()}>
              Cancel
            </button>
            <button type="submit" class="primary" disabled={saving() || !name().trim()}>
              {saving() ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
