import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { useEffect, useState } from "react";
import { FR_COPY } from "../../../ui/copy/fr.ts";
import { formatByteLength } from "../../hierarchy/file-node.tsx";
import {
  type EditorFileResource,
  EditorFileStateLine,
  useEditorFileResource,
} from "../editor-file-state.tsx";

const fileEmbedBlockConfig = {
  type: "fileEmbed",
  propSchema: { fileItemId: { default: "" }, caption: { default: "" } },
  content: "none",
} as const;

function useLocalDownloadUrl(resource: EditorFileResource | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (resource?.kind !== "local") {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(resource.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [resource]);
  return url;
}

function EditorFileBlock({
  block,
  editor,
}: ReactCustomBlockRenderProps<typeof fileEmbedBlockConfig>) {
  const resource = useEditorFileResource(block.props.fileItemId);
  const localUrl = useLocalDownloadUrl(resource);
  const fileName =
    block.props.caption ||
    (resource !== null && resource.kind !== "loading" && resource.kind !== "unavailable"
      ? resource.fileName
      : "Fichier");
  const downloadUrl =
    resource?.kind === "local"
      ? localUrl
      : resource?.kind === "remote"
        ? `/v1/files/${encodeURIComponent(block.props.fileItemId)}/content`
        : null;

  return (
    <article
      className="editor-file-block"
      contentEditable={false}
      aria-label={FR_COPY.editor.files.integratedFile}
    >
      <span className="editor-file-icon" aria-hidden="true">
        ▤
      </span>
      <div className="editor-file-description">
        <label>
          <span className="sr-only">{FR_COPY.editor.files.displayedName}</span>
          <input
            aria-label={FR_COPY.editor.files.displayedName}
            placeholder="Fichier"
            value={block.props.caption}
            disabled={!editor.isEditable}
            onChange={(event) =>
              editor.updateBlock(block.id, { props: { caption: event.currentTarget.value } })
            }
          />
        </label>
        {resource !== null && resource.kind !== "loading" && resource.kind !== "unavailable" ? (
          <small className="muted">
            {resource.mediaType} · {formatByteLength(resource.byteLength)}
          </small>
        ) : null}
        {resource?.kind === "loading" ? (
          <small className="muted" role="status">
            {FR_COPY.editor.files.loading}
          </small>
        ) : null}
        {resource?.kind === "unavailable" ? (
          <small className="editor-file-state" data-state="blocked">
            {resource.detail}
          </small>
        ) : null}
        <EditorFileStateLine fileItemId={block.props.fileItemId} />
      </div>
      {downloadUrl === null ? null : (
        <a href={downloadUrl} download={fileName} className="editor-file-download">
          {FR_COPY.editor.files.download}
        </a>
      )}
    </article>
  );
}

export const fileEmbedBlockSpec = createReactBlockSpec(fileEmbedBlockConfig, {
  meta: { selectable: true, isolating: true },
  render: EditorFileBlock,
  toExternalHTML: ({ block }) => (
    <div data-file-item={block.props.fileItemId}>{block.props.caption || "Fichier"}</div>
  ),
});
