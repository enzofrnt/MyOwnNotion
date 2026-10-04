import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { fr } from "@blocknote/core/locales";
import {
  type DefaultReactSuggestionItem,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
} from "@blocknote/react";
import { generateUuidV7 } from "@myownnotion/domain";
import type { ReactElement } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { AppIcon, type AppIconName } from "../../../ui/icons.tsx";
import { ItemIcon } from "../../../ui/item-icon.tsx";
import { createEditorTable } from "../custom-blocks/table.tsx";

const US2_TITLES = new Set([
  fr.slash_menu.paragraph.title,
  fr.slash_menu.heading.title,
  fr.slash_menu.heading_2.title,
  fr.slash_menu.heading_3.title,
  fr.slash_menu.quote.title,
  fr.slash_menu.numbered_list.title,
  fr.slash_menu.bullet_list.title,
  fr.slash_menu.check_list.title,
  fr.slash_menu.code_block.title,
  fr.slash_menu.divider.title,
]);

/** Keeps Titre 4 beside Titre 1–3. BlockNote files levels above 3 in another group. */
export function slashItemsWithHeading4(
  defaults: readonly DefaultReactSuggestionItem[],
  heading4: DefaultReactSuggestionItem | undefined,
): DefaultReactSuggestionItem[] {
  const visible = defaults.filter((item) => US2_TITLES.has(item.title));
  if (heading4 === undefined) return visible;
  const placed = { ...heading4, group: fr.slash_menu.heading.group };
  const index = visible.findLastIndex((item) => item.title === fr.slash_menu.heading_3.title);
  if (index < 0) return [...visible, placed];
  return [...visible.slice(0, index + 1), placed, ...visible.slice(index + 1)];
}

const insertRichBlock = insertOrUpdateBlockForSlashMenu as unknown as (
  editor: unknown,
  block: unknown,
) => unknown;

// The portal belongs to the editor, inside the page's scrolling surface.
// Position against the viewport so WebKit does not undo the menu's own scroll
// while revealing an option. Floating UI still tracks the caret and ancestors.
const SLASH_MENU_FLOATING_OPTIONS = { useFloatingOptions: { strategy: "fixed" } } as const;

interface SlashEditor {
  getTextCursorPosition(): {
    readonly block: { readonly id: string; readonly type: string; readonly content: unknown };
  };
  insertBlocks(blocks: unknown[], reference: string, placement: "before" | "after"): unknown;
  removeBlocks(blockIds: string[]): unknown;
  updateBlock(blockId: string, update: unknown): unknown;
  setTextCursorPosition(blockId: string, placement: "start" | "end"): unknown;
}

export interface CreateSubpageRequest {
  readonly id: string;
  readonly title: string;
  readonly initialViewId?: string;
}

export type CreateSubpage = (
  request: CreateSubpageRequest,
) => Promise<{ readonly id: string; readonly title: string }>;

export type CreateInlineDatabase = (
  request: CreateSubpageRequest,
) => Promise<{ readonly id: string; readonly viewId: string }>;

function slashIcon(name: AppIconName): ReactElement {
  return <AppIcon name={name} size="medium" />;
}

export async function createInlineDatabaseFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "updateBlock">,
  createDatabase: CreateInlineDatabase,
): Promise<void> {
  const current = editor.getTextCursorPosition().block;
  // Reuse the block identity so a retry after a durable create but failed
  // editor commit reattaches the same owner instead of leaving another child.
  const ownerId = current.id;
  const viewId = generateUuidV7();
  const created = await createDatabase({
    id: ownerId,
    title: "Nouvelle base de données",
    initialViewId: viewId,
  });
  editor.updateBlock(current.id, {
    type: "databaseView",
    props: { containerItemId: created.id, viewId: created.viewId },
  });
}

/**
 * Creates the hierarchy item before replacing the slash block with its link.
 * The block UUID doubles as the child UUID, making a retry after an interrupted
 * local mutation idempotent without adding a second identity map.
 */
export async function createSubpageFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "updateBlock">,
  createSubpage: CreateSubpage,
  onCreated?: (child: { readonly id: string; readonly title: string }) => void | Promise<void>,
): Promise<void> {
  return createLinkedChildFromSlash(
    editor,
    createSubpage,
    FR_COPY.editor.slashMenu.page.defaultTitle,
    onCreated,
  );
}

export async function createSubfolderFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "updateBlock">,
  createSubfolder: CreateSubpage,
  onCreated?: (child: { readonly id: string; readonly title: string }) => void | Promise<void>,
): Promise<void> {
  return createLinkedChildFromSlash(
    editor,
    createSubfolder,
    FR_COPY.editor.slashMenu.folder.defaultTitle,
    onCreated,
  );
}

