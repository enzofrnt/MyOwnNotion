import type { Uuid } from "@myownnotion/domain";
import { TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownShortcutUndo } from "./markdown-shortcuts.ts";
import { SlashCommandExtension } from "./slash-command.ts";
import { TaskItemWithMetadata } from "./task-item.ts";
import { WikiLink, type WikiLinkCandidate } from "./wiki-link.ts";

export function createEditorExtensions(options: {
  readonly sourceItemId: Uuid;
  readonly getWikiLinkCandidates: () => readonly WikiLinkCandidate[];
  readonly onNavigateWikiLink: (targetItemId: Uuid) => void;
}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { defaultLanguage: null },
    }),
    TaskList,
    TaskItemWithMetadata.configure({
      nested: true,
      a11y: {
        checkboxLabel: (_node, checked) =>
          checked ? "Mark task incomplete" : "Mark task complete",
      },
    }),
    Placeholder.configure({
      placeholder: "Write something, type / for blocks, or [[ to link a page…",
      emptyEditorClass: "is-editor-empty",
    }),
    WikiLink.configure({
      sourceItemId: options.sourceItemId,
      getCandidates: options.getWikiLinkCandidates,
      onNavigate: options.onNavigateWikiLink,
    }),
    SlashCommandExtension,
    MarkdownShortcutUndo,
  ];
}
