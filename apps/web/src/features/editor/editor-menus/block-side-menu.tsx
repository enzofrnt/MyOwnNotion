import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  AddBlockButton,
  DragHandleButton,
  DragHandleMenu,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";
import {
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  moveSelectedBlocks,
  selectBlockForAction,
  transformSelectedBlocks,
} from "../block-selection.ts";
import type { EditorInstance } from "../blocknote-schema.ts";

function MyOwnNotionDragHandleMenu({ onError }: { readonly onError: (message: string) => void }) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  if (components === undefined || block === undefined) return null;

  const execute = (action: () => void): void => {
    try {
      selectBlockForAction(editor, block.id);
      action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cette action n’a pas pu être appliquée.");
    }
  };
  const Item = components.Generic.Menu.Item;

  return (
    <DragHandleMenu>
      <Item
        className="bn-menu-item"
        onClick={() => execute(() => void duplicateSelectedBlocks(editor))}
      >
        Dupliquer
      </Item>
      <Item
        className="bn-menu-item"
        onClick={() => execute(() => transformSelectedBlocks(editor, "paragraph"))}
      >
        Transformer en texte
      </Item>
      <Item
        className="bn-menu-item"
        onClick={() => execute(() => transformSelectedBlocks(editor, "heading-1"))}
      >
        Transformer en titre
      </Item>
      <Item
        className="bn-menu-item"
        onClick={() =>
          execute(() => {
            if (!moveSelectedBlocks(editor, "up")) {
              throw new Error("Ces blocs sont déjà au début de leur niveau.");
            }
          })
        }
      >
        Déplacer vers le haut
      </Item>
      <Item
        className="bn-menu-item"
        onClick={() =>
          execute(() => {
            if (!moveSelectedBlocks(editor, "down")) {
              throw new Error("Ces blocs sont déjà à la fin de leur niveau.");
            }
          })
        }
      >
        Déplacer vers le bas
      </Item>
      <Item className="bn-menu-item" onClick={() => execute(() => deleteSelectedBlocks(editor))}>
        Supprimer
      </Item>
    </DragHandleMenu>
  );
}

/** Contextual adjacent-add and draggable handle supplied by BlockNote Community. */
export function BlockSideMenu({ onError }: { readonly onError: (message: string) => void }) {
  return (
    <SideMenuController
      sideMenu={() => (
        <SideMenu>
          <AddBlockButton />
          <DragHandleButton
            dragHandleMenu={() => <MyOwnNotionDragHandleMenu onError={onError} />}
          />
        </SideMenu>
      )}
    />
  );
}
