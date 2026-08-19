/**
 * When the workspace was last copied somewhere else (T018, T033 — FR-012, FR-019, FR-020).
 *
 * Two facts, and they are not the same fact: when a backup last *succeeded and
 * was verified at its destination*, and when the owner last *rehearsed* restoring
 * one. A screen showing only the first would tell somebody their backups are
 * healthy without telling them nobody has ever checked that one can be restored —
 * which is the belief this whole feature exists to replace with a capability.
 *
 * The staleness warning is stated, not badged. "No verified backup for more than
 * a day" is a sentence about the workspace being unprotected right now, and a
 * coloured dot is a decoration somebody learns to stop seeing.
 */

import { useEffect, useState } from "react";
import { type RehearsalRunState, RestoreRehearsal } from "./restore-rehearsal.tsx";

export interface BackupStatus {
  /** When a backup was last verified *at its destination*. */
  readonly lastVerifiedAt: string | null;
  readonly lastVerifiedBackupId: string | null;
  /** The newest attempt, including failures newer than the last success. */
  readonly latestBackupAt: string | null;
  readonly latestBackupId: string | null;
  readonly latestCreationVerification: "passed" | "failed" | null;
  readonly latestTransferVerification: "passed" | "failed" | null;
  /** When the owner last rehearsed a restoration, and how it went. */
  readonly lastRehearsalAt: string | null;
  readonly lastRehearsalOutcome: "succeeded" | "failed" | null;
  readonly stale: boolean;
  /** True once more than a month has passed since the last rehearsal. */
  readonly rehearsalDue: boolean;
}

function formatMoment(iso: string | null): string {
  if (iso === null) {
    return "never";
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "never" : at.toLocaleString();
}

export function BackupPanel({
  load,
  runRehearsal,
}: {
  readonly load: () => Promise<BackupStatus>;
  readonly runRehearsal?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [runState, setRunState] = useState<RehearsalRunState>("idle");

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRehearse =
    runRehearsal === undefined
      ? undefined
      : () => {
          setRunState("running");
          void runRehearsal()
            .then(() => {
              setRunState("succeeded");
              void load()
                .then(setStatus)
                .catch(() => {
                  // The restoration succeeded even if refreshing its timestamp
                  // did not. Keep the truthful result and refresh on next visit.
                });
            })
            .catch(() => {
              setRunState("failed");
            });
        };

  if (status === null && failed) {
    return (
      <section className="panel" aria-label="Backups" data-testid="backup-panel">
        <h2>Backups</h2>
        <p className="status-banner" data-state="error" role="alert">
          Backup status could not be loaded. This does not mean your backups are healthy or
          unhealthy; check again when the server is reachable.
        </p>
      </section>
    );
  }

  if (status === null) {
    return (
      <section className="panel" aria-label="Backups" data-testid="backup-panel" aria-busy="true">
        <h2>Backups</h2>
        <p className="muted" role="status">
          Checking when your workspace was last backed up…
        </p>
      </section>
    );
  }

  return (
    <BackupStatusSummary
      status={status}
      runState={runState}
      {...(onRehearse === undefined ? {} : { onRehearse })}
    />
  );
}

/** The loaded state is separate so its exact wording is testable without a browser. */
export function BackupStatusSummary({
  status,
  onRehearse,
  runState = "idle",
}: {
  readonly status: BackupStatus;
  readonly onRehearse?: () => void;
  readonly runState?: RehearsalRunState;
}) {
  return (
    <section className="panel" aria-label="Backups" data-testid="backup-panel">
      <h2>Backups</h2>

      {status.latestCreationVerification === "failed" ? (
        <p
          className="status-banner"
          data-state="error"
          role="alert"
          data-testid="backup-creation-failed"
        >
          <strong>The latest backup failed verification on this machine.</strong> It was not sent to
          the destination. The attempt was made {formatMoment(status.latestBackupAt)}; check the
          administrative backup command for details.
        </p>
      ) : status.latestCreationVerification === "passed" &&
        status.latestTransferVerification !== "passed" ? (
        <p
          className="status-banner"
          data-state="error"
          role="alert"
          data-testid="backup-transfer-failed"
        >
          <strong>The latest backup was not verified after transfer.</strong> It was verified on
          this machine {formatMoment(status.latestBackupAt)}, but no verified copy was confirmed at
          the destination. Check the configured backup destination.
        </p>
      ) : null}

      {status.stale ? (
        // An alert, and worded as one. This says the workspace is currently
        // unprotected, which is a different claim from "a job failed" — and the
        // owner is the only person who can act on it.
        <p className="status-banner" data-state="error" role="alert" data-testid="backup-stale">
          <strong>No verified backup in more than a day.</strong> Your workspace is not currently
          protected against losing this machine. The last verified backup was{" "}
          {formatMoment(status.lastVerifiedAt)}.
        </p>
      ) : (
        <p className="muted" role="status" data-testid="backup-last-verified">
          Last verified backup: {formatMoment(status.lastVerifiedAt)}.
        </p>
      )}

      {/* A backup exists and a backup has been restored are deliberately two
          separate facts. The child keeps the second visible and actionable. */}
      <RestoreRehearsal
        lastRehearsalAt={status.lastRehearsalAt}
        lastRehearsalOutcome={status.lastRehearsalOutcome}
        rehearsalDue={status.rehearsalDue}
        runState={runState}
        {...(onRehearse === undefined ? {} : { onRun: onRehearse })}
      />
    </section>
  );
}
