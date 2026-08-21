import { createReactBlockSpec } from "@blocknote/react";

export const imageBlockSpec = createReactBlockSpec(
  {
    type: "image",
    propSchema: {
      fileItemId: { default: "" },
      caption: { default: "" },
      altText: { default: "" },
      displayWidth: { default: 0 },
    },
    content: "none",
  } as const,
  {
    meta: { selectable: true, isolating: true },
    render: ({ block, editor }) => (
      <figure className="editor-image-block" contentEditable={false}>
        <div
          className="editor-image-placeholder"
          role="img"
          aria-label={block.props.altText || "Image disponible localement"}
          style={block.props.displayWidth > 0 ? { maxWidth: block.props.displayWidth } : undefined}
        >
          <span aria-hidden="true">▧</span>
          <span>Aperçu local de l’image</span>
        </div>
        <label>
          <span className="sr-only">Légende de l’image</span>
          <input
            aria-label="Légende de l’image"
            placeholder="Ajouter une légende"
            value={block.props.caption}
            onChange={(event) =>
              editor.updateBlock(block.id, { props: { caption: event.currentTarget.value } })
            }
          />
        </label>
      </figure>
    ),
    toExternalHTML: ({ block }) => (
      <figure data-file-item={block.props.fileItemId}>
        <div role="img" aria-label={block.props.altText || "Image"} />
        {block.props.caption ? <figcaption>{block.props.caption}</figcaption> : null}
      </figure>
    ),
  },
);
