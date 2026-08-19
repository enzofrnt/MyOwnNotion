/** The separate fact that a backup has actually been restored (T033). */

export type RehearsalRunState = "idle" | "running" | "succeeded" | "failed";

function formatMoment(iso: string | null): string {
  if (iso === null) {
    return "never";
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "never" : at.toLocaleString();
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
      <h3 id="restore-rehearsal-title">Test restoration</h3>
      <p className="muted" data-testid="backup-last-rehearsal">
        Last test restoration: {formatMoment(lastRehearsalAt)}
        {lastRehearsalOutcome === null ? "" : ` (${lastRehearsalOutcome})`}.
      </p>

      {rehearsalDue ? (
        <p
          className="status-banner"
          data-state="conflict"
          role="status"
          data-testid="rehearsal-due"
        >
          It has been more than a month since you last tested restoring a backup. A test restores
          into a separate place and leaves this workspace untouched.
          {onRun === undefined ? null : (
            <>
              {" "}
              <button
                type="button"
                data-testid="run-rehearsal"
                onClick={onRun}
                disabled={runState === "running"}
              >
                {runState === "running" ? "Testing restoration…" : "Test a restoration"}
              </button>
            </>
          )}
        </p>
      ) : null}

      {runState === "succeeded" ? (
        <p
          role="status"
          className="status-banner"
          data-state="success"
          data-testid="rehearsal-result"
        >
          The backup restored successfully in isolation. This workspace was left untouched.
        </p>
      ) : runState === "failed" ? (
        <p role="alert" className="status-banner" data-state="error" data-testid="rehearsal-result">
          The test restoration did not complete. Your live workspace was left untouched.
        </p>
      ) : null}
    </section>
  );
}
