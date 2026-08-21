import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "../../../ui/primitives/menu.tsx";
import {
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  insertParagraphAfterSelection,
  moveSelectedBlocks,
  transformSelectedBlocks,
} from "../block-selection.ts";
import type { EditorInstance } from "../blocknote-schema.ts";
import type { EditorContextMenuState } from "../editor-shortcuts.ts";

export function BlockContextMenu({
  editor,
  state,
  onDismiss,
  onError,
}: {
  readonly editor: EditorInstance;
  readonly state: EditorContextMenuState | null;
  readonly onDismiss: () => void;
  readonly onError: (message: string) => void;
}) {
  const execute = (action: () => void): void => {
    try {
      action();
      onDismiss();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cette action n’a pas pu être appliquée.");
    }
  };

  return (
    <MenuRoot
      open={state !== null}
      setOpen={(open) => {
        if (!open) onDismiss();
      }}
      placement="bottom-start"
    >
      {state === null ? null : (
        <MenuTrigger
          aria-hidden="true"
          tabIndex={-1}
          style={{
            position: "fixed",
            left: state.x,
            top: state.y,
            width: 1,
            height: 1,
            padding: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        >
          <span />
        </MenuTrigger>
      )}
      <MenuContent data-testid="block-context-menu" aria-label="Actions du bloc">
        <MenuLabel>Bloc</MenuLabel>
        <MenuItem
          data-testid="context-insert-after"
          onClick={() => execute(() => void insertParagraphAfterSelection(editor))}
          shortcut="⌥⌘↵"
        >
          Ajouter en dessous
        </MenuItem>
        <MenuItem
          data-testid="context-duplicate"
          onClick={() => execute(() => void duplicateSelectedBlocks(editor))}
          shortcut="⌘D"
        >
          Dupliquer
        </MenuItem>
        <MenuItem
          onClick={() =>
            execute(() => {
              if (!moveSelectedBlocks(editor, "up")) {
                throw new Error("Ces blocs sont déjà au début de leur niveau.");
              }
            })
          }
          shortcut="⌥⇧↑"
        >
          Déplacer vers le haut
        </MenuItem>
        <MenuItem
          onClick={() =>
            execute(() => {
              if (!moveSelectedBlocks(editor, "down")) {
                throw new Error("Ces blocs sont déjà à la fin de leur niveau.");
              }
            })
          }
          shortcut="⌥⇧↓"
        >
          Déplacer vers le bas
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Transformer en</MenuLabel>
        <MenuItem
          data-testid="context-transform-paragraph"
          onClick={() => execute(() => transformSelectedBlocks(editor, "paragraph"))}
        >
          Texte
        </MenuItem>
        <MenuItem
          data-testid="context-transform-heading"
          onClick={() => execute(() => transformSelectedBlocks(editor, "heading-1"))}
        >
          Titre 1
        </MenuItem>
        <MenuItem onClick={() => execute(() => transformSelectedBlocks(editor, "bullet-list"))}>
          Liste à puces
        </MenuItem>
        <MenuItem onClick={() => execute(() => transformSelectedBlocks(editor, "check-list"))}>
          Liste de tâches
        </MenuItem>
        <MenuItem onClick={() => execute(() => transformSelectedBlocks(editor, "quote"))}>
          Citation
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          destructive
          data-testid="context-delete"
          onClick={() => execute(() => deleteSelectedBlocks(editor))}
        >
          Supprimer
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