export async function createLinkedChildFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "updateBlock">,
  createChild: CreateSubpage,
  title: string,
  onCreated?: (child: { readonly id: string; readonly title: string }) => void | Promise<void>,
): Promise<void> {
  const current = editor.getTextCursorPosition().block;
  const child = await createChild({
    id: current.id,
    title,
  });
  editor.updateBlock(current.id, {
    type: "paragraph",
    content: [
      {
        type: "pageLink",
        props: { targetItemId: child.id },
        content: [{ type: "text", text: child.title, styles: {} }],
      },
    ],
  });
  await onCreated?.(child);
}

/** Clears a slash query before opening one of the two explicit link pickers. */
export function prepareLinkFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "setTextCursorPosition" | "updateBlock">,
  openLinkFlow: (blockId: string) => void,
): void {
  const current = editor.getTextCursorPosition().block;
  editor.updateBlock(current.id, { type: "paragraph", content: [] });
  editor.setTextCursorPosition(current.id, "start");
  openLinkFlow(current.id);
}

/**
 * Tables enter as a new block rather than a type change: their row/column
 * structure has no empty-transform semantics in the operational model, so the
 * insertion stays expressible as one atomic `insert-block` command.
 */
function insertTableAfterCurrent(editor: SlashEditor): void {
  const current = editor.getTextCursorPosition().block;
  editor.insertBlocks([createEditorTable()], current.id, "after");
  if (
    current.type === "paragraph" &&
    Array.isArray(current.content) &&
    current.content.length === 0
  ) {
    editor.removeBlocks([current.id]);
  }
}

function reportCreationError(
  error: unknown,
  fallback: string,
  onError?: ((message: string) => void) | undefined,
): void {
  onError?.(error instanceof Error ? error.message : fallback);
}

/** Custom slash entries with icons and stable group order for the French menu. */
export function buildCustomSlashMenuItems({
  editor,
  onCreatePageLink,
  onCreateWebBookmark,
  onCreateSubpage,
  onCreateSubfolder,
  onCreateFullPageDatabase,
  onCreateInlineDatabase,
  onCreateLinkedDatabaseView,
  onSubpageCreated,
  onError,
}: {
  readonly editor: unknown;
  readonly onCreatePageLink?: (() => void) | undefined;
  readonly onCreateWebBookmark?: ((blockId: string) => void) | undefined;
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onCreateSubfolder?: CreateSubpage | undefined;
  readonly onCreateFullPageDatabase?: CreateSubpage | undefined;
  readonly onCreateInlineDatabase?: CreateInlineDatabase | undefined;
  readonly onCreateLinkedDatabaseView?: ((blockId: string) => void) | undefined;
  readonly onSubpageCreated?:
    | ((child: { readonly id: string; readonly title: string }) => void | Promise<void>)
    | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}): DefaultReactSuggestionItem[] {
  const slashEditor = editor as SlashEditor;
  const copy = FR_COPY.editor.slashMenu;
  const organization: DefaultReactSuggestionItem[] = [
    ...(onCreateSubpage === undefined
      ? []
      : [
          {
            title: copy.page.title,
            subtext: copy.page.description,
            aliases: ["page", "sous-page", "subpage", "nouvelle page"],
            group: copy.organizationGroup,
            icon: slashIcon("fileAdd"),
            onItemClick: () => {
              void createSubpageFromSlash(slashEditor, onCreateSubpage, onSubpageCreated).catch(
                (error: unknown) => reportCreationError(error, copy.page.creationFailed, onError),
              );
            },
          },
        ]),
    ...(onCreateSubfolder === undefined
      ? []
      : [
          {
            title: copy.folder.title,
            subtext: copy.folder.description,
            aliases: ["dossier", "folder", "sous-dossier", "nouveau dossier"],
            group: copy.organizationGroup,
            icon: slashIcon("folderAdd"),
            onItemClick: () => {
              void createSubfolderFromSlash(slashEditor, onCreateSubfolder, onSubpageCreated).catch(
                (error: unknown) => reportCreationError(error, copy.folder.creationFailed, onError),
              );
            },
          },
        ]),
  ];
  const links: DefaultReactSuggestionItem[] = [
    ...(onCreatePageLink === undefined
      ? []
      : [
          {
            title: copy.pageLink.title,
            subtext: copy.pageLink.description,
            aliases: ["lien page", "page-link", "référence", "interne"],
            group: copy.linksGroup,
            icon: slashIcon("link"),
            onItemClick: () => prepareLinkFromSlash(slashEditor, onCreatePageLink),
          },
        ]),
    ...(onCreateWebBookmark === undefined
      ? []
      : [
          {
            title: copy.webBookmark.title,
            subtext: copy.webBookmark.description,
            aliases: ["lien web", "url", "bookmark", "site"],
            group: copy.linksGroup,
            icon: slashIcon("reference"),
            onItemClick: () => prepareLinkFromSlash(slashEditor, onCreateWebBookmark),
          },
        ]),
  ];
  const databases: DefaultReactSuggestionItem[] = [
    ...(onCreateFullPageDatabase === undefined
      ? []
      : [
          {
            title: copy.fullPageDatabase.title,
            subtext: copy.fullPageDatabase.description,
            aliases: ["base", "database", "pleine page"],
            group: copy.databaseGroup,
            icon: slashIcon("layersAdd"),
            onItemClick: () => {
              void createLinkedChildFromSlash(
                slashEditor,
                onCreateFullPageDatabase,
                copy.fullPageDatabase.defaultTitle,
                onSubpageCreated,
              ).catch((error: unknown) =>
                reportCreationError(error, copy.fullPageDatabase.creationFailed, onError),
              );
            },
          },
        ]),
    ...(onCreateInlineDatabase === undefined
      ? []
      : [
          {
            title: copy.inlineDatabase.title,
            subtext: copy.inlineDatabase.description,
            aliases: ["base intégrée", "base inline", "database inline"],
            group: copy.databaseGroup,
            icon: slashIcon("layersAdd"),
            onItemClick: () => {
              void createInlineDatabaseFromSlash(slashEditor, onCreateInlineDatabase).catch(
                (error: unknown) =>
                  reportCreationError(error, copy.inlineDatabase.creationFailed, onError),
              );
            },
          },
        ]),
    ...(onCreateLinkedDatabaseView === undefined
      ? []
      : [
          {
            title: copy.linkedDatabase.title,
            subtext: copy.linkedDatabase.description,
            aliases: ["vue liée", "base existante", "linked database"],
            group: copy.databaseGroup,
            icon: <ItemIcon kind="database_view" size="inline" />,
            onItemClick: () =>
              onCreateLinkedDatabaseView(slashEditor.getTextCursorPosition().block.id),
          },
        ]),
  ];
  const advanced: DefaultReactSuggestionItem[] = [
    {
      title: copy.toggle.title,
      subtext: copy.toggle.description,
      aliases: ["toggle", "details", "déplier"],
      group: copy.advancedGroup,
      icon: slashIcon("list"),
      onItemClick: () => insertRichBlock(editor, { type: "toggleListItem", content: "" }),
    },
    {
      title: copy.callout.title,
      subtext: copy.callout.description,
      aliases: ["callout", "alerte", "conseil"],
      group: copy.advancedGroup,
      icon: slashIcon("info"),
      onItemClick: () =>
        insertRichBlock(editor, {
          type: "callout",
          props: { icon: "💡", tone: "yellow" },
          content: "",
        }),
    },
    {
      title: copy.table.title,
      subtext: copy.table.description,
      aliases: ["table", "grille", "colonnes"],
      group: copy.advancedGroup,
      icon: slashIcon("table"),
      onItemClick: () => insertTableAfterCurrent(slashEditor),
    },
    {
      title: copy.embed.title,
      subtext: copy.embed.description,
      aliases: ["embed", "intégration", "vidéo", "figma", "github"],
      group: copy.advancedGroup,
      icon: slashIcon("image"),
      onItemClick: () =>
        insertRichBlock(editor, {
          type: "embed",
          props: {
            provider: "youtube",
            sourceUrl: "https://www.youtube.com/watch?v=",
            caption: "",
          },
        }),
    },
  ];
  // Order of first appearance defines the visible group order in the menu.
  return [...organization, ...links, ...databases, ...advanced];
}

