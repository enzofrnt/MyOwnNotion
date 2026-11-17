import { createReactInlineContentSpec } from "@blocknote/react";
import { TextSelection } from "@tiptap/pm/state";
import { EquationEditor } from "./custom-blocks/equation.tsx";
import { MathPreview } from "./math.tsx";

/**
 * The block that owns an inline equation.
 *
 * Two things keep the caret usable around this atom, both learned from a
 * reproduced failure (feature 067): applying an equation and then typing lost
 * every keystroke, in the same paragraph and in a blank one.
 *
 * 1. The expression is updated **in place** (`setNodeMarkup`) instead of being
 *    replaced. Replacement re-maps the document and the selection to an atom
 *    that no longer exists, so the browser keeps the editor focused while the
 *    caret points nowhere.
 * 2. After applying, focus deliberately returns to the editor, immediately
 *    after the atom. The editor's own preview control sits in a
 *    `contenteditable=false` boundary; leaving focus there sends the next keys
 *    to a button instead of the document.
 *
 * An earlier frame-deferred "dead selection repair" was removed here: a probe
 * showed it also fired during the transient moment between a click and
 * ProseMirror's own selection write, moving the caret to the equation's block
 * and swallowing what the owner typed in another paragraph.
 */
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
    render: ({ inlineContent, updateInlineContent, editor, getPos, node }) => {
      const view = editor.prosemirrorView;
      const liveNode = () => {
        const position = getPos();
        if (position === undefined) return null;
        const current = view.state.doc.nodeAt(position);
        if (current === null || current.type.name !== node.type.name) return null;
        return { current, position };
      };

      const applyExpression = (expression: string) => {
        const live = liveNode();
        if (live === null) {
          // The atom moved or disappeared: the supported replacement is the only
          // remaining option, and it reports its own outcome.
          updateInlineContent({
            type: "inlineEquation",
            props: { ...inlineContent.props, expression },
          });
          return;
        }
        view.dispatch(
          view.state.tr.setNodeMarkup(live.position, undefined, {
            ...live.current.attrs,
            expression,
          }),
        );
      };

      /** Puts the caret just after the atom so the owner can keep writing. */
      const focusAfterApply = () => {
        const live = liveNode();
        if (live === null) return;
        const after = live.position + live.current.nodeSize;
        view.dispatch(
          view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(after), 1)),
        );
        view.focus();
      };

      return (
        <EquationEditor
          inline
          expression={inlineContent.props.expression}
          editable={editor.isEditable}
          onApply={applyExpression}
          onApplied={focusAfterApply}
        />
      );
    },
    toExternalHTML: ({ inlineContent }) => (
      <MathPreview expression={inlineContent.props.expression} />
    ),
  },
);
