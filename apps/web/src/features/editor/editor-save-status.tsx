import type { SaveCoordinatorState } from "./save-coordinator.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local storage failed while saving this page";
}

export function EditorSaveStatus({ state }: { readonly state: SaveCoordinatorState }) {
  switch (state.status) {
    case "idle":
      return <span className="muted">Ready to edit</span>;
    case "editing":
      return (
        <span className="muted" data-testid="document-editing" role="status">
          Editing — local save scheduled
        </span>
      );
    case "saving-local":
      return (
        <span className="muted" data-testid="document-saving" role="status">
          Saving locally…
        </span>
      );
    case "saved-local":
      return (
        <span className="muted" data-testid="document-saved" role="status">
          Saved locally — synchronization state above reflects server durability
        </span>
      );
    case "error":
      return (
        <span className="status-banner" data-state="error" role="alert">
          Local save failed — {errorMessage(state.error)}
        </span>
      );
  }
}
