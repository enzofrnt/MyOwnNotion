/** The separate fact that a backup has actually been restored (T033). */

import { AsyncState, Button, FR_COPY, formatDateTime } from "../../ui/index.ts";

export type RehearsalRunState = "idle" | "running" | "succeeded" | "failed";

function formatMoment(iso: string | null): string {
  if (iso === null) {
    return FR_COPY.backup.never;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? FR_COPY.backup.never : formatDateTime(at);
}

export function RestoreRehearsal({
  lastRehearsalAt,
  lastRehearsalOutcome,
  rehearsalDue,
  onRun,
  runState = "idle",
}: {
  readonly lastRehearsalAt: string | null;
  readonly lastRehearsalOutcome: "succeeded" | "failed" | null;
  readonly rehearsalDue: boolean;
  readonly onRun?: () => void;
  readonly runState?: RehearsalRunState;
}) {
  return (
    <section aria-labelledby="restore-rehearsal-title" data-testid="restore-rehearsal">
      <h3 id="restore-rehearsal-title">{FR_COPY.backup.rehearsalTitle}</h3>
      <p className="muted" data-testid="backup-last-rehearsal">
        {FR_COPY.backup.lastRehearsal} : {formatMoment(lastRehearsalAt)}
        {lastRehearsalOutcome === null
          ? ""
          : ` (${lastRehearsalOutcome === "succeeded" ? FR_COPY.backup.succeeded : FR_COPY.backup.failed})`}
        .
      </p>

      {rehearsalDue ? (
        <AsyncState
          kind="pending"
          description={FR_COPY.backup.rehearsalDue}
          action={
            onRun === undefined ? undefined : (
              <Button
                type="button"
                data-testid="run-rehearsal"
                onClick={onRun}
                busy={runState === "running"}
              >
                {runState === "running"
                  ? FR_COPY.backup.runningRehearsal
                  : FR_COPY.backup.runRehearsal}
              </Button>
            )
          }
          testId="rehearsal-due"
        />
      ) : null}

      {runState === "succeeded" ? (
        <AsyncState
          kind="success"
          description={FR_COPY.backup.rehearsalSucceeded}
          testId="rehearsal-result"
        />
      ) : runState === "failed" ? (
        <AsyncState
          kind="error"
          description={FR_COPY.backup.rehearsalFailed}
          testId="rehearsal-result"
        />
      ) : null}
    </section>
  );
}
