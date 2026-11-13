import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  BlockPopover,
  DragHandleMenu,
  SideMenu,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "../../../ui/icons.tsx";
import {
  type BlockDragOrigin,
  beginDatabaseDragPreview,
  endDatabaseDragPreview,
} from "../block-drag-preview.ts";
import { beginSideMenuBlockReorder, endSideMenuBlockReorder } from "../block-drag-reorder.ts";
import {
  type BlockTransform,
  deleteSelectedBlocks,
  duplicateSelectedBlocks,
  moveSelectedBlocks,
  selectBlockForAction,
  transformSelectedBlocks,
} from "../block-selection.ts";
import type { EditorBlock, EditorInstance } from "../blocknote-schema.ts";
import { blockTextSideMenuOffset } from "./block-side-menu-layout.ts";

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

function blockTypeLabel(block: SideMenuBlock): string {
  const level = (block.props as { readonly level?: unknown }).level;
  switch (block.type) {
    case "paragraph":
      return "Texte";
    case "heading":
      return level === 1 ? "Titre 1" : level === 2 ? "Titre 2" : "Titre 3";
    case "bulletListItem":
      return "Liste à puces";
    case "numberedListItem":
      return "Liste numérotée";
    case "checkListItem":
      return "Liste de tâches";
    case "quote":
      return "Citation";
    case "codeBlock":
      return "Code";
    case "table":
      return "Tableau";
    default:
      return "Bloc";
  }
}

function plainTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(plainTextFromContent).join("");
  if (content === null || typeof content !== "object") return "";
  const candidate = content as { readonly text?: unknown; readonly content?: unknown };
  if (typeof candidate.text === "string") return candidate.text;
  return plainTextFromContent(candidate.content);
}

