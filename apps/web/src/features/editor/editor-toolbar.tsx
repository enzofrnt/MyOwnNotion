import type { Editor } from "@tiptap/core";
import type { KeyboardEvent } from "react";
import { insertCanvasBlock } from "../canvas/canvas-extension.ts";
import { insertDatabaseBlock } from "../databases/database-extension.ts";

function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, action: () => void): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function ToggleButton({
  label,
  active,
  disabled = false,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => activateWithKeyboard(event, onClick)}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function EditorToolbar({ editor }: { readonly editor: Editor }) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Page formatting">
      <ToggleButton
        label="Paragraph"
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
      />
      {([1, 2, 3] as const).map((level) => (
        <ToggleButton
          key={level}
          label={`Heading ${level}`}
          active={editor.isActive("heading", { level })}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        />
      ))}
      <ToggleButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToggleButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToggleButton
        label="Strike"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToggleButton
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToggleButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToggleButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToggleButton
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <button
        type="button"
        aria-label="Insert canvas"
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => activateWithKeyboard(event, () => void insertCanvasBlock(editor))}
        onClick={() => void insertCanvasBlock(editor)}
      >
        Canvas
      </button>
      <button
        type="button"
        aria-label="Insert database"
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => activateWithKeyboard(event, () => void insertDatabaseBlock(editor))}
        onClick={() => void insertDatabaseBlock(editor)}
      >
        Database
      </button>
      <ToggleButton
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToggleButton
        label="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <button
        type="button"
        aria-label="Insert divider"
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) =>
          activateWithKeyboard(event, () => editor.chain().focus().setHorizontalRule().run())
        }
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        Insert divider
      </button>
      <button
        type="button"
        aria-label="Undo"
        disabled={!editor.can().chain().focus().undo().run()}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) =>
          activateWithKeyboard(event, () => editor.chain().focus().undo().run())
        }
        onClick={() => editor.chain().focus().undo().run()}
      >
        Undo
      </button>
      <button
        type="button"
        aria-label="Redo"
        disabled={!editor.can().chain().focus().redo().run()}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) =>
          activateWithKeyboard(event, () => editor.chain().focus().redo().run())
        }
        onClick={() => editor.chain().focus().redo().run()}
      >
        Redo
      </button>
    </div>
  );
}
