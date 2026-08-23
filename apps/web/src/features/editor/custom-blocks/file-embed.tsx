import { createReactBlockSpec } from "@blocknote/react";
import { EditorFileStateLine } from "../editor-file-state.tsx";

export const fileEmbedBlockSpec = createReactBlockSpec(
  {
    type: "fileEmbed",
    propSchema: { fileItemId: { default: "" }, caption: { default: "" } },
    content: "none",
  } as const,
  {
    meta: { selectable: true, isolating: true },
    render: ({ block, editor }) => (
      <article className="editor-file-block" contentEditable={false} aria-label="Fichier intégré">
        <span className="editor-file-icon" aria-hidden="true">
          ▤
        </span>
        <label>
          <span className="sr-only">Nom affiché du fichier</span>
          <input
            aria-label="Nom affiché du fichier"
            placeholder="Fichier"
            value={block.props.caption}
            onChange={(event) =>
              editor.updateBlock(block.id, { props: { caption: event.currentTarget.value } })
            }
          />
        </label>
        <EditorFileStateLine fileItemId={block.props.fileItemId} />
      </article>
    ),
    toExternalHTML: ({ block }) => (
      <div data-file-item={block.props.fileItemId}>{block.props.caption || "Fichier"}</div>
    ),
  },
);
