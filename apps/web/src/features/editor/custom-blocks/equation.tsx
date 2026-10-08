import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { Button } from "../../../ui/primitives/index.ts";
import { MathPreview } from "../math.tsx";

export function EquationEditor({
  expression,
  editable,
  onApply,
  inline = false,
}: {
  readonly expression: string;
  readonly editable: boolean;
  readonly onApply: (source: string) => void;
  readonly inline?: boolean;
}) {
  const [editing, setEditing] = useState(expression === "");
  const [draft, setDraft] = useState(expression);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  const close = () => {
    setEditing(false);
    triggerRef.current?.focus();
  };
  const apply = () => {
    onApply(draft);
    close();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: noneditable boundary prevents editor selection; child controls handle all actions.
    <span
      className={inline ? "editor-inline-equation" : "editor-equation"}
      contentEditable={false}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {editable ? (
        <Button
          ref={triggerRef}
          variant="ghost"
          className="editor-equation-preview"
          aria-label={FR_COPY.editor.math.edit}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDraft(expression);
            setEditing(true);
          }}
        >
          <MathPreview expression={expression} displayMode={!inline} />
        </Button>
      ) : (
        <MathPreview expression={expression} displayMode={!inline} />
      )}
      {editing && editable ? (
        <span className="editor-equation-source">
          <label>
            {FR_COPY.editor.math.source}
            <textarea
              ref={inputRef}
              aria-label={FR_COPY.editor.math.source}
              className="ui-native-input"
              value={draft}
              rows={inline ? 2 : 3}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          </label>
          <span className="editor-equation-actions">
            <Button size="compact" variant="primary" onClick={apply}>
              {FR_COPY.editor.math.apply}
            </Button>
            <Button size="compact" variant="ghost" onClick={close}>
              {FR_COPY.editor.math.cancel}
            </Button>
          </span>
          <MathPreview expression={draft} displayMode={!inline} />
        </span>
      ) : null}
    </span>
  );
}
export const equationBlockSpec = createReactBlockSpec(
  { type: "equation", propSchema: { expression: { default: "" } }, content: "none" } as const,
  {
    render: ({ block, editor }) => (
      <EquationEditor
        expression={block.props.expression}
        editable={editor.isEditable}
        onApply={(expression) => editor.updateBlock(block.id, { props: { expression } })}
      />
    ),
    toExternalHTML: ({ block }) => (
      <div className="editor-equation">
        <MathPreview expression={block.props.expression} displayMode />
      </div>
    ),
  },
);
