/**
 * Whether this installation can read that backup (T006, FR-016).
 *
 * The question is asked before a destructive restoration, so the answer has to
 * be conservative in one direction: refusing a backup that would have worked
 * costs an operator an argument with a version number, while accepting one that
 * does not costs them the workspace they were restoring *into*.
 *
 * Two versions decide it, and they fail differently:
 *
 *   - **the schema version** is what the data was shaped for. Older is fine —
 *     migrations run forward — and newer is not, because this installation has
 *     no migration that undoes a change it has never heard of.
 *   - **the record format version** is what the sealed content was written with.
 *     Newer is refused for the same reason, and the failure is worse: unlike a
 *     schema mismatch, it surfaces as unreadable content rather than as an error.
 */

export interface InstallationVersions {
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
}

export interface BackupVersions {
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  /** For the message only; never used to decide. */
  readonly applicationVersion: string;
}

export type CompatibilityVerdict =
  | { readonly kind: "compatible" }
  | {
      readonly kind: "refused";
      /** What to tell the owner, naming both versions. */
      readonly reason: string;
    };

/**
 * The application version is deliberately not part of the decision.
 *
 * It changes for reasons that have nothing to do with the data — a fixed
 * stylesheet, a new keyboard shortcut — so refusing on it would reject backups
 * that are perfectly readable, and an owner who has just lost their server is
 * the last person who should be arguing with a version string. It appears in the
 * message because it is what they will recognise.
 */
export function backupCompatibility(
  installation: InstallationVersions,
  backup: BackupVersions,
): CompatibilityVerdict {
  if (backup.schemaVersion > installation.schemaVersion) {
    return {
      kind: "refused",
      reason: `This backup was made by a newer version (${backup.applicationVersion}, data version ${backup.schemaVersion}) than this installation can read (data version ${installation.schemaVersion}). Update this installation first; the backup is unchanged.`,
    };
  }
  if (backup.recordFormatVersion > installation.recordFormatVersion) {
    return {
      kind: "refused",
      // Worth a distinct sentence: a schema mismatch fails loudly, while a
      // record-format mismatch would restore rows this installation cannot
      // decrypt — a workspace that looks restored and is not.
      reason: `This backup stores its protected content in a newer format (${backup.recordFormatVersion}) than this installation understands (${installation.recordFormatVersion}). Restoring it would produce content this installation cannot read. Update this installation first; the backup is unchanged.`,
    };
  }
  return { kind: "compatible" };
}
