import { createReactInlineContentSpec } from "@blocknote/react";
import { useEffect } from "react";
import { EquationEditor } from "./custom-blocks/equation.tsx";
import { MathPreview } from "./math.tsx";

/**
 * The block that owns an inline equation.
 *
 * `updateInlineContent` replaces the ProseMirror node with `replaceWith`, so
 * the node view that held the caret is destroyed and a new one mounts. When
 * the replacement or that mount leaves the document selection pointing at a
 * removed node, the browser keeps the editor focused but drops every
 * keystroke until something else moves the caret — a journey that applied an
 * equation and typed immediately lost its text on Firefox.
 *
 * The repair is deliberately narrow: it acts only while the editor holds
 * focus and only when the selection is dead (no range, or an anchor that is
 * no longer in the document). A live caret is never moved, so the owner's own
 * click still decides where they continue writing.
 */
function containingBlockId(
  editor: { readonly prosemirrorState: { readonly doc: unknown } },
  position: number,
): string | null {
  const doc = editor.prosemirrorState.doc as {
    readonly content: { readonly size: number };
    resolve(position: number): {
      readonly depth: number;
      node(depth: number): { readonly attrs: Record<string, unknown> };
    };
  };
  const inside = Math.min(position + 1, doc.content.size);
  try {
    const resolved = doc.resolve(inside);
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      const id = resolved.node(depth).attrs["id"];
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    return null;
  }
  return null;
}

export const equationInlineContentSpec = createReactInlineContentSpec(
  {
    type: "inlineEquation",
    propSchema: {
      equationId: { default: "" },
      expression: { default: "" },
      marksJson: { default: "[]" },
    },
    content: "none",
  } as const,
  {
    render: ({ inlineContent, updateInlineContent, editor, getPos }) => {
      useEffect(() => {
        const repairDeadSelection = (): void => {
          const selection = window.getSelection();
          if (selection === null) return;
          const anchor = selection.anchorNode;
          if (selection.rangeCount > 0 && anchor !== null && anchor.isConnected) return;
          if (!editor.prosemirrorView.hasFocus()) return;
          const position = getPos();
          if (position === undefined) return;
          const blockId = containingBlockId(editor, position);
          if (blockId === null || editor.getBlock(blockId) === undefined) return;
          editor.setTextCursorPosition(blockId, "end");
        };
        // Mount happens during the replacement; one frame later the
        // surrounding nodes and the browser's selection mapping have settled.
        // No dependency list: every render of this node view follows an
        // update, and the check is cheap and a no-op on a live caret.
        const frame = requestAnimationFrame(repairDeadSelection);
        return () => cancelAnimationFrame(frame);
      });

      return (
        <EquationEditor
          inline
          expression={inlineContent.props.expression}
          editable={editor.isEditable}
          onApply={(expression) =>
            updateInlineContent({
              type: "inlineEquation",
              props: { ...inlineContent.props, expression },
            })
          }
        />
      );
    },
    toExternalHTML: ({ inlineContent }) => (
      <MathPreview expression={inlineContent.props.expression} />
    ),
  },
);
