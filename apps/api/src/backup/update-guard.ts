/**
 * No migration without a verified backup of the version being left
 * (T037 to T040, FR-021 to FR-026).
 *
 * Migration is the most dangerous thing this product does to an owner's data and
 * the one failure they cannot undo themselves, so the net goes up *before* the
 * trapeze rather than after it.
 *
 * Three placements make this work, and each rules out a way of being bypassed:
 *
 * **At startup.** A container image change is invisible to the process being
 * replaced; it is a fact only to the one starting up. Nothing else in the system
 * observes it.
 *
 * **Before the migrator, not inside it.** A migrator that checks its own
 * precondition is a migrator a future entry point can call without the check —
 * and the day that happens, nobody notices until the backup that does not exist
 * is needed.
 *
 * **Refusing, not warning.** An installation whose safety backup failed does not
 * start its migrations and says so. Continuing on the old schema under a new
 * binary is the shape of failure that looks fine for weeks and then does not.
 */

import type { Uuid } from "@myownnotion/domain";

export type UpdateDecision =
  /** Nothing changed; migrations may run. */
  | { readonly kind: "unchanged" }
  /** First run since this guard existed: record the version and carry on. */
  | { readonly kind: "first-record"; readonly applicationVersion: string }
  /** A version change with a verified backup behind it. */
  | {
      readonly kind: "proceed";
      readonly from: string;
      readonly to: string;
      readonly backupId: Uuid;
    }
  /** A version change whose backup could not be produced or verified. */
  | {
      readonly kind: "refused";
      readonly from: string;
      readonly to: string;
      readonly reason: string;
    };

export interface UpdateGuardInput {
  /** The version this process is. */
  readonly runningVersion: string;
  /** The version recorded in the installation, or null if never recorded. */
  readonly recordedVersion: string | null;
  /**
   * Produces and verifies a backup for the version being left.
   *
   * Returns the backup's identifier, or null when it could not be produced or
   * could not be verified — the guard does not distinguish them, because the
   * consequence is identical: there is nothing to return to.
   */
  readonly backupForUpdate: (from: string, to: string) => Promise<Uuid | null>;
}

export async function decideUpdate(input: UpdateGuardInput): Promise<UpdateDecision> {
  if (input.recordedVersion === null) {
    // Never recorded. Treating this as a version change would demand a backup of
    // a version nobody can name and refuse to start on the strength of it — on
    // the very upgrade that introduces the guard.
    return { kind: "first-record", applicationVersion: input.runningVersion };
  }
  if (input.recordedVersion === input.runningVersion) {
    return { kind: "unchanged" };
  }

  const backupId = await input.backupForUpdate(input.recordedVersion, input.runningVersion);
  if (backupId === null) {
    return {
      kind: "refused",
      from: input.recordedVersion,
      to: input.runningVersion,
      reason: `This installation is moving from ${input.recordedVersion} to ${input.runningVersion}, and a verified backup of ${input.recordedVersion} could not be produced. No migration has run and your data is untouched. Fix the backup destination and start again.`,
    };
  }
  return {
    kind: "proceed",
    from: input.recordedVersion,
    to: input.runningVersion,
    backupId,
  };
}

/**
 * Whether migrations may run, given a decision.
 *
 * A function rather than a field so the answer cannot be read off a shape by
 * accident. Every caller has to ask, and the two states that permit migration —
 * unchanged, and a change with a verified backup — are the only ones that say
 * yes.
 */
export function migrationsMayRun(decision: UpdateDecision): boolean {
  return decision.kind !== "refused";
}

/**
 * What an owner is told to do to go back.
 *
 * Named rather than left to be worked out: an owner reading this has just had an
 * update fail, and "consult the documentation" at that moment is an instruction
 * to go and be anxious somewhere else.
 */
export function howToReturn(input: {
  readonly previousVersion: string | null;
  readonly previousBackupId: Uuid | null;
}): string {
  if (input.previousVersion === null) {
    return "This installation has no recorded previous version, so there is nothing to return to automatically. The backups that exist are listed on the backup screen.";
  }
  if (input.previousBackupId === null) {
    return `The previous version was ${input.previousVersion}. No backup was recorded for it, so returning means deploying that version again and restoring the most recent verified backup by hand.`;
  }
  return `The previous version was ${input.previousVersion}. Deploy that image again and restore backup ${input.previousBackupId}, which was taken from it and verified before this update started.`;
}
