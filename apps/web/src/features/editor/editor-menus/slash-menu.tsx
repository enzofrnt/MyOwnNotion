import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { fr } from "@blocknote/core/locales";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
} from "@blocknote/react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
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

const insertRichBlock = insertOrUpdateBlockForSlashMenu as unknown as (
  editor: unknown,
  block: unknown,
) => unknown;

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
}

export type CreateSubpage = (
  request: CreateSubpageRequest,
) => Promise<{ readonly id: string; readonly title: string }>;

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
  const current = editor.getTextCursorPosition().block;
  const child = await createSubpage({
    id: current.id,
    title: FR_COPY.editor.slashMenu.subpage.defaultTitle,
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

/** Turns `/lien` back into an empty paragraph before opening the shared target chooser. */
export function prepareLinkFromSlash(
  editor: Pick<SlashEditor, "getTextCursorPosition" | "setTextCursorPosition" | "updateBlock">,
  openLinkFlow: () => void,
): void {
  const current = editor.getTextCursorPosition().block;
  editor.updateBlock(current.id, { type: "paragraph", content: [] });
  editor.setTextCursorPosition(current.id, "start");
  openLinkFlow();
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

/** French, filtered Community menu: no XL or not-yet-durable block leaks into V1. */
export function FrenchSlashMenu({
  onCreateLink,
  onCreateSubpage,
  onSubpageCreated,
  onError,
}: {
  readonly onCreateLink?: (() => void) | undefined;
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onSubpageCreated?:
    | ((child: { readonly id: string; readonly title: string }) => void | Promise<void>)
    | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}) {
  const editor = useBlockNoteEditor();
  const advancedItems = [
    {
      title: FR_COPY.editor.slashMenu.toggle.title,
      subtext: FR_COPY.editor.slashMenu.toggle.description,
      aliases: ["toggle", "details", "déplier"],
      group: FR_COPY.editor.slashMenu.advancedGroup,
      onItemClick: () => insertRichBlock(editor, { type: "toggleListItem", content: "" }),
    },
    {
      title: FR_COPY.editor.slashMenu.callout.title,
      subtext: FR_COPY.editor.slashMenu.callout.description,
      aliases: ["callout", "alerte", "conseil"],
      group: FR_COPY.editor.slashMenu.advancedGroup,
      onItemClick: () =>
        insertRichBlock(editor, {
          type: "callout",
          props: { icon: "💡", tone: "yellow" },
          content: "",
        }),
    },
    {
      title: FR_COPY.editor.slashMenu.table.title,
      subtext: FR_COPY.editor.slashMenu.table.description,
      aliases: ["table", "grille", "colonnes"],
      group: FR_COPY.editor.slashMenu.advancedGroup,
      onItemClick: () => insertTableAfterCurrent(editor as unknown as SlashEditor),
    },
    {
      title: FR_COPY.editor.slashMenu.embed.title,
      subtext: FR_COPY.editor.slashMenu.embed.description,
      aliases: ["embed", "intégration", "vidéo", "figma", "github"],
      group: FR_COPY.editor.slashMenu.advancedGroup,
      onItemClick: () =>
        insertRichBlock(editor, {
          type: "embed",
          props: {
            provider: "bookmark",
            sourceUrl: "https://example.org/",
            caption: "",
          },
        }),
    },
  ];
  const navigationItems = [
    ...(onCreateLink === undefined
      ? []
      : [
          {
            title: FR_COPY.editor.slashMenu.link.title,
            subtext: FR_COPY.editor.slashMenu.link.description,
            aliases: ["lien", "link", "url", "web", "page"],
            group: FR_COPY.editor.slashMenu.navigationGroup,
            onItemClick: () => prepareLinkFromSlash(editor as unknown as SlashEditor, onCreateLink),
          },
        ]),
    ...(onCreateSubpage === undefined
      ? []
      : [
          {
            title: FR_COPY.editor.slashMenu.subpage.title,
            subtext: FR_COPY.editor.slashMenu.subpage.description,
            aliases: ["page", "sous-page", "subpage"],
            group: FR_COPY.editor.slashMenu.navigationGroup,
            onItemClick: () => {
              void createSubpageFromSlash(
                editor as unknown as SlashEditor,
                onCreateSubpage,
                onSubpageCreated,
              ).catch((error: unknown) => {
                onError?.(
                  error instanceof Error
                    ? error.message
                    : FR_COPY.editor.slashMenu.subpage.creationFailed,
                );
              });
            },
          },
        ]),
  ];
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) =>
        filterSuggestionItems(
          [
            ...getDefaultReactSlashMenuItems(editor).filter((item) => US2_TITLES.has(item.title)),
            ...navigationItems,
            ...advancedItems,
          ],
          query,
        )
      }
    />
  );
}
