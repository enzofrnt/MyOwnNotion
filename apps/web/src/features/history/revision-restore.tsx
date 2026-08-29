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
import { AsyncState, Button, Field, FR_COPY, formatDateTime } from "../../ui/index.ts";

interface RevisionView {
  id: string;
  parentRevisionIds: string[];
  acceptedAt: string;
  /** Which device, when the server knows — see `describeAuthor` below. */
  authoredByDeviceId?: string | null;
  authoredByDeviceName?: string | null;
  changeNature?: string;
  snapshotRetained: boolean;
  snapshot: Record<string, unknown> | null;
}

interface RevisionRestorePlan {
  readonly revision: RevisionView;
  /** Canonical head observed after the retained revision was loaded. */
  readonly expectedCurrentRevisionId: Uuid;
}

/**
 * How a device is named in a history entry (FR-022).
 *
 * Three cases, and the third is the one worth being careful about. A named
 * device reads as its name. A device the owner has since deleted has an
 * identifier and no name, so the identifier is shown — it is not friendly, but
 * it distinguishes two deleted devices from each other, which "unknown device"
 * would not. A revision written before attribution existed has neither, and says
 * so plainly rather than borrowing the name of whoever is looking.
 */
function describeAuthor(revision: RevisionView): string {
  if (typeof revision.authoredByDeviceName === "string" && revision.authoredByDeviceName !== "") {
    return revision.authoredByDeviceName;
  }
  if (typeof revision.authoredByDeviceId === "string") {
    return FR_COPY.history.removedDevice;
  }
  return FR_COPY.history.unrecordedDevice;
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
  const [preview, setPreview] = useState<RevisionRestorePlan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageState, setMessageState] = useState<"error" | "conflict" | "success">("success");

  const loadPreview = useCallback(async () => {
    setMessage(null);
    setPreview(null);
    if (!isUuid(revisionId)) {
      setMessageState("error");
      setMessage(FR_COPY.history.invalidId);
      return;
    }
    const revisionResult = await api.getRevision(revisionId);
    if (!revisionResult.ok) {
      setMessageState(
        revisionResult.problem.code === "revision.snapshot-expired" ? "conflict" : "error",
      );
      setMessage(
        revisionResult.problem.code === "revision.snapshot-expired"
          ? FR_COPY.history.expired
          : FR_COPY.history.loadFailed,
      );
      return;
    }

    // The workspace projection and the operational page protocol deliberately
    // converge through separate durable feeds. Read the canonical item only
    // after the preview is available and bind that exact head to the plan. An
    // own-device edit that has already reached the server can therefore be
    // restored immediately even if React still renders the previous projected
    // head; a genuinely concurrent edit *after* this preview still produces
    // the server-side stale-head conflict that protects it from overwrite.
    const itemResult = await api.getItem(item.id);
    if (!itemResult.ok) {
      setMessageState("error");
      setMessage(FR_COPY.history.loadFailed);
      return;
    }
    setPreview({
      revision: revisionResult.value as unknown as RevisionView,
      expectedCurrentRevisionId: itemResult.value.currentRevisionId as Uuid,
    });
  }, [api, item.id, revisionId]);

  const restore = useCallback(async () => {
    if (preview === null) {
      return;
    }
    setMessage(null);
    const result = await api.restoreRevision(
      generateUuidV7(),
      preview.revision.id as Uuid,
      preview.expectedCurrentRevisionId,
    );
    if (!result.ok) {
      if (
        result.problem.code === "mutation.conflict" ||
        result.problem.code === "revision.stale-base"
      ) {
        setMessageState("conflict");
        setMessage(FR_COPY.history.stale);
      } else {
        setMessageState("error");
        setMessage(FR_COPY.history.restoreFailed);
      }
      return;
    }
    setMessageState("success");
    setMessage(FR_COPY.history.restored);
    onRestored?.();
  }, [api, preview, onRestored]);

  const displayedCurrentHead = preview?.expectedCurrentRevisionId ?? item.currentRevisionId;

  return (
    <section
      className="ui-settings-panel"
      aria-label={FR_COPY.history.label}
      data-testid="revision-restore"
    >
      <h2>{FR_COPY.history.title}</h2>
      <p className="muted">
        {FR_COPY.history.currentHead} :{" "}
        <code data-testid="current-head">{displayedCurrentHead}</code>. {FR_COPY.history.retention}
      </p>
      <div className="field-row">
        <Field
          id={`revision-id-${item.id}`}
          label={FR_COPY.history.revisionId}
          data-testid="revision-id-input"
          type="text"
          value={revisionId}
          placeholder={FR_COPY.history.revisionPlaceholder}
          onChange={(event) => setRevisionId(event.target.value)}
        />
        <Button type="button" data-testid="preview-revision" onClick={() => void loadPreview()}>
          {FR_COPY.history.preview}
        </Button>
      </div>
      {preview !== null ? (
        <div data-testid="revision-preview">
          {/* Date, device and nature, in that order and in one sentence: they
              are the three things an owner needs to recognise an entry, and
              splitting them across three lines makes a list of entries harder
              to scan rather than easier. */}
          <p className="muted" data-testid="revision-attribution">
            {FR_COPY.history.changed} {FR_COPY.history.on}{" "}
            {formatDateTime(preview.revision.acceptedAt)} {FR_COPY.history.from}{" "}
            {describeAuthor(preview.revision)}
          </p>
          <p className="muted">
            {FR_COPY.history.parents} :{" "}
            {preview.revision.parentRevisionIds.length === 0
              ? FR_COPY.history.noParent
              : preview.revision.parentRevisionIds.join(", ")}
            {/* Two parents is not a curiosity: it is where two devices' work
                rejoined, and it is the evidence that both originals were kept. */}
            {preview.revision.parentRevisionIds.length > 1 ? ` — ${FR_COPY.history.joined}` : ""}
          </p>
          <p className="muted">{FR_COPY.history.snapshot}</p>
          <pre className="muted" data-testid="revision-snapshot">
            {JSON.stringify(preview.revision.snapshot, null, 2)}
          </pre>
          <Button type="button" data-testid="restore-revision" onClick={() => void restore()}>
            {FR_COPY.history.restore}
          </Button>
        </div>
      ) : null}
      {message !== null ? (
        <AsyncState compact kind={messageState} description={message} testId="restore-feedback" />
      ) : null}
    </section>
  );
}
