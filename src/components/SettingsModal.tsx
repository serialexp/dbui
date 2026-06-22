// ABOUTME: Modal for app-level settings — Ollama base URL and model selection.
// ABOUTME: Reads/writes AppSettings and lists models from the local Ollama service.

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import type { AppSettings } from "../lib/types";
import { getSettings, saveSettings, listOllamaModels } from "../lib/tauri";

import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import arrowsClockwiseSvg from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal(props: Props) {
  const [baseUrl, setBaseUrl] = createSignal("http://localhost:11434");
  const [model, setModel] = createSignal("");
  const [models, setModels] = createSignal<string[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const loadModels = async () => {
    setLoadingModels(true);
    setError(null);
    try {
      setModels(await listOllamaModels());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const load = async () => {
    try {
      const settings: AppSettings = await getSettings();
      setBaseUrl(settings.ollama_base_url);
      setModel(settings.ollama_model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await loadModels();
  };

  onMount(() => {
    load();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings({
        ollama_base_url: baseUrl().trim(),
        ollama_model: model().trim(),
      });
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>AI Settings</h2>
          <button class="modal-close-btn" onClick={() => props.onClose()}>
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <div class="modal-body settings-body">
          <p class="settings-hint">
            DBUI uses a local{" "}
            <a href="https://ollama.com" target="_blank" rel="noreferrer">
              Ollama
            </a>{" "}
            service to turn natural-language requests into SQL.
          </p>

          <label class="settings-field">
            <span>Ollama base URL</span>
            <input
              type="text"
              value={baseUrl()}
              placeholder="http://localhost:11434"
              onInput={(e) => setBaseUrl(e.currentTarget.value)}
            />
          </label>

          <label class="settings-field">
            <span>Model</span>
            <div class="settings-model-row">
              <select
                value={model()}
                onChange={(e) => setModel(e.currentTarget.value)}
              >
                <option value="">
                  {models().length ? "Select a model…" : "No models found"}
                </option>
                <Show when={model() && !models().includes(model())}>
                  <option value={model()}>{model()} (not installed)</option>
                </Show>
                <For each={models()}>
                  {(m) => <option value={m}>{m}</option>}
                </For>
              </select>
              <button
                class="settings-refresh-btn"
                onClick={loadModels}
                disabled={loadingModels()}
                title="Refresh model list"
              >
                <Icon svg={arrowsClockwiseSvg} size={14} />
              </button>
            </div>
          </label>

          <Show when={error()}>
            <div class="settings-error">{error()}</div>
          </Show>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button class="btn-primary" onClick={handleSave} disabled={saving()}>
            {saving() ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
