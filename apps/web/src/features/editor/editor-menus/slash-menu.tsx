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

/** French, filtered Community menu: no XL or not-yet-durable block leaks into V1. */
export function FrenchSlashMenu() {
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
      onItemClick: () => insertRichBlock(editor, createEditorTable()),
    },
  ];
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) =>
        filterSuggestionItems(
          [
            ...getDefaultReactSlashMenuItems(editor).filter((item) => US2_TITLES.has(item.title)),
            ...advancedItems,
          ],
          query,
        )
      }
    />
  );
}
