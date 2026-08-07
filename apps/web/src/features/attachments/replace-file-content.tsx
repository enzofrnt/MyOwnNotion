/**
 * Copy-on-write file-content replacement (T061, US2).
 *
 * Replacing through any placement updates the one logical file; the
 * feedback makes explicit that every placement now exposes the new
 * content and that independently imported files are untouched (FR-030/036).
 */
import { useCallback, useState } from "react";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { ContentApi } from "../../services/content-api.ts";

export function ReplaceFileContent({
  itemId,
  currentRevisionId,
  onReplaced,
}: {
  readonly itemId: Uuid;
  readonly currentRevisionId: Uuid;
  readonly onReplaced?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error" | "conflict">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const replace = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (file === undefined) {
        return;
      }
      setStatus("busy");
      setMessage(null);
      const api = new ContentApi();
      const result = await api.replaceFileContent(
        generateUuidV7(),
        itemId,
        currentRevisionId,
        file,
      );
      if (!result.ok) {
        if (result.problem.code === "revision.stale-base") {
          setStatus("conflict");
          setMessage("The file changed elsewhere; reload to update from the accepted revision");
        } else {
          setStatus("error");
          setMessage(`${result.problem.code}: ${result.problem.title}`);
        }
        return;
      }
      setStatus("done");
      setMessage("Content replaced — every placement of this file now shows the new content");
      onReplaced?.();
    },
    [itemId, currentRevisionId, onReplaced],
  );

  return (
    <span className="field-row">
      <label htmlFor={`replace-content-${itemId}`} className="muted">
        Replace content
      </label>
      <input
        id={`replace-content-${itemId}`}
        data-testid={`replace-content-${itemId}`}
        type="file"
        disabled={status === "busy"}
        onChange={(event) => void replace(event.target.files)}
      />
      {message !== null ? (
        <span
          className={status === "done" ? "muted" : "status-banner"}
          data-state={status === "conflict" ? "conflict" : status === "error" ? "error" : "synced"}
          role={status === "done" ? "status" : "alert"}
          data-testid="replace-feedback"
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
