import { type KeyboardEvent, type MouseEvent, useCallback, useState } from "react";
import {
  duplicateSelectedBlocks,
  insertParagraphAfterSelection,
  moveSelectedBlocks,
  resolveContiguousBlockSelection,
  selectBlockForAction,
} from "./block-selection.ts";
import type { EditorInstance } from "./blocknote-schema.ts";

export type EditorShortcutAction =
  | "undo"
  | "redo"
  | "duplicate"
  | "move-up"
  | "move-down"
  | "insert-after"
  | "context-menu";

export interface EditorContextMenuState {
  readonly x: number;
  readonly y: number;
}

export const MARKDOWN_INSERTION_SHORTCUTS = [
  "# ",
  "## ",
  "### ",
  "- ",
  "1. ",
  "[] ",
  "> ",
] as const;

export function editorShortcutAction(input: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): EditorShortcutAction | null {
  const mod = input.metaKey || input.ctrlKey;
  const key = input.key.toLowerCase();
  if (mod && key === "z") return input.shiftKey ? "redo" : "undo";
  if (mod && key === "y") return "redo";
  if (mod && key === "d") return "duplicate";
  if (mod && input.altKey && input.key === "Enter") return "insert-after";
  if (input.altKey && input.shiftKey && input.key === "ArrowUp") return "move-up";
  if (input.altKey && input.shiftKey && input.key === "ArrowDown") return "move-down";
  if (input.key === "ContextMenu" || (input.shiftKey && input.key === "F10")) {
    return "context-menu";
  }
  return null;
}

export function historyActionFromInputType(inputType: string): "undo" | "redo" | null {
  if (inputType === "historyUndo") return "undo";
  if (inputType === "historyRedo") return "redo";
  return null;
}

function blockIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-id]")?.dataset["id"] ?? null;
}

function menuPointForSelection(editor: EditorInstance): EditorContextMenuState {
  const first = resolveContiguousBlockSelection(editor).blocks[0];
  const candidates = editor.domElement?.querySelectorAll<HTMLElement>("[data-id]") ?? [];
  const element = [...candidates].find((candidate) => candidate.dataset["id"] === first?.id);
  const rect = element?.getBoundingClientRect();
  return rect === undefined
    ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    : { x: rect.left + Math.min(32, rect.width / 2), y: rect.top + Math.min(24, rect.height) };
}

export function useEditorShortcuts(input: {
  readonly editor: EditorInstance;
  readonly editable: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly reportError: (message: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);

  const run = useCallback(
    (action: Exclude<EditorShortcutAction, "context-menu">) => {
      try {
        switch (action) {
          case "undo":
            input.undo();
            break;
          case "redo":
            input.redo();
            break;
          case "duplicate":
            duplicateSelectedBlocks(input.editor);
            break;
          case "move-up":
            if (!moveSelectedBlocks(input.editor, "up")) {
              input.reportError("Ces blocs sont déjà au début de leur niveau.");
            }
            break;
          case "move-down":
            if (!moveSelectedBlocks(input.editor, "down")) {
              input.reportError("Ces blocs sont déjà à la fin de leur niveau.");
            }
            break;
          case "insert-after":
            insertParagraphAfterSelection(input.editor);
            break;
        }
      } catch (error) {
        input.reportError(
          error instanceof Error ? error.message : "Cette action n’a pas pu être appliquée.",
        );
      }
    },
    [input],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!input.editable || event.nativeEvent.isComposing) return;
      const action = editorShortcutAction(event);
      if (action === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "context-menu") {
        try {
          setContextMenu(menuPointForSelection(input.editor));
        } catch (error) {
          input.reportError(
            error instanceof Error ? error.message : "Aucun menu n’est disponible ici.",
          );
        }
        return;
      }
      run(action);
    },
    [input, run],
  );

  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!input.editable) return;
      const blockId = blockIdFromTarget(event.target);
      if (blockId === null || input.editor.getBlock(blockId) === undefined) return;
      event.preventDefault();
      selectBlockForAction(input.editor, blockId);
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [input],
  );

  return {
    contextMenu,
    dismissContextMenu: () => setContextMenu(null),
    onContextMenu,
    onKeyDown,
    run,
  };
}
