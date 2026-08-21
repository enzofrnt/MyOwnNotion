import { filterSuggestionItems } from "@blocknote/core/extensions";
import { fr } from "@blocknote/core/locales";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
} from "@blocknote/react";

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

/** French, filtered Community menu: no XL or not-yet-durable block leaks into V1. */
export function FrenchSlashMenu() {
  const editor = useBlockNoteEditor();
  return (
    <SuggestionMenuController
      triggerCharacter="/"
      getItems={async (query) =>
        filterSuggestionItems(
          getDefaultReactSlashMenuItems(editor).filter((item) => US2_TITLES.has(item.title)),
          query,
        )
      }
    />
  );
}
