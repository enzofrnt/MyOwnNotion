/**
 * A conflict, with both versions reachable (T042, US2, FR-011).
 *
 * The existing mutation status already *lists* conflicts, and listing is not
 * what FR-011 asks for: it asks that the conflict be visible and that both
 * versions be reachable. A row saying "conflict — 1 competing revision" tells
 * an owner something went wrong and gives them no way to see what they wrote.
 *
 * So both versions are rendered as text the owner can read and copy:
 *
 * - **what is on the server** — the document currently in the projection, which
 *   is also what the editor above is showing;
 * - **what this device tried to save** — recovered from the conflict record's
 *   own payload, which is why that payload is kept durably in the first place.
 *
 * Rendered as Markdown through the export path rather than re-implementing a
 * reader, so a block type this component has never heard of still appears
 * instead of vanishing from the version the owner is judging.
 *
 * Nothing here resolves the conflict on the owner's behalf. Keeping their
 * version writes it as a new change on top of the current one — an ordinary
 * edit, causally correct, with the server's version still in the history.
 * Discarding removes the record and leaves the server's version in place. Both
 * are choices someone made; neither happens on a timer.
 */

import type { ConflictRecordRow } from "@myownnotion/client-core";
import { exportMarkdown, readDocumentBody } from "@myownnotion/domain";
import { useCallback, useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

/** The conflicts that concern one item, and that carry a readable document. */
function conflictsForItem(rows: readonly ConflictRecordRow[], itemId: string): ConflictRecordRow[] {
  return rows.filter((row) => {
    const payload = row.payload as { itemId?: unknown };
    return payload.itemId === itemId && row.commandType === "page.document.replace";
  });
}

/**
 * A stored body as text, or null when there is nothing readable in it.
 *
 * Total by construction: a body that fails validation returns null rather than
 * throwing, because a component that crashes while explaining a conflict has
 * turned a recoverable situation into a lost one.
 */
function bodyAsText(body: unknown): string | null {
  const read = readDocumentBody(body);
  if (read.kind !== "blocks" || !read.result.ok) {
    return null;
  }
  return exportMarkdown(read.result.document);
}

function documentFromPayload(payload: Record<string, unknown>): string | null {
  const document = payload["document"];
  if (typeof document !== "object" || document === null) {
    return null;
  }
  return bodyAsText((document as { body?: unknown }).body);
}

export function ConflictNotice({
  service,
  itemId,
  onResolved,
}: {
  readonly service: LocalContentService;
  readonly itemId: string;
  readonly onResolved: () => void;
}) {
  const [conflicts, setConflicts] = useState<ConflictRecordRow[]>([]);
  const [serverText, setServerText] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setConflicts(conflictsForItem(await service.outbox.conflicts(), itemId));
    const item = await service.getItem(itemId as Parameters<typeof service.getItem>[0]);
    setServerText(item?.pageDocument == null ? null : bodyAsText(item.pageDocument.body));
  }, [service, itemId]);

  useEffect(() => {
    void refresh();
    return service.subscribe(() => {
      void refresh();
    });
  }, [service, refresh]);

  const keepMine = useCallback(
    async (row: ConflictRecordRow) => {
      const item = await service.getItem(itemId as Parameters<typeof service.getItem>[0]);
      const payload = row.payload as { document?: unknown };
      if (item === null || payload.document === undefined) {
        return;
      }
      // Written against the *current* revision, not the one the failed attempt
      // was based on. Replaying the stale base would be refused again for the
      // same reason, which would look to the owner like the button doing
      // nothing.
      await service.mutate(
        "page.document.replace",
        { itemId, baseRevisionId: item.currentRevisionId, document: payload.document },
        [item.currentRevisionId],
      );
      await service.outbox.resolveConflict(row.mutationId);
      await refresh();
      onResolved();
    },
    [service, itemId, refresh, onResolved],
  );

  const discardMine = useCallback(
    async (row: ConflictRecordRow) => {
      await service.outbox.resolveConflict(row.mutationId);
      await refresh();
      onResolved();
    },
    [service, refresh, onResolved],
  );

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <section
      className="status-banner"
      data-state="conflict"
      data-testid="conflict-notice"
      role="alert"
      aria-label="This page was changed in two places"
    >
      <p>
        <strong>This page was changed in two places.</strong> Nothing has been thrown away — both
        versions are below, and the one you keep is your choice.
      </p>

      {conflicts.map((row) => {
        const mine = documentFromPayload(row.payload);
        return (
          <div key={row.mutationId} data-testid={`conflict-versions-${row.mutationId}`}>
            <h3>On the server</h3>
            <pre data-testid="conflict-server-version">
              {serverText ?? "This version could not be read on this device."}
            </pre>

            <h3>What this device tried to save</h3>
            <pre data-testid="conflict-local-version">
              {mine ?? "This version could not be read on this device."}
            </pre>

            <div className="tree-actions">
              <button
                type="button"
                data-testid={`conflict-keep-mine-${row.mutationId}`}
                onClick={() => void keepMine(row)}
              >
                Keep this device's version
              </button>
              <button
                type="button"
                data-testid={`conflict-keep-server-${row.mutationId}`}
                onClick={() => void discardMine(row)}
              >
                Keep the server's version
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