/** French, filtered Community menu: no XL or not-yet-durable block leaks into V1. */
export function FrenchSlashMenu({
  onCreatePageLink,
  onCreateWebBookmark,
  onCreateSubpage,
  onCreateSubfolder,
  onCreateFullPageDatabase,
  onCreateInlineDatabase,
  onCreateLinkedDatabaseView,
  onSubpageCreated,
  onError,
}: {
  readonly onCreatePageLink?: (() => void) | undefined;
  readonly onCreateWebBookmark?: ((blockId: string) => void) | undefined;
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onCreateSubfolder?: CreateSubpage | undefined;
  readonly onCreateFullPageDatabase?: CreateSubpage | undefined;
  readonly onCreateInlineDatabase?: CreateInlineDatabase | undefined;
  readonly onCreateLinkedDatabaseView?: ((blockId: string) => void) | undefined;
  readonly onSubpageCreated?:
    | ((child: { readonly id: string; readonly title: string }) => void | Promise<void>)
    | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}) {
  const editor = useBlockNoteEditor();
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      floatingUIOptions={SLASH_MENU_FLOATING_OPTIONS}
      getItems={async (query) => {
        const defaults = getDefaultReactSlashMenuItems(editor);
        return filterSuggestionItems(
          [
            ...slashItemsWithHeading4(
              defaults,
              defaults.find((item) => item.title === fr.slash_menu.heading_4.title),
            ),
            ...buildCustomSlashMenuItems({
              editor,
              onCreatePageLink,
              onCreateWebBookmark,
              onCreateSubpage,
              onCreateSubfolder,
              onCreateFullPageDatabase,
              onCreateInlineDatabase,
              onCreateLinkedDatabaseView,
              onSubpageCreated,
              onError,
            }),
          ],
          query,
        );
      }}
    />
  );
}
