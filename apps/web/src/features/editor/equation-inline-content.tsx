import { createReactInlineContentSpec } from "@blocknote/react";
import { EquationEditor } from "./custom-blocks/equation.tsx";
import { MathPreview } from "./math.tsx";

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
    render: ({ inlineContent, updateInlineContent, editor }) => (
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
    ),
    toExternalHTML: ({ inlineContent }) => (
      <MathPreview expression={inlineContent.props.expression} />
    ),
  },
);
