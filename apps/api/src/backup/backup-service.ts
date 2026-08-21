/**
 * Producing a backup, and proving it (T012, T013, T014 — FR-001 to FR-008).
 *
 * The archive is the canonical export plus the file bytes plus a manifest naming
 * the versions. Nothing here re-serialises the workspace: `buildManifest` is the
 * same read the export route performs, so a backup and an export can never
 * disagree about what the workspace contains.
 *
 * Three things happen in a fixed order, and the order is the guarantee:
 *
 *   1. **build**, at one change-feed position, streaming rather than buffering —
 *      a nightly backup must not make the workspace unusable while it runs;
 *   2. **seal**, before anything leaves the machine (FR-007);
 *   3. **verify twice** — once against the local artefact, once against what the
 *      destination gives back. The second is not the first repeated: re-hashing
 *      the local file would prove what step one already proved and would report a
 *      corrupted upload as a success.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupFileEntry,
  type BackupManifest,
  canonicalExportString,
  canonicalStructuredDataString,
} from "@myownnotion/domain";
import type { AppContext } from "../context.ts";
import { buildManifest } from "../routes/export.ts";
import { writeBackupArchiveFile } from "./archive-format.ts";
import type { BackupDestination } from "./destinations/destination.ts";

/** The record format the sealed content inside an archive is written with. */
export const BACKUP_RECORD_FORMAT_VERSION = 1;

export type BackupReason = "scheduled" | "manual" | "pre-update";

export interface BackupOutcome {
  readonly backupId: string;
  readonly name: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly cursor: string;
  /**
   * The provenance an owner needs to go back cleanly.
   *
   * Surfaced here rather than left inside the sealed archive because the
   * *record* has to carry it too: choosing which backup to restore, and deciding
   * whether this installation can read it, both happen before anything is
   * decrypted.
   */
  readonly applicationVersion: string;
  readonly schemaVersion: number;
  readonly recordFormatVersion: number;
  /** Why it was produced; a pre-update backup is what an update looks for. */
  readonly reason: BackupReason;
  readonly verifiedAfterCreation: boolean;
  /** True once `put` completed, independently of destination read-back. */
  readonly transferred: boolean;
  readonly verifiedAfterTransfer: boolean;
  /** Safe reason for whichever verification failed, if one did. */
  readonly detail?: string;
}

export interface BackupServiceOptions {
  readonly context: AppContext;
  readonly destination: BackupDestination;
  readonly applicationVersion: string;
  /** Streams a staged plaintext archive into its sealed path. */
  readonly seal: (plaintextPath: string, sealedPath: string) => Promise<void>;
  readonly now?: () => Date;
}

