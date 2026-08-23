/**
 * Reading a backup back into a workspace (T023 to T026, FR-014 to FR-019).
 *
 * The order is the design. Six checks run before a single row is written
 * (FR-015), each refusing with what is missing rather than with a generic
 * failure, and the first one that fails stops everything. A restoration that
 * discovers a problem halfway is the state FR-017 spends its whole effort making
 * survivable — so the cheapest way to honour FR-017 is to reach it rarely.
 *
 * The checks are ordered by what they cost and what they save:
 *
 *   1. **key access** — without it nothing can be read at all, and it is the
 *      failure an owner is most likely to be able to fix (mount the file);
 *   2. **manifest and archive integrity** — the archive is what it claims;
 *   3. **version compatibility** — this installation can read it;
 *   4. **scope and date shown** — the owner sees what they are about to get;
 *   5. **safety backup** — the state being replaced is recoverable;
 *   6. **explicit confirmation** — after all of the above, never before.
 *
 * Confirmation is last on purpose. Asking first and checking afterwards trains
 * somebody to confirm before they have been told anything, and the confirmation
 * then means nothing.
 */

import { randomUUID } from "node:crypto";
import { type BackupManifest, backupCompatibility, type Uuid } from "@myownnotion/domain";
import { inspectBackupArchive } from "./archive-format.ts";

export type PreflightStep =
  | "key-access"
  | "archive-integrity"
  | "version-compatibility"
  | "scope-shown"
  | "safety-backup"
  | "confirmation";

export const PREFLIGHT_ORDER: readonly PreflightStep[] = [
  "key-access",
  "archive-integrity",
  "version-compatibility",
  "scope-shown",
  "safety-backup",
  "confirmation",
];

export interface RestoreScope {
  readonly createdAt: string;
  readonly cursor: string;
  readonly applicationVersion: string;
  readonly itemCount: number;
  readonly fileCount: number;
}

export type PreflightOutcome =
  | { readonly ok: true; readonly manifest: BackupManifest; readonly scope: RestoreScope }
  | { readonly ok: false; readonly failedAt: PreflightStep; readonly reason: string };

export interface PreflightInput {
  /** Opens the sealed archive. Returns null when the material is unavailable. */
  readonly openArchive: () => Promise<Buffer | null>;
  readonly installation: { readonly schemaVersion: number; readonly recordFormatVersion: number };
  /** Shows the owner what they are about to get; returning false means they were not shown. */
  readonly showScope: (scope: RestoreScope) => Promise<boolean> | boolean;
  /** Takes a safety backup. Null means one could not be taken. */
  readonly safetyBackup: () => Promise<string | null>;
  /** Whether the owner confirmed. Never assumed. */
  readonly confirm: () => Promise<boolean> | boolean;
  /** A rehearsal needs no safety backup and no confirmation: it replaces nothing. */
  readonly kind: "test" | "destructive";
}

/**
 * Runs the six checks in order and stops at the first failure.
 *
 * Returns *where* it stopped, not just that it did. "The restoration was
 * refused" is true and unusable; "it stopped at version compatibility, and here
 * are both versions" is something an owner can act on.
 */
export async function preflight(input: PreflightInput): Promise<PreflightOutcome> {
  // 1. Key access.
  const opened = await input.openArchive();
  if (opened === null) {
    return {
      ok: false,
      failedAt: "key-access",
      reason:
        "The material needed to read this backup is not available on this machine. Mount it and try again; the backup is unchanged.",
    };
  }

  // 2. Archive integrity — the manifest first, because everything after it
  //    depends on the manifest being trustworthy.
  const inspected = inspectBackupArchive(opened);
  if (!inspected.ok) {
    return { ok: false, failedAt: "archive-integrity", reason: inspected.reason };
  }
  const manifest = inspected.manifest;

  // 3. Version compatibility.
  const verdict = backupCompatibility(input.installation, {
    schemaVersion: manifest.schemaVersion,
    recordFormatVersion: manifest.recordFormatVersion,
    applicationVersion: manifest.applicationVersion,
  });
  if (verdict.kind === "refused") {
    return { ok: false, failedAt: "version-compatibility", reason: verdict.reason };
  }

  const scope: RestoreScope = {
    createdAt: manifest.createdAt,
    cursor: manifest.cursor,
    applicationVersion: manifest.applicationVersion,
    itemCount: manifest.itemCount,
    fileCount: manifest.fileCount,
  };

  // 4. Scope and date shown.
  if (!(await input.showScope(scope))) {
    return {
      ok: false,
      failedAt: "scope-shown",
      reason: "The scope of this restoration could not be shown, so it was not started.",
    };
  }

  // A rehearsal replaces nothing, so the two steps that exist to protect what is
  // being replaced do not apply. Running them anyway would make the safe path
  // the tedious one, and the safe path has to be the easy one or nobody
  // rehearses.
  if (input.kind === "test") {
    return { ok: true, manifest, scope };
  }

  // 5. Safety backup of what is about to be replaced.
  const safety = await input.safetyBackup();
  if (safety === null) {
    return {
      ok: false,
      failedAt: "safety-backup",
      reason:
        "A backup of the current state could not be taken, so this restoration was not started. Restoring without one would leave nothing to return to.",
    };
  }

  // 6. Confirmation, last.
  if (!(await input.confirm())) {
    return {
      ok: false,
      failedAt: "confirmation",
      reason: "This restoration was not confirmed, so nothing was changed.",
    };
  }

  return { ok: true, manifest, scope };
}

