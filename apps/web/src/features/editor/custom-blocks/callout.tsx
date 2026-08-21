import { createReactBlockSpec } from "@blocknote/react";
import { COLOR_TOKENS } from "@myownnotion/domain";

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      icon: { default: "" },
      tone: { default: "default", values: COLOR_TOKENS },
    },
    content: "inline",
  } as const,
  {
    meta: { isolating: false },
    render: ({ block, contentRef }) => (
      <aside className="editor-callout" data-tone={block.props.tone} aria-label="Encadré">
        <span className="editor-callout-icon" aria-hidden="true">
          {block.props.icon || "💡"}
        </span>
        <div className="editor-callout-content" ref={contentRef} />
      </aside>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <aside className="editor-callout" data-tone={block.props.tone}>
        <span aria-hidden="true">{block.props.icon || "💡"}</span>
        <div ref={contentRef} />
      </aside>
    ),
  },
);
