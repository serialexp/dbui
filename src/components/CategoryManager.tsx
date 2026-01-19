// ABOUTME: Modal for managing connection categories.
// ABOUTME: Allows creating, editing, and deleting categories with color selection.

import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { Icon } from "./Icon";
import type { Category } from "../lib/types";
import {
  listCategories,
  saveCategory,
  updateCategory,
  deleteCategory,
} from "../lib/tauri";
import { confirm } from "@tauri-apps/plugin-dialog";

import xSvg from "@phosphor-icons/core/assets/regular/x.svg?raw";
import plusSvg from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import pencilSvg from "@phosphor-icons/core/assets/regular/pencil.svg?raw";
import trashSvg from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import checkSvg from "@phosphor-icons/core/assets/regular/check.svg?raw";

interface Props {
  onClose: () => void;
  onCategoriesChange: () => void;
}

const PRESET_COLORS = [
  "#dc3545", // Red
  "#fd7e14", // Orange
  "#ffc107", // Yellow
  "#28a745", // Green
  "#17a2b8", // Cyan
  "#007bff", // Blue
  "#6f42c1", // Purple
  "#e83e8c", // Pink
  "#6c757d", // Gray
];

export function CategoryManager(props: Props) {
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editColor, setEditColor] = createSignal("");
  const [isAddingNew, setIsAddingNew] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newColor, setNewColor] = createSignal(PRESET_COLORS[0]);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const cats = await listCategories();
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadCategories();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const handleAddCategory = async () => {
    if (!newName().trim()) return;

    try {
      await saveCategory({ name: newName().trim(), color: newColor() });
      setNewName("");
      setNewColor(PRESET_COLORS[0]);
      setIsAddingNew(false);
      await loadCategories();
      props.onCategoriesChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStartEdit = (category: Category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
  };

  const handleSaveEdit = async () => {
    const id = editingId();
    if (!id || !editName().trim()) return;

    try {
      await updateCategory({
        id,
        name: editName().trim(),
        color: editColor(),
      });
      setEditingId(null);
      await loadCategories();
      props.onCategoriesChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm(
      "Delete this category? Connections in this category will become uncategorized.",
      { title: "Delete Category", kind: "warning" }
    );

    if (!confirmed) return;

    try {
      await deleteCategory(id);
      await loadCategories();
      props.onCategoriesChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal category-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Manage Categories</h2>
          <button class="modal-close-btn" onClick={() => props.onClose()}>
            <Icon svg={xSvg} size={18} />
          </button>
        </div>

        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>

        <div class="category-list">
          <Show when={loading()}>
            <div class="history-loading">Loading...</div>
          </Show>

          <Show when={!loading()}>
            <For each={categories()}>
              {(category) => (
                <div class="category-item">
                  <Show when={editingId() === category.id}>
                    <div class="category-edit-row">
                      <div
                        class="color-swatch"
                        style={{ "background-color": editColor() }}
                      />
                      <input
                        type="text"
                        class="category-name-input"
                        value={editName()}
                        onInput={(e) => setEditName(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        autofocus
                      />
                      <div class="color-picker-row">
                        <For each={PRESET_COLORS}>
                          {(color) => (
                            <button
                              type="button"
                              class={`color-option ${editColor() === color ? "selected" : ""}`}
                              style={{ "background-color": color }}
                              onClick={() => setEditColor(color)}
                            />
                          )}
                        </For>
                      </div>
                      <div class="category-actions">
                        <button
                          class="category-action-btn save"
                          onClick={() => handleSaveEdit()}
                        >
                          <Icon svg={checkSvg} size={14} />
                        </button>
                        <button
                          class="category-action-btn cancel"
                          onClick={() => handleCancelEdit()}
                        >
                          <Icon svg={xSvg} size={14} />
                        </button>
                      </div>
                    </div>
                  </Show>
                  <Show when={editingId() !== category.id}>
                    <div class="category-display-row">
                      <div
                        class="color-swatch"
                        style={{ "background-color": category.color }}
                      />
                      <span class="category-name">{category.name}</span>
                      <div class="category-actions">
                        <button
                          class="category-action-btn"
                          onClick={() => handleStartEdit(category)}
                        >
                          <Icon svg={pencilSvg} size={14} />
                        </button>
                        <button
                          class="category-action-btn delete"
                          onClick={() => handleDelete(category.id)}
                        >
                          <Icon svg={trashSvg} size={14} />
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>

            <Show when={categories().length === 0 && !isAddingNew()}>
              <div class="category-empty">
                No categories yet. Create one to organize your connections.
              </div>
            </Show>
          </Show>
        </div>

        <Show when={isAddingNew()}>
          <div class="category-add-form">
            <div class="category-edit-row">
              <div
                class="color-swatch"
                style={{ "background-color": newColor() }}
              />
              <input
                type="text"
                class="category-name-input"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                  if (e.key === "Escape") setIsAddingNew(false);
                }}
                placeholder="Category name"
                autofocus
              />
              <div class="color-picker-row">
                <For each={PRESET_COLORS}>
                  {(color) => (
                    <button
                      type="button"
                      class={`color-option ${newColor() === color ? "selected" : ""}`}
                      style={{ "background-color": color }}
                      onClick={() => setNewColor(color)}
                    />
                  )}
                </For>
              </div>
              <div class="category-actions">
                <button
                  class="category-action-btn save"
                  onClick={() => handleAddCategory()}
                  disabled={!newName().trim()}
                >
                  <Icon svg={checkSvg} size={14} />
                </button>
                <button
                  class="category-action-btn cancel"
                  onClick={() => setIsAddingNew(false)}
                >
                  <Icon svg={xSvg} size={14} />
                </button>
              </div>
            </div>
          </div>
        </Show>

        <div class="category-footer">
          <Show when={!isAddingNew()}>
            <button
              class="add-category-btn"
              onClick={() => setIsAddingNew(true)}
            >
              <Icon svg={plusSvg} size={16} />
              Add Category
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