export interface RestoreTarget {
  /** Starts mutation only after every archive-level verification has passed. */
  readonly begin?: () => Promise<void>;
  /** Writes one item and its placements. */
  readonly writeItem: (item: unknown) => Promise<void>;
  readonly writeRelationship: (relationship: unknown) => Promise<void>;
  readonly writeRevision: (revision: unknown) => Promise<void>;
  readonly writeDatabase?: (database: unknown) => Promise<void>;
  readonly writeDatabaseEntry?: (entry: unknown) => Promise<void>;
  readonly writeFile: (digest: string, bytes: Buffer) => Promise<void>;
  /** Verifies causal state against the canonical projection before any write. */
  readonly verifyPageOperations?: (
    operationalState: unknown,
    canonicalExport: unknown,
  ) => Promise<void>;
  /** Restores the already verified causal state once referenced rows exist. */
  readonly writePageOperations?: (operationalState: unknown) => Promise<void>;
  /** Flushes writes that require every item and revision to exist first. */
  readonly finish?: () => Promise<void>;
}

export interface RestoreResult {
  readonly restoredItemCount: number;
  readonly restoredFileCount: number;
  readonly restoredDatabaseCount?: number;
  readonly restoredDatabaseEntryCount?: number;
}

/**
 * Writes a checked archive into a target.
 *
 * The target is an interface rather than a database handle, and that is what
 * makes a rehearsal honest: the same code writes into a disposable database as
 * into a real one, so a rehearsal exercises the writing rather than a validation
 * that stops short of it.
 */
export async function applyArchive(archive: Buffer, target: RestoreTarget): Promise<RestoreResult> {
  const inspected = inspectBackupArchive(archive);
  if (!inspected.ok) throw new Error(inspected.reason);
  const body = inspected.body;
  const exported = JSON.parse(body.canonicalExport) as {
    items: unknown[];
    relationships: unknown[];
    revisions: unknown[];
    databases?: unknown[];
    databaseEntries?: unknown[];
  };
  const databases = exported.databases ?? [];
  const databaseEntries = exported.databaseEntries ?? [];
  let operationalState: unknown = null;
  if (body.operationalState !== null) {
    if (target.verifyPageOperations === undefined || target.writePageOperations === undefined) {
      throw new Error("the restore target cannot restore operational page state");
    }
    operationalState = JSON.parse(body.operationalState);
    // This is intentionally before file ingestion and before the first row:
    // a canonical/causal mismatch must leave no restore artefact behind.
    await target.verifyPageOperations(operationalState, exported);
  }
  await target.begin?.();

  // Files before items: an item that names a file the store does not hold is a
  // broken reference the moment it is written, and the window between the two
  // is a window in which an interrupted restore leaves exactly that.
  let restoredFileCount = 0;
  for (const [digest, bytes] of body.files) {
    await target.writeFile(digest, bytes);
    restoredFileCount += 1;
  }
  for (const item of exported.items) {
    await target.writeItem(item);
  }
  for (const revision of exported.revisions) {
    await target.writeRevision(revision);
  }
  for (const database of databases) {
    if (target.writeDatabase === undefined) {
      throw new Error("the restore target cannot write structured databases");
    }
    await target.writeDatabase(database);
  }
  for (const entry of databaseEntries) {
    if (target.writeDatabaseEntry === undefined) {
      throw new Error("the restore target cannot write structured database entries");
    }
    await target.writeDatabaseEntry(entry);
  }
  for (const relationship of exported.relationships) {
    await target.writeRelationship(relationship);
  }
  await target.finish?.();
  if (operationalState !== null) {
    await target.writePageOperations?.(operationalState);
  }

  return {
    restoredItemCount: exported.items.length,
    restoredFileCount,
    restoredDatabaseCount: databases.length,
    restoredDatabaseEntryCount: databaseEntries.length,
  };
}

/** A restoration attempt identifier, minted before anything is written. */
export function newRestorationId(): Uuid {
  return randomUUID() as Uuid;
}
