/**
 * Copy-on-write file-content replacement (T061, US2).
 *
 * Replacing through any placement updates the one logical file; the
 * feedback makes explicit that every placement now exposes the new
 * content and that independently imported files are untouched (FR-030/036).
 */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { useCallback, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";
import { AsyncState, FR_COPY } from "../../ui/index.ts";

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
          setMessage(FR_COPY.files.replacement.stale);
        } else {
          setStatus("error");
          setMessage(FR_COPY.files.replacement.failed);
        }
        return;
      }
      setStatus("done");
      setMessage(FR_COPY.files.replacement.done);
      onReplaced?.();
    },
    [itemId, currentRevisionId, onReplaced],
  );

  return (
    <span className="field-row">
      <label htmlFor={`replace-content-${itemId}`} className="muted">
        {FR_COPY.files.replacement.label}
      </label>
      <input
        id={`replace-content-${itemId}`}
        data-testid={`replace-content-${itemId}`}
        type="file"
        disabled={status === "busy"}
        onChange={(event) => void replace(event.target.files)}
      />
      {message !== null ? (
        <AsyncState
          compact
          kind={status === "done" ? "success" : status === "conflict" ? "conflict" : "error"}
          description={message}
          testId="replace-feedback"
        />
      ) : null}
    </span>
  );
}
