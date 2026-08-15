/**
 * The slash menu (T024, US1, FR-002, FR-019).
 *
 * One of the three insertion routes FR-002 requires, and the discoverable one:
 * an owner who has never read documentation finds the block types by typing
 * `/`, which is what SC-001 is measuring.
 *
 * It is a `listbox` driven by `aria-activedescendant` rather than a set of
 * buttons, because focus must stay in the editor while the owner arrows through
 * the options. Moving focus to the menu would collapse the text selection the
 * insertion is about to act on.
 */

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useId, useState } from "react";

interface BlockChoice {
  readonly id: string;
  readonly label: string;
  readonly apply: (editor: Editor) => void;
}

const CHOICES: readonly BlockChoice[] = [
  { id: "paragraph", label: "Text", apply: (e) => e.chain().focus().setParagraph().run() },
  {
    id: "heading-1",
    label: "Heading 1",
    apply: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "Heading 2",
    apply: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    apply: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bulleted-list",
    label: "Bulleted list",
    apply: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered-list",
    label: "Numbered list",
    apply: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  { id: "checkbox", label: "Checkbox", apply: (e) => e.chain().focus().toggleTaskList().run() },
  { id: "quote", label: "Quote", apply: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "Code", apply: (e) => e.chain().focus().toggleCodeBlock().run() },
  {
    id: "divider",
    label: "Divider",
    apply: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

export function SlashMenu({ editor }: { readonly editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setActive(0);
  }, []);

  const choose = useCallback(
    (choice: BlockChoice) => {
      // Remove the `/` the owner typed to open the menu, so the shortcut
      // characters are not left in the text — the same rule the Markdown-style
      // input rules follow (US1 scenario 1).
      editor
        .chain()
        .focus()
        .deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from })
        .run();
      choice.apply(editor);
      close();
    },
    [editor, close],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editor.isFocused) {
        return;
      }

      if (!open) {
        if (event.key === "/" && editor.state.selection.empty) {
          setOpen(true);
          setActive(0);
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActive((index) => (index + 1) % CHOICES.length);
          break;
        case "ArrowUp":
          event.preventDefault();
          setActive((index) => (index - 1 + CHOICES.length) % CHOICES.length);
          break;
        case "Enter": {
          const choice = CHOICES[active];
          if (choice !== undefined) {
            event.preventDefault();
            choose(choice);
          }
          break;
        }
        case "Escape":
          event.preventDefault();
          close();
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor, open, active, choose, close]);

  if (!open) {
    return null;
  }

  return (
    <div className="slash-menu" data-testid="slash-menu">
      <div
        role="listbox"
        id={listId}
        aria-label="Insert a block"
        aria-activedescendant={`${listId}-${CHOICES[active]?.id ?? ""}`}
        tabIndex={-1}
      >
        {CHOICES.map((choice, index) => (
          <div
            key={choice.id}
            id={`${listId}-${choice.id}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            data-testid={`slash-option-${choice.id}`}
            onMouseDown={(event) => {
              // Mouse down rather than click: a click would move focus out of
              // the editor first, collapsing the selection being acted on.
              event.preventDefault();
              choose(choice);
            }}
          >
            {choice.label}
          </div>
        ))}
      </div>
    </div>
  );
}
