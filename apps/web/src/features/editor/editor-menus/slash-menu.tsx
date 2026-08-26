import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { fr } from "@blocknote/core/locales";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
} from "@blocknote/react";
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
  const child = await createSubpage({ id: current.id, title: "Sans titre" });
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
  onCreateSubpage,
  onSubpageCreated,
  onError,
}: {
  readonly onCreateSubpage?: CreateSubpage | undefined;
  readonly onSubpageCreated?:
    | ((child: { readonly id: string; readonly title: string }) => void | Promise<void>)
    | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}) {
  const editor = useBlockNoteEditor();
  const advancedItems = [
    {
      title: "Liste dépliable",
      subtext: "Masquer ou afficher des blocs imbriqués",
      aliases: ["toggle", "details", "déplier"],
      group: "Blocs avancés",
      onItemClick: () => insertRichBlock(editor, { type: "toggleListItem", content: "" }),
    },
    {
      title: "Encadré",
      subtext: "Mettre une information en évidence",
      aliases: ["callout", "alerte", "conseil"],
      group: "Blocs avancés",
      onItemClick: () =>
        insertRichBlock(editor, {
          type: "callout",
          props: { icon: "💡", tone: "yellow" },
          content: "",
        }),
    },
    {
      title: "Tableau simple",
      subtext: "Créer un tableau à identités stables",
      aliases: ["table", "grille", "colonnes"],
      group: "Blocs avancés",
      onItemClick: () => insertTableAfterCurrent(editor as unknown as SlashEditor),
    },
    {
      title: "Contenu intégré",
      subtext: "Ajouter un lien ou un aperçu tiers avec votre accord",
      aliases: ["embed", "vidéo", "figma", "github", "lien"],
      group: "Blocs avancés",
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
  const navigationItems =
    onCreateSubpage === undefined
      ? []
      : [
          {
            title: "Sous-page",
            subtext: "Créer une page imbriquée et insérer son lien",
            aliases: ["page", "sous-page", "subpage"],
            group: "Navigation",
            onItemClick: () => {
              void createSubpageFromSlash(
                editor as unknown as SlashEditor,
                onCreateSubpage,
                onSubpageCreated,
              ).catch((error: unknown) => {
                onError?.(
                  error instanceof Error ? error.message : "La sous-page n’a pas pu être créée.",
                );
              });
            },
          },
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
