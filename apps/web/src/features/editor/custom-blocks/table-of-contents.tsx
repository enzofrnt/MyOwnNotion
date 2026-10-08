import { createReactBlockSpec } from "@blocknote/react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { type HeadingsEditor, scrollToPageHeading, usePageHeadings } from "../page-headings.ts";

function Contents({
  editor,
}: {
  readonly editor: HeadingsEditor & { readonly domElement: HTMLElement | undefined };
}) {
  const headings = usePageHeadings(editor);
  return (
    <nav
      className="editor-contents"
      contentEditable={false}
      onMouseDown={(event) => event.stopPropagation()}
      aria-label={FR_COPY.editor.contents.label}
    >
      {headings.length === 0 ? (
        <span className="editor-contents-empty">{FR_COPY.editor.contents.empty}</span>
      ) : (
        <ol className="editor-contents-list">
          {headings.map((heading) => (
            <li key={heading.id} style={{ paddingInlineStart: `${(heading.level - 1) * 12}px` }}>
              <button
                type="button"
                className="editor-contents-link"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (editor.domElement !== undefined)
                    scrollToPageHeading(editor.domElement, heading.id);
                }}
              >
                {heading.text || FR_COPY.editor.outline.emptyHeading}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
export const tableOfContentsBlockSpec = createReactBlockSpec(
  { type: "tableOfContents", propSchema: {}, content: "none" } as const,
  {
    render: ({ editor }) => <Contents editor={editor} />,
    toExternalHTML: () => (
      <nav aria-label={FR_COPY.editor.contents.label}>{FR_COPY.editor.contents.title}</nav>
    ),
  },
);
