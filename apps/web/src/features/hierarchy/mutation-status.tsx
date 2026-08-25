/**
 * Explicit per-mutation feedback (T076, US4, FR-018/FR-043).
 *
 * Surfaces the durable outbox and conflict records as distinct user-facing
 * states derived from the stored rows — never invented:
 *
 * - `pending`   — durable, never attempted yet
 * - `sending`   — in flight right now
 * - `retrying`  — durable again after an interrupted attempt (recovered)
 * - `conflict`  — a competing revision exists; local work kept for resolution
 * - `rejected`  — deterministically refused by the server; kept, not resubmitted
 *
 * A rejection is never shown as a conflict: one is recoverable by choosing a
 * version, the other needs the command itself to change.
 */

import type { ConflictRecordRow, OutboxMutationRow } from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

type QueueState = "pending" | "sending" | "retrying";

/**
 * Error codes that always denote a competing revision even when the server
 * did not enumerate one. Used only as a fallback: the primary signal is the
 * presence of competing revision identities, which is what actually
 * distinguishes the two cases (FR-042).
 */
const CONFLICT_CODES = new Set(["revision.stale-base", "mutation.conflict"]);

function queueStateOf(row: OutboxMutationRow): QueueState {
  if (row.status === "sending") {
    return "sending";
  }
  // Back to pending after an attempt: the attempt was interrupted and the
  // durable row was recovered without regenerating its mutation ID.
  return row.lastAttemptAt !== null ? "retrying" : "pending";
}

/**
 * A conflict is a rejection that carries competing revision identities: the
 * owner resolves it by choosing between versions. A deterministic rejection
 * carries none — the command itself has to change.
 *
 * Classifying on the recorded identities rather than on the error code matters
 * because the code is not a reliable discriminator: the batch endpoint reports
 * a stale base as `status: "rejected"`, and when the response carries no
 * problem detail the client stores the generic `mutation.rejected`.
 */
function isConflict(row: ConflictRecordRow): boolean {
  return row.competingRevisionIds.length > 0 || CONFLICT_CODES.has(row.errorCode);
}

const QUEUE_HINTS: Record<QueueState, string> = {
  pending: "saved locally, awaiting submission",
  sending: "in flight",
  retrying: "recovered after an interrupted attempt, will submit again",
};

export function MutationStatus({ service }: { readonly service: LocalContentService }) {
  const [queued, setQueued] = useState<OutboxMutationRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecordRow[]>([]);

  useEffect(() => {
    const refresh = async () => {
      setQueued(await service.outbox.all());
      setConflicts(await service.outbox.activeConflicts());
    };
    void refresh();
    return service.subscribe(() => {
      void refresh();
    });
  }, [service]);

  if (queued.length === 0 && conflicts.length === 0) {
    return (
      <p className="muted" data-testid="mutation-status-empty">
        All local changes are accepted.
      </p>
    );
  }

  const unresolved = conflicts.filter(isConflict);
  const rejected = conflicts.filter((row) => !isConflict(row));

  return (
    <section className="panel" aria-label="Local change queue" data-testid="mutation-status">
      <h2>Local changes</h2>
      {queued.length > 0 ? (
        <ul className="tree" data-testid="pending-mutations">
          {queued.map((row) => {
            const state = queueStateOf(row);
            return (
              <li key={row.mutationId} className="tree-row" data-mutation-state={state}>
                <span className="tree-kind">{state}</span>
                <span className="tree-name">{row.commandType}</span>
                <span className="muted">
                  {QUEUE_HINTS[state]} — queued {new Date(row.createdAt).toLocaleTimeString()}
                  {row.lastAttemptAt !== null
                    ? `, last attempt ${new Date(row.lastAttemptAt).toLocaleTimeString()}`
                    : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {unresolved.length > 0 ? (
        <ul className="tree" data-testid="conflict-records">
          {unresolved.map((row) => (
            <li key={row.mutationId} className="tree-row" data-mutation-state="conflict">
              <span className="tree-kind">conflict</span>
              <span className="tree-name">{row.commandType}</span>
              <span className="muted" data-testid={`conflict-${row.mutationId}`}>
                {row.errorCode} — local work kept safe with {row.competingRevisionIds.length}{" "}
                competing revision
                {row.competingRevisionIds.length > 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {rejected.length > 0 ? (
        <ul className="tree" data-testid="rejected-mutations">
          {rejected.map((row) => (
            <li key={row.mutationId} className="tree-row" data-mutation-state="rejected">
              <span className="tree-kind">rejected</span>
              <span className="tree-name">{row.commandType}</span>
              <span className="muted" data-testid={`rejected-${row.mutationId}`}>
                {row.errorCode} — the server refused this change; it is kept locally and will not be
                resubmitted as-is
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
