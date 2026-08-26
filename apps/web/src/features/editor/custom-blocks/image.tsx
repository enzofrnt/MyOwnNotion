import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { useEffect, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import {
  type EditorFileResource,
  EditorFileStateLine,
  useEditorFileResource,
} from "../editor-file-state.tsx";

const imageBlockConfig = {
  type: "image",
  propSchema: {
    fileItemId: { default: "" },
    caption: { default: "" },
    altText: { default: "" },
    displayWidth: { default: 0 },
  },
  content: "none",
} as const;

type ImageSource =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "failed" };

function useImageSource(
  fileItemId: string | undefined,
  resource: EditorFileResource | null,
): ImageSource {
  const [source, setSource] = useState<ImageSource>({ kind: "loading" });

  useEffect(() => {
    if (resource === null || resource.kind === "loading") {
      setSource({ kind: "loading" });
      return;
    }
    if (resource.kind === "unavailable" || !resource.mediaType.startsWith("image/")) {
      setSource({ kind: "failed" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    const expose = (blob: Blob): void => {
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setSource({ kind: "ready", url: objectUrl });
    };

    if (resource.kind === "local") {
      expose(resource.file);
    } else if (fileItemId !== undefined) {
      setSource({ kind: "loading" });
      void fetch(`/v1/files/${encodeURIComponent(fileItemId)}/content`, {
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("unavailable image bytes");
          return new Blob([await response.arrayBuffer()], { type: resource.mediaType });
        })
        .then(expose)
        .catch(() => {
          if (!cancelled) setSource({ kind: "failed" });
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [fileItemId, resource]);

  return source;
}

function EditorImageBlock({ block, editor }: ReactCustomBlockRenderProps<typeof imageBlockConfig>) {
  const resource = useEditorFileResource(block.props.fileItemId);
  const source = useImageSource(block.props.fileItemId, resource);

  return (
    <figure className="editor-image-block" contentEditable={false}>
      {source.kind === "ready" ? (
        <img
          className="editor-image-preview"
          src={source.url}
          alt={block.props.altText}
          style={block.props.displayWidth > 0 ? { maxWidth: block.props.displayWidth } : undefined}
        />
      ) : (
        <div
          className="editor-image-placeholder"
          role="img"
          aria-label={block.props.altText || FR_COPY.editor.files.imageUnavailable}
          aria-busy={source.kind === "loading" || undefined}
          style={block.props.displayWidth > 0 ? { maxWidth: block.props.displayWidth } : undefined}
        >
          <span aria-hidden="true">▧</span>
          <span>
            {source.kind === "loading"
              ? FR_COPY.editor.files.imageLoading
              : FR_COPY.editor.files.imageUnavailable}
          </span>
        </div>
      )}
      <EditorFileStateLine fileItemId={block.props.fileItemId} />
      {resource?.kind === "unavailable" ? (
        <p className="editor-file-state" data-state="blocked">
          {resource.detail}
        </p>
      ) : null}
      <div className="editor-image-fields">
        <label>
          <span className="sr-only">{FR_COPY.editor.files.imageCaption}</span>
          <input
            aria-label={FR_COPY.editor.files.imageCaption}
            placeholder={FR_COPY.editor.files.imageCaption}
            value={block.props.caption}
            disabled={!editor.isEditable}
            onChange={(event) =>
              editor.updateBlock(block.id, { props: { caption: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          <span className="sr-only">{FR_COPY.editor.files.imageAltText}</span>
          <input
            aria-label={FR_COPY.editor.files.imageAltText}
            placeholder={FR_COPY.editor.files.imageAltText}
            value={block.props.altText}
            disabled={!editor.isEditable}
            onChange={(event) =>
              editor.updateBlock(block.id, { props: { altText: event.currentTarget.value } })
            }
          />
        </label>
      </div>
    </figure>
  );
}

export const imageBlockSpec = createReactBlockSpec(imageBlockConfig, {
  meta: { selectable: true, isolating: true },
  render: EditorImageBlock,
  toExternalHTML: ({ block }) => (
    <figure data-file-item={block.props.fileItemId}>
      <div role="img" aria-label={block.props.altText || "Image"} />
      {block.props.caption ? <figcaption>{block.props.caption}</figcaption> : null}
    </figure>
  ),
});
