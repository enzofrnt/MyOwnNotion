import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import {
  DragHandleButton,
  DragHandleMenu,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { memo, useCallback } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import {
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  moveSelectedBlocks,
  selectBlockForAction,
  transformSelectedBlocks,
} from "../block-selection.ts";
import type { EditorInstance } from "../blocknote-schema.ts";

function MyOwnNotionAddBlockButton({ onError }: { readonly onError: (message: string) => void }) {
  const components = useComponentsContext();
  const dictionary = useDictionary();
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const suggestionMenu = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  const openAdjacentMenu = useCallback(() => {
    if (block === undefined) return;
    try {
      const isEmpty = Array.isArray(block.content) && block.content.length === 0;
      if (isEmpty) {
        editor.setTextCursorPosition(block);
      } else {
        const insertedBlock = editor.insertBlocks([{ type: "paragraph" }], block, "after")[0];
        if (insertedBlock === undefined) throw new Error("Le bloc adjacent n’a pas été créé.");
        editor.setTextCursorPosition(insertedBlock);
      }
      suggestionMenu.openSuggestionMenu("/");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Le menu d’ajout n’a pas pu être ouvert.");
    }
  }, [block, editor, onError, suggestionMenu]);

  if (components === undefined || block === undefined) return null;
  const Button = components.SideMenu.Button;
  return (
    <Button
      className="bn-button"
      label={dictionary.side_menu.add_block_label}
      icon={<AppIcon name="add" size="large" />}
      onClick={openAdjacentMenu}
    />
  );
}

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
        <span data-testid="side-menu-duplicate">Dupliquer</span>
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
export const BlockSideMenu = memo(function BlockSideMenu({
  onError,
}: {
  readonly onError: (message: string) => void;
}) {
  // The editor rerenders when a durable commit settles so undo/redo controls
  // can refresh. Keep BlockNote's render callback stable across that status
  // update: replacing it remounts the floating controller and closes an open
  // drag-handle menu underneath the user's pointer.
  const renderDragHandleMenu = useCallback(
    () => <MyOwnNotionDragHandleMenu onError={onError} />,
    [onError],
  );
  const renderSideMenu = useCallback(
    () => (
      <SideMenu>
        <MyOwnNotionAddBlockButton onError={onError} />
        <DragHandleButton dragHandleMenu={renderDragHandleMenu} />
      </SideMenu>
    ),
    [onError, renderDragHandleMenu],
  );

  return <SideMenuController sideMenu={renderSideMenu} />;
});
