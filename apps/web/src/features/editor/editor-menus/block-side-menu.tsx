import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import {
  BlockPopover,
  DragHandleMenu,
  SideMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { memo, useCallback, useMemo } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import {
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  moveSelectedBlocks,
  selectBlockForAction,
  transformSelectedBlocks,
} from "../block-selection.ts";
import type { EditorBlock, EditorInstance } from "../blocknote-schema.ts";

type SideMenuBlock = EditorBlock;

function MyOwnNotionAddBlockButton({
  block,
  onError,
}: {
  readonly block: SideMenuBlock;
  readonly onError: (message: string) => void;
}) {
  const components = useComponentsContext();
  const dictionary = useDictionary();
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const suggestionMenu = useExtension(SuggestionMenu);

  const openAdjacentMenu = useCallback(() => {
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

  if (components === undefined) return null;
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

function MyOwnNotionDragHandleMenu({
  block,
  onError,
}: {
  readonly block: SideMenuBlock;
  readonly onError: (message: string) => void;
}) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  if (components === undefined) return null;

  const execute = (action: () => void): void => {
    try {
      selectBlockForAction(editor, block.id);
      action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cette action n’a pas pu être appliquée.");
    }
  };
  const Item = components.Generic.Menu.Item;
  const isTable = block.type === "table";

  return (
    <DragHandleMenu>
      <Item
        className="bn-menu-item"
        onClick={() => execute(() => void duplicateSelectedBlocks(editor))}
      >
        <span data-testid="side-menu-duplicate">Dupliquer</span>
      </Item>
      {!isTable && (
        <Item
          className="bn-menu-item"
          onClick={() => execute(() => transformSelectedBlocks(editor, "paragraph"))}
        >
          Transformer en texte
        </Item>
      )}
      {!isTable && (
        <Item
          className="bn-menu-item"
          onClick={() => execute(() => transformSelectedBlocks(editor, "heading-1"))}
        >
          Transformer en titre
        </Item>
      )}
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

/**
 * BlockNote's stock `DragHandleButton` drags the block the extension reports.
 * Inside a table that is a cell; this handle always drags the anchor block
 * resolved by the controller (the table itself).
 */
function MyOwnNotionDragHandleButton({
  block,
  onError,
}: {
  readonly block: SideMenuBlock;
  readonly onError: (message: string) => void;
}) {
  const components = useComponentsContext();
  const dictionary = useDictionary();
  const sideMenu = useExtension(SideMenuExtension);
  if (components === undefined) return null;

  return (
    <components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) sideMenu.freezeMenu();
        else sideMenu.unfreezeMenu();
      }}
      position="left"
    >
      <components.Generic.Menu.Trigger>
        <components.SideMenu.Button
          label={dictionary.side_menu.drag_handle_label}
          draggable={true}
          onDragStart={(event) =>
            sideMenu.blockDragStart(event, block as Parameters<typeof sideMenu.blockDragStart>[1])
          }
          onDragEnd={() => sideMenu.blockDragEnd()}
          className="bn-button"
          icon={<AppIcon name="drag" size="large" data-test="dragHandle" />}
        />
      </components.Generic.Menu.Trigger>
      <MyOwnNotionDragHandleMenu block={block} onError={onError} />
    </components.Generic.Menu.Root>
  );
}

/** Rows and cells never own the handles: the whole table is the unit. */
export function resolveSideMenuAnchor(
  editor: EditorInstance,
  block: SideMenuBlock | undefined,
): SideMenuBlock | undefined {
  let anchor = block;
  while (anchor !== undefined && (anchor.type === "tableRow" || anchor.type === "tableCell")) {
    anchor = editor.getParentBlock(anchor.id) as SideMenuBlock | undefined;
  }
  return anchor;
}

/** Vertical centring of the 30px menu on the block's first line (BlockNote's own table). */
function sideMenuCrossAxisOffset(block: SideMenuBlock): number {
  if (block.type === "heading") {
    switch (block.props["level"]) {
      case 1:
        return 39;
      case 2:
        return 27;
      case 3:
        return 18.5;
      default:
        return 0;
    }
  }
  // Table block: 10px inset above the grid, then a 39px first row.
  if (block.type === "table") return 14.5;
  if (block.type === "file") return 4;
  if (block.type === "audio") return 15;
  return 0;
}

/**
 * Contextual adjacent-add and draggable handle at the left edge of the
 * hovered block. Mirrors BlockNote's `SideMenuController`, except that a
 * hovered table row or cell anchors the menu on the enclosing table block.
 */
export const BlockSideMenu = memo(function BlockSideMenu({
  onError,
}: {
  readonly onError: (message: string) => void;
}) {
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const state = useExtensionState(SideMenuExtension, {
    editor,
    selector: (current) =>
      current === undefined ? undefined : { show: current.show, block: current.block },
  });
  const show = state?.show === true;
  const anchor = useMemo(
    () => resolveSideMenuAnchor(editor, state?.block as SideMenuBlock | undefined),
    [editor, state?.block],
  );

  // BlockNote hides the menu on ancestor scroll so it never overflows the
  // editor's scroll container. A capturing scroll listener covers the same
  // case without depending on floating-ui's `autoUpdate`.
  const whileElementsMounted = useCallback(() => {
    const hide = (): void => {
      editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen();
    };
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", hide, { capture: true });
  }, [editor]);

  const crossAxis = anchor === undefined ? 0 : sideMenuCrossAxisOffset(anchor);
  const middleware = useMemo(
    () => [
      {
        name: "myownnotion-cross-axis-offset",
        fn: ({ x, y }: { x: number; y: number }) => ({ x, y: y + crossAxis }),
      },
    ],
    [crossAxis],
  );

  return (
    <BlockPopover
      blockId={show ? anchor?.id : undefined}
      useFloatingOptions={{
        open: show,
        placement: "left-start",
        middleware,
        whileElementsMounted,
      }}
      useDismissProps={{ enabled: false }}
      focusManagerProps={{ disabled: true }}
      elementProps={{ style: { zIndex: 20 } }}
    >
      {anchor !== undefined && (
        <SideMenu>
          <MyOwnNotionAddBlockButton block={anchor} onError={onError} />
          <MyOwnNotionDragHandleButton block={anchor} onError={onError} />
        </SideMenu>
      )}
    </BlockPopover>
  );
});
