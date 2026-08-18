/**
 * Where a backup goes (T008, FR-009).
 *
 * Three methods, and the number is the decision. The boundary exists so a second
 * destination can be added later, and a boundary is only worth having if the
 * *simplest* implementation is honest — here, a directory on disk.
 *
 * Three methods are what a filesystem can do without pretending: no folder
 * identifiers, no resumable-upload tokens, no revision history, no quota
 * queries. Anything richer would be one vendor's interface wearing a generic
 * name, and the local implementation — the one every test uses — would become a
 * stub that passes tests the real one would fail. That is worse than having no
 * boundary at all, because it would look like coverage.
 *
 * `read` exists for one reason: verification after transfer has to re-read what
 * arrived. Re-hashing the local file would prove the local file is fine — which
 * the after-creation check already established — and would report a corrupted
 * upload as a success.
 */

import type { Readable } from "node:stream";

export interface StoredBackup {
  readonly name: string;
  readonly byteLength: number;
  readonly storedAt: Date;
}

export interface BackupDestination {
  /** A stable name for logs and errors. Never a credential, never a path. */
  readonly name: string;

  /** Stores a stream under `name`, replacing nothing: names are unique per backup. */
  put(name: string, contents: Readable, byteLength: number): Promise<void>;

  /** What is there now — the only way retention learns what it may delete. */
  list(): Promise<StoredBackup[]>;

  /**
   * Reads an object back.
   *
   * Returns null when it is absent rather than throwing, because "the backup is
   * not there" is an answer verification needs to record, not an exception it
   * needs to survive.
   */
  read(name: string): Promise<Readable | null>;

  delete(name: string): Promise<void>;
}

/**
 * Raised when a destination cannot be used at all.
 *
 * Distinct from a backup failing: an unreachable destination means every backup
 * will fail until somebody fixes it, and the owner needs to be told about the
 * destination rather than about tonight's archive.
 */
export class DestinationUnavailableError extends Error {
  constructor(
    readonly destination: string,
    reason: string,
  ) {
    super(`backup destination ${destination} is unavailable: ${reason}`);
    this.name = "DestinationUnavailableError";
  }
}
