import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownShortcutUndo } from "./markdown-shortcuts.ts";
import { SlashCommandExtension } from "./slash-command.ts";

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: { defaultLanguage: null },
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: {
      checkboxLabel: (_node, checked) => (checked ? "Mark task incomplete" : "Mark task complete"),
    },
  }),
  Placeholder.configure({
    placeholder: "Write something, or type / for commands…",
    emptyEditorClass: "is-editor-empty",
  }),
  SlashCommandExtension,
  MarkdownShortcutUndo,
];