function MyOwnNotionDragHandleMenu({
  block,
  onError,
  anchor,
}: {
  readonly block: SideMenuBlock;
  readonly onError: (message: string) => void;
  readonly anchor: { readonly left: number; readonly top: number };
}) {
  const components = useComponentsContext();
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      searchRef.current?.focus();
      if (attempts >= 10) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlighted result whenever the query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
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
  const Label = components.Generic.Menu.Label;
  const Divider = components.Generic.Menu.Divider;
  const SubRoot = components.Generic.Menu.Root;
  const SubTrigger = components.Generic.Menu.Trigger;
  const SubDropdown = components.Generic.Menu.Dropdown;
  const isTable = block.type === "table";
  const text = plainTextFromContent(block.content);
  const characters = text.length;
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  const shortcut = (value: string) => <span className="bn-block-menu-shortcut">{value}</span>;
  const transforms: readonly {
    readonly label: string;
    readonly icon:
      | "fileText"
      | "heading1"
      | "heading2"
      | "heading3"
      | "list"
      | "taskList"
      | "quote"
      | "code";
    readonly transform: BlockTransform;
  }[] = [
    { label: "Texte", icon: "fileText", transform: "paragraph" },
    { label: "Titre 1", icon: "heading1", transform: "heading-1" },
    { label: "Titre 2", icon: "heading2", transform: "heading-2" },
    { label: "Titre 3", icon: "heading3", transform: "heading-3" },
    { label: "Liste à puces", icon: "list", transform: "bullet-list" },
    { label: "Liste numérotée", icon: "list", transform: "numbered-list" },
    { label: "Liste de tâches", icon: "taskList", transform: "check-list" },
    { label: "Citation", icon: "quote", transform: "quote" },
    { label: "Code", icon: "code", transform: "code" },
  ];
  const flatActions: readonly {
    readonly label: string;
    readonly icon:
      | "fileText"
      | "heading1"
      | "heading2"
      | "heading3"
      | "list"
      | "taskList"
      | "quote"
      | "code"
      | "copy"
      | "arrowUp"
      | "arrowDown"
      | "delete";
    readonly shortcut?: string;
    readonly run: () => void;
  }[] = [
    ...(!isTable
      ? transforms.map((item) => ({
          label: item.label,
          icon: item.icon,
          run: () => execute(() => transformSelectedBlocks(editor, item.transform)),
        }))
      : []),
    {
      label: "Dupliquer",
      icon: "copy",
      shortcut: "⌘D",
      run: () => execute(() => void duplicateSelectedBlocks(editor)),
    },
    {
      label: "Déplacer vers le haut",
      icon: "arrowUp",
      shortcut: "⌥⇧↑",
      run: () =>
        execute(() => {
          if (!moveSelectedBlocks(editor, "up")) {
            throw new Error("Ces blocs sont déjà au début de leur niveau.");
          }
        }),
    },
    {
      label: "Déplacer vers le bas",
      icon: "arrowDown",
      shortcut: "⌥⇧↓",
      run: () =>
        execute(() => {
          if (!moveSelectedBlocks(editor, "down")) {
            throw new Error("Ces blocs sont déjà à la fin de leur niveau.");
          }
        }),
    },
    {
      label: "Supprimer",
      icon: "delete",
      shortcut: "Del",
      run: () => execute(() => deleteSelectedBlocks(editor)),
    },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const results =
    normalizedQuery.length === 0
      ? []
      : flatActions.filter((action) => action.label.toLowerCase().includes(normalizedQuery));

  return (
    <DragHandleMenu>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the menu content forwards type-to-search keys to its input */}
      <div
        className="bn-block-menu"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            searchRef.current?.focus();
            setQuery((current) => current + event.key);
          }
        }}
      >
        <div className="bn-block-menu-search">
          <AppIcon name="search" size="small" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Rechercher des actions"
            placeholder="Rechercher des actions…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                if (results.length > 0)
                  setActiveIndex((index) => (index - 1 + results.length) % results.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                results[activeIndex]?.run();
              } else if (event.key === "Escape" && query.length > 0) {
                event.preventDefault();
                setQuery("");
              } else {
                event.stopPropagation();
              }
            }}
          />
        </div>
        <Label className="bn-block-menu-type">{blockTypeLabel(block)}</Label>
        <Divider />
        {normalizedQuery.length === 0 ? (
          <>
            {isTable ? null : (
              <SubRoot position="right" sub={true}>
                <SubTrigger sub={true}>
                  <Item
                    className="bn-menu-item"
                    subTrigger={true}
                    icon={<AppIcon name="fileText" size="small" />}
                  >
                    <span className="bn-block-menu-label">Transformer en</span>
                  </Item>
                </SubTrigger>
                <SubDropdown sub={true} className="bn-menu-dropdown">
                  {transforms.map((item) => (
                    <Item
                      key={item.transform}
                      className="bn-menu-item"
                      icon={<AppIcon name={item.icon} size="small" />}
                      onClick={() => execute(() => transformSelectedBlocks(editor, item.transform))}
                    >
                      <span className="bn-block-menu-label">{item.label}</span>
                    </Item>
                  ))}
                </SubDropdown>
              </SubRoot>
            )}
            <BlockColorsItem>
              <AppIcon name="palette" size="small" />
              <span className="bn-block-menu-label">Couleur</span>
            </BlockColorsItem>
            <Divider />
            <Item
              className="bn-menu-item"
              icon={<AppIcon name="copy" size="small" />}
              onClick={() => execute(() => void duplicateSelectedBlocks(editor))}
            >
              <span className="bn-block-menu-label" data-testid="side-menu-duplicate">
                Dupliquer
              </span>
              {shortcut("⌘D")}
            </Item>
            <SubRoot position="right" sub={true}>
              <SubTrigger sub={true}>
                <Item
                  className="bn-menu-item"
                  subTrigger={true}
                  icon={<AppIcon name="arrowUp" size="small" />}
                >
                  <span className="bn-block-menu-label">Déplacer</span>
                </Item>
              </SubTrigger>
              <SubDropdown sub={true} className="bn-menu-dropdown">
                <Item
                  className="bn-menu-item"
                  icon={<AppIcon name="arrowUp" size="small" />}
                  onClick={() =>
                    execute(() => {
                      if (!moveSelectedBlocks(editor, "up")) {
                        throw new Error("Ces blocs sont déjà au début de leur niveau.");
                      }
                    })
                  }
                >
                  <span className="bn-block-menu-label">Vers le haut</span>
                  {shortcut("⌥⇧↑")}
                </Item>
                <Item
                  className="bn-menu-item"
                  icon={<AppIcon name="arrowDown" size="small" />}
                  onClick={() =>
                    execute(() => {
                      if (!moveSelectedBlocks(editor, "down")) {
                        throw new Error("Ces blocs sont déjà à la fin de leur niveau.");
                      }
                    })
                  }
                >
                  <span className="bn-block-menu-label">Vers le bas</span>
                  {shortcut("⌥⇧↓")}
                </Item>
              </SubDropdown>
            </SubRoot>
            <Divider />
            <Item
              className="bn-menu-item bn-block-menu-danger"
              icon={<AppIcon name="delete" size="small" />}
              onClick={() => execute(() => deleteSelectedBlocks(editor))}
            >
              <span className="bn-block-menu-label">Supprimer</span>
              {shortcut("Del")}
            </Item>
          </>
        ) : (
          <>
            {results.map((action, index) => (
              <Item
                key={action.label}
                className={`bn-menu-item${index === activeIndex ? " bn-block-menu-active" : ""}`}
                icon={<AppIcon name={action.icon} size="small" />}
                onClick={action.run}
              >
                <span className="bn-block-menu-label">{action.label}</span>
                {action.shortcut === undefined ? null : shortcut(action.shortcut)}
              </Item>
            ))}
            {results.length === 0 ? <p className="bn-block-menu-empty">Aucune action</p> : null}
          </>
        )}
        <div className="bn-block-menu-footer">
          <span>
            {words} mot{words === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {characters} caractère{characters === 1 ? "" : "s"}
          </span>
        </div>
      </div>
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
  const editor = useBlockNoteEditor() as unknown as EditorInstance;
  const sideMenu = useExtension(SideMenuExtension);
  const dragOrigin = useRef<BlockDragOrigin | null>(null);
  const [anchor, setAnchor] = useState({ left: 8, top: 8 });
  if (components === undefined) return null;
  const captureAnchor = (target: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    const width = 226;
    document.documentElement.style.setProperty("--bn-block-menu-x", "12px");
    const left = Math.max(8, Math.min(rect.left - width - 5, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - 150, window.innerHeight - 360));
    setAnchor({ left, top });
  };

  return (
    <components.Generic.Menu.Root
      onOpenChange={(open: boolean) => {
        if (open) sideMenu.freezeMenu();
        else sideMenu.unfreezeMenu();
      }}
      position="left"
    >
      <span
        style={{ display: "contents" }}
        onPointerDownCapture={(event) => {
          dragOrigin.current = { clientX: event.clientX, clientY: event.clientY };
        }}
        onClickCapture={(event) => {
          const target = event.currentTarget.querySelector("button");
          if (target !== null) captureAnchor(target);
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only forwards a context menu to the menu trigger button */}
        <span
          style={{ display: "contents" }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget.querySelector("button");
            if (target !== null) {
              captureAnchor(target);
              target.click();
            }
          }}
        >
          <components.Generic.Menu.Trigger>
            <components.SideMenu.Button
              label={dictionary.side_menu.drag_handle_label}
              draggable={true}
              onDragStart={(event) => {
                sideMenu.blockDragStart(
                  event,
                  block as Parameters<typeof sideMenu.blockDragStart>[1],
                );
                if (block.type === "databaseView") {
                  beginDatabaseDragPreview(editor, block.id, event, dragOrigin.current ?? event);
                }
                beginSideMenuBlockReorder(editor, block.id);
              }}
              onDragEnd={() => {
                dragOrigin.current = null;
                endDatabaseDragPreview();
                endSideMenuBlockReorder();
                sideMenu.blockDragEnd();
              }}
              className="bn-button editor-block-handle"
              icon={
                <AppIcon
                  name="drag"
                  size="large"
                  className="editor-block-handle__icon"
                  data-test="dragHandle"
                />
              }
            />
          </components.Generic.Menu.Trigger>
        </span>
      </span>
      <MyOwnNotionDragHandleMenu block={block} onError={onError} anchor={anchor} />
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

/** Preserve the specialized placement of blocks that have no inline text. */
function sideMenuCrossAxisOffset(block: SideMenuBlock): number {
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

  const middleware = useMemo(
    () => [
      {
        name: "myownnotion-cross-axis-offset",
        fn: ({
          x,
          y,
          elements,
          rects,
        }: {
          x: number;
          y: number;
          elements: { reference: Element | { contextElement?: Element | undefined } };
          rects: { floating: { height: number } };
        }) => {
          const reference =
            "contextElement" in elements.reference
              ? elements.reference.contextElement
              : elements.reference;
          const textOffset =
            anchor?.type !== "table" && reference instanceof Element
              ? blockTextSideMenuOffset(reference, rects.floating.height)
              : undefined;
          return {
            x,
            y: y + (textOffset ?? (anchor === undefined ? 0 : sideMenuCrossAxisOffset(anchor))),
          };
        },
      },
    ],
    [anchor],
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
      elementProps={{ style: { zIndex: 70 } }}
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
