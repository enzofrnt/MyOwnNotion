/**
 * Explicit per-mutation feedback (T076, US4, FR-043).
 *
 * Surfaces the durable outbox and conflict records as user-facing states:
 * pending (durable, awaiting submission), sending (in flight, recovered to
 * pending on interruption), accepted (acknowledged and removed), and
 * conflict (retained durably with competing revisions).
 */

import type { ConflictRecordRow, OutboxMutationRow } from "@myownnotion/client-core";
import { useEffect, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

export function MutationStatus({ service }: { readonly service: LocalContentService }) {
  const [pending, setPending] = useState<OutboxMutationRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecordRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setPending(await service.outbox.all());
      setConflicts(await service.outbox.conflicts());
      if (!cancelled) {
        setHydrated(true);
      }
    };
    setHydrated(false);
    void refresh();
    const unsubscribe = service.subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service]);

  if (!hydrated) {
    return (
      <p className="muted" role="status" data-testid="mutation-status-loading">
        Loading local changes…
      </p>
    );
  }

  if (pending.length === 0 && conflicts.length === 0) {
    return (
      <p className="muted" data-testid="mutation-status-empty">
        All local changes are accepted.
      </p>
    );
  }

  return (
    <section className="panel" aria-label="Local change queue" data-testid="mutation-status">
      <h2>Local changes</h2>
      {pending.length > 0 ? (
        <ul className="tree" data-testid="pending-mutations">
          {pending.map((row) => (
            <li key={row.mutationId} className="tree-row">
              <span className="tree-kind">{row.status}</span>
              <span className="tree-name">{row.commandType}</span>
              <span className="muted">
                queued {new Date(row.createdAt).toLocaleTimeString()}
                {row.lastAttemptAt !== null
                  ? `, retried ${new Date(row.lastAttemptAt).toLocaleTimeString()}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {conflicts.length > 0 ? (
        <ul className="tree" data-testid="conflict-records">
          {conflicts.map((row) => (
            <li key={row.mutationId} className="tree-row">
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
    </section>
  );
}
