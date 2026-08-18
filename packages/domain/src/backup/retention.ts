/**
 * Which backups may be deleted (T007, FR-010, FR-011).
 *
 * The rule that matters is not the age, it is the floor beneath it: **at least
 * one recent verified backup must survive every deletion**. Retention that only
 * counts days will, on the day transfers have been failing for a week, delete
 * the last backup that was ever verified — the exact moment its absence costs
 * everything.
 *
 * So this returns what may go, never what is old.
 */

export interface RetainableBackup {
  readonly id: string;
  readonly createdAt: Date;
  /** True only when the *after-transfer* verification passed. */
  readonly verifiedAtDestination: boolean;
}

export interface RetentionPolicy {
  /** Days to keep. Three months by default; configurable (FR-010). */
  readonly retainDays: number;
  readonly now: Date;
}

export const DEFAULT_RETENTION_DAYS = 92;

/**
 * The backups that may be deleted, oldest first.
 *
 * A backup is deletable when it is past its retention *and* a verified backup
 * newer than it remains after every deletion this call proposes. The second half
 * is why deletions are decided together rather than one at a time: deleting the
 * oldest of two verified backups is safe, and deleting both — each individually
 * "safe because the other exists" — is not.
 */
export function backupsToDelete(
  backups: readonly RetainableBackup[],
  policy: RetentionPolicy,
): string[] {
  const cutoff = policy.now.getTime() - policy.retainDays * 24 * 60 * 60 * 1000;
  const ordered = [...backups].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // The newest verified backup is the floor. Nothing at or after it is deletable,
  // whatever its age — an unverified backup newer than it is not a replacement,
  // because "verified" is the only word that means restorable.
  const newestVerified = [...ordered].reverse().find((backup) => backup.verifiedAtDestination);
  if (newestVerified === undefined) {
    // Nothing has ever been verified at the destination. Deleting anything here
    // would be deleting the only copies that exist, on the authority of a
    // calendar.
    return [];
  }

  return ordered
    .filter(
      (backup) =>
        backup.createdAt.getTime() < cutoff &&
        backup.createdAt.getTime() < newestVerified.createdAt.getTime(),
    )
    .map((backup) => backup.id);
}

/**
 * Whether the owner should be warned about staleness (FR-012).
 *
 * Measured from the last backup verified *at the destination*, because a backup
 * that never left the machine protects against nothing this feature exists to
 * protect against. Twenty-six hours rather than twenty-four: a daily schedule
 * that runs a little late, or a transfer that takes an hour, must not produce a
 * warning every morning — a warning an owner sees daily is one they stop reading.
 */
export const STALE_AFTER_HOURS = 26;

export function backupIsStale(
  lastVerifiedAtDestination: Date | null,
  now: Date,
  staleAfterHours: number = STALE_AFTER_HOURS,
): boolean {
  if (lastVerifiedAtDestination === null) {
    return true;
  }
  return now.getTime() - lastVerifiedAtDestination.getTime() > staleAfterHours * 60 * 60 * 1000;
}