function digestOf(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * A name that says when, and nothing else.
 *
 * A destination sees this and the ciphertext. Putting anything about the
 * workspace in it — an item count, a workspace name — would describe somebody's
 * content in the one field the provider can definitely read.
 */
function archiveName(createdAt: Date, backupId: string): string {
  return `myownnotion-backup-${createdAt.toISOString().replace(/[:.]/g, "-")}-${backupId.slice(0, 8)}.tar`;
}

export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  #now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  /**
   * Builds the archive on disk, sealed, and returns where it is.
   *
   * Staged in a temporary directory rather than held in memory: a workspace with
   * files is measured in gigabytes, and a backup that needs as much memory as the
   * workspace is a backup that stops working exactly when the workspace matters.
   */
  async #build(
    backupId: string,
    createdAt: Date,
  ): Promise<{
    stagedPath: string;
    manifest: BackupManifest;
    digest: string;
    byteLength: number;
  }> {
    const exported = await buildManifest(this.options.context);
    const canonical = canonicalExportString(exported);
    const canonicalBytes = Buffer.from(canonical, "utf8");

    // File bytes come from the content store, addressed by digest — the same
    // addressing the store already uses, so a file cannot be silently
    // substituted and two pages embedding one image cost one copy.
    const filesByDigest = new Map<string, BackupFileEntry>();
    for (const item of exported.items) {
      const file = item.file;
      if (file === null || file === undefined) {
        continue;
      }
      const digest = `sha256:${file.sha256}`;
      const existing = filesByDigest.get(digest);
      if (existing !== undefined && existing.byteLength !== file.byteLength) {
        throw new Error(`content ${digest} is listed with two different lengths`);
      }
      filesByDigest.set(digest, { digest, byteLength: file.byteLength });
    }
    const files = [...filesByDigest.values()];

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      cursor: exported.changeCursor,
      applicationVersion: this.options.applicationVersion,
      schemaVersion: this.options.context.schemaVersion,
      recordFormatVersion: BACKUP_RECORD_FORMAT_VERSION,
      canonicalExportDigest: digestOf(canonicalBytes),
      files,
      itemCount: exported.items.length,
      fileCount: files.length,
      databaseCount: exported.databases.length,
      databaseEntryCount: exported.databaseEntries.length,
      structuredDataDigest: digestOf(Buffer.from(canonicalStructuredDataString(exported), "utf8")),
    };

    const staging = path.join(os.tmpdir(), "myownnotion-backup");
    await mkdir(staging, { recursive: true });
    const plaintextPath = path.join(staging, `${backupId}.tar`);
    const stagedPath = path.join(staging, `${backupId}.sealed`);
    try {
      await writeBackupArchiveFile({
        path: plaintextPath,
        manifest,
        canonicalExport: canonical,
        readFile: async (digest) =>
          await this.options.context.contentStore.read(digest.slice("sha256:".length)),
      });
      await this.options.seal(plaintextPath, stagedPath);
      const stored = await stat(stagedPath);
      const digest = await this.#digestFile(stagedPath);
      return {
        stagedPath,
        manifest,
        digest,
        byteLength: stored.size,
      };
    } catch (error) {
      // `run` cannot enter its `finally` until this method returns. Clean both
      // stages here so a full disk never leaves a partial artefact that looks
      // like an operator-created backup.
      await Promise.all([rm(plaintextPath, { force: true }), rm(stagedPath, { force: true })]);
      throw error;
    } finally {
      // Plaintext exists only while it is being sealed and never reaches a
      // destination. The sealed stage remains for independent read-back.
      await rm(plaintextPath, { force: true });
    }
  }

  async #digestFile(stagedPath: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(stagedPath)) {
      hash.update(chunk as Buffer);
    }
    return `sha256:${hash.digest("hex")}`;
  }

  /**
   * Checks the local artefact against what it claims to be.
   *
   * Reads it back from disk rather than trusting the buffer that was written:
   * the question is whether the *file* is sound, and a check against the value
   * still in memory would pass for a write that never reached the disk.
   */
  async #verifyLocal(stagedPath: string, expectedDigest: string): Promise<boolean> {
    return (await this.#digestFile(stagedPath)) === expectedDigest;
  }

  /**
   * Checks what the destination gives back.
   *
   * The whole point of the destination's `read`. A backup that is sound on disk
   * and corrupt at the destination is the failure this catches, and it is
   * invisible to any check that does not leave the machine.
   */
  async #verifyRemote(name: string, expectedDigest: string): Promise<boolean> {
    const stream = await this.options.destination.read(name);
    if (stream === null) {
      return false;
    }
    const hash = createHash("sha256");
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    return `sha256:${hash.digest("hex")}` === expectedDigest;
  }

  /** Produces, seals, transfers and verifies twice. */
  async run(reason: BackupReason = "manual"): Promise<BackupOutcome> {
    const backupId = randomUUID();
    const createdAt = this.#now();
    const built = await this.#build(backupId, createdAt);
    const name = archiveName(createdAt, backupId);

    try {
      const verifiedAfterCreation = await this.#verifyLocal(built.stagedPath, built.digest);
      if (!verifiedAfterCreation) {
        return {
          backupId,
          name,
          byteLength: built.byteLength,
          digest: built.digest,
          cursor: built.manifest.cursor,
          applicationVersion: built.manifest.applicationVersion,
          schemaVersion: built.manifest.schemaVersion,
          recordFormatVersion: built.manifest.recordFormatVersion,
          reason,
          verifiedAfterCreation: false,
          transferred: false,
          verifiedAfterTransfer: false,
          detail: "the archive on disk does not match the digest it was written with",
        };
      }

      try {
        await this.options.destination.put(
          name,
          createReadStream(built.stagedPath),
          built.byteLength,
        );
      } catch {
        // The archive is still a produced, locally verified backup. Returning
        // that fact lets the command persist both verification rows and makes
        // a destination outage observable instead of rolling the run back.
        return {
          backupId,
          name,
          byteLength: built.byteLength,
          digest: built.digest,
          cursor: built.manifest.cursor,
          applicationVersion: built.manifest.applicationVersion,
          schemaVersion: built.manifest.schemaVersion,
          recordFormatVersion: built.manifest.recordFormatVersion,
          reason,
          verifiedAfterCreation: true,
          transferred: false,
          verifiedAfterTransfer: false,
          detail: "the destination could not store the locally verified backup",
        };
      }

      let verifiedAfterTransfer: boolean;
      try {
        verifiedAfterTransfer = await this.#verifyRemote(name, built.digest);
      } catch {
        // `put` completed, so retain the destination identity even when its
        // read-back becomes unavailable. That lets an operator re-check or
        // prune the object later instead of leaving an orphan behind.
        return {
          backupId,
          name,
          byteLength: built.byteLength,
          digest: built.digest,
          cursor: built.manifest.cursor,
          applicationVersion: built.manifest.applicationVersion,
          schemaVersion: built.manifest.schemaVersion,
          recordFormatVersion: built.manifest.recordFormatVersion,
          reason,
          verifiedAfterCreation: true,
          transferred: true,
          verifiedAfterTransfer: false,
          detail: "the transferred backup could not be read back from the destination",
        };
      }

      return {
        backupId,
        name,
        byteLength: built.byteLength,
        digest: built.digest,
        cursor: built.manifest.cursor,
        applicationVersion: built.manifest.applicationVersion,
        schemaVersion: built.manifest.schemaVersion,
        recordFormatVersion: built.manifest.recordFormatVersion,
        reason,
        verifiedAfterCreation: true,
        transferred: true,
        verifiedAfterTransfer,
        ...(verifiedAfterTransfer
          ? {}
          : { detail: "what the destination returned does not match what was sent" }),
      };
    } finally {
      // The staged copy is removed whatever happened. A partial artefact left
      // behind is a file that looks like a backup, and the next person to find
      // it has no way to tell.
      await rm(built.stagedPath, { force: true });
    }
  }

  /**
   * Reads the stored object once and reports both integrity facts.
   *
   * Size alone only catches truncation. A same-length bit flip is just as
   * unrestorable, so the administrative verification command must compare the
   * digest it originally recorded as well.
   */
  async inspectStored(
    name: string,
  ): Promise<{ readonly byteLength: number; readonly digest: string } | null> {
    const stream = await this.options.destination.read(name);
    if (stream === null) {
      return null;
    }
    const hash = createHash("sha256");
    let total = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      total += bytes.byteLength;
      hash.update(bytes);
    }
    return {
      byteLength: total,
      digest: `sha256:${hash.digest("hex")}`,
    };
  }
}
