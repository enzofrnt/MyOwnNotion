/**
 * Retained revision preview and restore (T085, US5).
 *
 * Restoring never rewrites history: the retained content becomes a new
 * descendant of the current head. A stale head yields an explicit
 * conflict; an expired snapshot is reported as no longer retained.
 */

import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7, isUuid, type Uuid } from "@myownnotion/domain";
import { useCallback, useMemo, useState } from "react";
import { ContentApi } from "../../services/content-api.ts";

interface RevisionView {
  id: string;
  parentRevisionIds: string[];
  acceptedAt: string;
  snapshotRetained: boolean;
  snapshot: Record<string, unknown> | null;
}

export function RevisionRestore({
  item,
  onRestored,
}: {
  readonly item: ProjectedItem;
  readonly onRestored?: () => void;
}) {
  const api = useMemo(() => new ContentApi(), []);
  const [revisionId, setRevisionId] = useState("");
  const [preview, setPreview] = useState<RevisionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageState, setMessageState] = useState<"error" | "conflict" | "synced">("synced");

  const loadPreview = useCallback(async () => {
    setMessage(null);
    setPreview(null);
    if (!isUuid(revisionId)) {
      setMessageState("error");
      setMessage("Provide a revision UUID");
      return;
    }
    const result = await api.getRevision(revisionId);
    if (!result.ok) {
      setMessageState(result.problem.code === "revision.snapshot-expired" ? "conflict" : "error");
      setMessage(
        result.problem.code === "revision.snapshot-expired"
          ? "This revision's content is no longer retained (24-hour window elapsed); its lineage is preserved"
          : `${result.problem.code}: ${result.problem.title}`,
      );
      return;
    }
    setPreview(result.value as unknown as RevisionView);
  }, [api, revisionId]);

  const restore = useCallback(async () => {
    if (preview === null) {
      return;
    }
    setMessage(null);
    const result = await api.restoreRevision(
      generateUuidV7(),
      preview.id as Uuid,
      item.currentRevisionId,
    );
    if (!result.ok) {
      if (result.problem.code === "mutation.conflict") {
        setMessageState("conflict");
        setMessage(
          "The current head changed since this restore was prepared — reload and retry explicitly",
        );
      } else {
        setMessageState("error");
        setMessage(`${result.problem.code}: ${result.problem.title}`);
      }
      return;
    }
    setMessageState("synced");
    setMessage("Restored as a new revision descending from the current head — history unchanged");
    onRestored?.();
  }, [api, item.currentRevisionId, preview, onRestored]);

  return (
    <section className="panel" aria-label="Revision history" data-testid="revision-restore">
      <h2>History</h2>
      <p className="muted">
        Current head <code data-testid="current-head">{item.currentRevisionId}</code>. Superseded
        content stays restorable for 24 hours.
      </p>
      <div className="field-row">
        <label htmlFor={`revision-id-${item.id}`} className="muted">
          Revision ID
        </label>
        <input
          id={`revision-id-${item.id}`}
          data-testid="revision-id-input"
          type="text"
          value={revisionId}
          placeholder="revision UUID"
          onChange={(event) => setRevisionId(event.target.value)}
        />
        <button type="button" data-testid="preview-revision" onClick={() => void loadPreview()}>
          Preview
        </button>
      </div>
      {preview !== null ? (
        <div data-testid="revision-preview">
          <p className="muted">
            Accepted {preview.acceptedAt} — parents:{" "}
            {preview.parentRevisionIds.length === 0
              ? "none (creation)"
              : preview.parentRevisionIds.join(", ")}
          </p>
          <pre className="muted" data-testid="revision-snapshot">
            {JSON.stringify(preview.snapshot, null, 2)}
          </pre>
          <button type="button" data-testid="restore-revision" onClick={() => void restore()}>
            Restore as new revision
          </button>
        </div>
      ) : null}
      {message !== null ? (
        <p
          className="status-banner"
          data-state={messageState}
          role={messageState === "synced" ? "status" : "alert"}
          data-testid="restore-feedback"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
