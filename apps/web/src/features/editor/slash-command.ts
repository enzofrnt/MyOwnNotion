import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { insertCanvasBlock } from "../canvas/canvas-extension.ts";
import { insertDatabaseBlock } from "../databases/database-extension.ts";
import {
  SlashCommandMenu,
  type SlashCommandMenuHandle,
  type SlashCommandMenuProps,
} from "./slash-command-menu.tsx";

export interface SlashCommandItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly run: (editor: Editor, range: Range) => void;
}

function withDeletedQuery(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Plain text block",
    keywords: ["text", "body"],
    run: (editor, range) => void withDeletedQuery(editor, range).setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Largest section heading",
    keywords: ["title", "h1"],
    run: (editor, range) => void withDeletedQuery(editor, range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    keywords: ["subtitle", "h2"],
    run: (editor, range) => void withDeletedQuery(editor, range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    keywords: ["subtitle", "h3"],
    run: (editor, range) => void withDeletedQuery(editor, range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet-list",
    label: "Bullet list",
    description: "Unordered list",
    keywords: ["bullets", "unordered"],
    run: (editor, range) => void withDeletedQuery(editor, range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    description: "Ordered list",
    keywords: ["number", "ordered"],
    run: (editor, range) => void withDeletedQuery(editor, range).toggleOrderedList().run(),
  },
  {
    id: "task-list",
    label: "Task list",
    description: "Checklist with completion controls",
    keywords: ["checklist", "todo", "task"],
    run: (editor, range) => void withDeletedQuery(editor, range).toggleTaskList().run(),
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "Freeform cards, page references, connections, and drawings",
    keywords: ["spatial", "whiteboard", "diagram", "drawing"],
    run: (editor, range) => {
      withDeletedQuery(editor, range).run();
      insertCanvasBlock(editor);
    },
  },
  {
    id: "database",
    label: "Database",
    description: "Structured records with table, board, and gallery views",
    keywords: ["table", "board", "gallery", "properties"],
    run: (editor, range) => {
      withDeletedQuery(editor, range).run();
      insertDatabaseBlock(editor);
    },
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Indented quotation",
    keywords: ["blockquote", "quotation"],
    run: (editor, range) => void withDeletedQuery(editor, range).setBlockquote().run(),
  },
  {
    id: "code-block",
    label: "Code block",
    description: "Preformatted code",
    keywords: ["code", "preformatted", "fence"],
    run: (editor, range) => void withDeletedQuery(editor, range).setCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal separator",
    keywords: ["horizontal rule", "separator", "line"],
    run: (editor, range) => void withDeletedQuery(editor, range).setHorizontalRule().run(),
  },
];

export function filterSlashCommands(query: string): SlashCommandItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) {
    return [...SLASH_COMMANDS];
  }
  return SLASH_COMMANDS.filter((item) =>
    [item.label, item.description, ...item.keywords].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

export function executeSlashCommand(editor: Editor, range: Range, id: string): boolean {
  const item = SLASH_COMMANDS.find((candidate) => candidate.id === id);
  if (item === undefined) {
    return false;
  }
  item.run(editor, range);
  return true;
}

export const SlashCommandPluginKey = new PluginKey("slash-command");

type MenuSuggestionProps = Pick<
  SuggestionProps<SlashCommandItem, SlashCommandItem>,
  "items" | "command"
>;

export const SlashCommandExtension = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        pluginKey: SlashCommandPluginKey,
        char: "/",
        startOfLine: true,
        allowedPrefixes: null,
        items: ({ query }) => filterSlashCommands(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        allow: ({ state }) => state.selection.$from.parent.type.name === "paragraph",
        render: () => {
          let component: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps> | null = null;
          let unmount: (() => void) | null = null;

          const update = (props: MenuSuggestionProps) => {
            component?.updateProps({ items: props.items, command: props.command });
          };

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashCommandMenu, {
                editor: props.editor,
                props: { items: props.items, command: props.command },
                className: "slash-command-portal",
              });
              unmount = props.mount(component.element);
            },
            onUpdate: update,
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (event.key === "Escape") {
                exitSuggestion(view, SlashCommandPluginKey);
                return true;
              }
              return component?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              unmount?.();
              unmount = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
