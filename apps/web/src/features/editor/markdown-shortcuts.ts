import { type Editor, Extension } from "@tiptap/core";

export interface MarkdownShortcut {
  readonly id: string;
  readonly label: string;
  readonly input: string;
  readonly activation: string;
  readonly startPattern: RegExp;
}

export const MARKDOWN_SHORTCUTS: readonly MarkdownShortcut[] = [
  { id: "heading-1", label: "Heading 1", input: "#", activation: "Space", startPattern: /^# $/ },
  {
    id: "heading-2",
    label: "Heading 2",
    input: "##",
    activation: "Space",
    startPattern: /^## $/,
  },
  {
    id: "heading-3",
    label: "Heading 3",
    input: "###",
    activation: "Space",
    startPattern: /^### $/,
  },
  {
    id: "bullet-list",
    label: "Bullet list",
    input: "-",
    activation: "Space",
    startPattern: /^- $/,
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    input: "1.",
    activation: "Space",
    startPattern: /^1\. $/,
  },
  {
    id: "task-list",
    label: "Task list",
    input: "[ ]",
    activation: "Space",
    startPattern: /^\[ \] $/,
  },
  { id: "quote", label: "Quote", input: ">", activation: "Space", startPattern: /^> $/ },
  {
    id: "code-block",
    label: "Code block",
    input: "```",
    activation: "Space",
    startPattern: /^``` $/,
  },
  {
    id: "divider",
    label: "Divider",
    input: "---",
    activation: "third dash",
    startPattern: /^---$/,
  },
];

export function matchingMarkdownShortcut(input: string): MarkdownShortcut | null {
  return MARKDOWN_SHORTCUTS.find((shortcut) => shortcut.startPattern.test(input)) ?? null;
}

function restoreEmptyTransformedBlock(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.parent.textContent.length > 0) {
    return false;
  }
  if (editor.isActive("heading")) {
    const level = Number(editor.getAttributes("heading")["level"] ?? 1);
    return editor
      .chain()
      .setParagraph()
      .insertContent(`${"#".repeat(level)} `)
      .run();
  }
  return false;
}

/** Restores the literal Markdown prefix before falling back to normal history. */
export const MarkdownShortcutUndo = Extension.create({
  name: "markdownShortcutUndo",
  priority: 1_000,
  addKeyboardShortcuts() {
    return {
      "Mod-z": () =>
        restoreEmptyTransformedBlock(this.editor) || this.editor.commands.undoInputRule(),
    };
  },
});
