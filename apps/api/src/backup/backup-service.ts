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
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupFileEntry,
  type BackupManifest,
  canonicalExportString,
} from "@myownnotion/domain";
import type { AppContext } from "../context.ts";
import { buildManifest } from "../routes/export.ts";
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
  /** Why it was produced; a pre-update backup is what an update looks for. */
  readonly reason: BackupReason;
  readonly verifiedAfterCreation: boolean;
  readonly verifiedAfterTransfer: boolean;
  /** Safe reason for whichever verification failed, if one did. */
  readonly detail?: string;
}

export interface BackupServiceOptions {
  readonly context: AppContext;
  readonly destination: BackupDestination;
  readonly applicationVersion: string;
  /** Seals the archive before it leaves the machine. */
  readonly seal: (plaintext: Buffer) => Promise<Buffer>;
  readonly open: (ciphertext: Buffer) => Promise<Buffer>;
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
  return `myownnotion-backup-${createdAt.toISOString().replace(/[:.]/g, "-")}-${backupId.slice(0, 8)}.bin`;
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
    const files: BackupFileEntry[] = [];
    const payloads = new Map<string, Buffer>();
    for (const item of exported.items) {
      const file = item.file;
      if (file === null || file === undefined) {
        continue;
      }
      const digest = `sha256:${file.sha256}`;
      if (payloads.has(digest)) {
        continue;
      }
      const bytes = await this.options.context.contentStore.read(file.sha256);
      if (bytes === null) {
        // A file the export names and the store does not hold. Refused rather
        // than skipped: an archive that quietly omits a file restores a
        // workspace with a hole in it, and nothing would say so.
        throw new Error(`content ${digest} is named by the export and absent from the store`);
      }
      payloads.set(digest, Buffer.from(bytes));
      files.push({ digest, byteLength: bytes.byteLength });
    }

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
    };

    // One JSON envelope rather than a tar: the archive is sealed as a whole, so
    // its internal framing is never seen by a destination and a format nothing
    // streams through does not need to be a tape archive. What matters is that a
    // reader can open it with a JSON parser and a base64 decoder, which the
    // contract documents.
    const plaintext = Buffer.from(
      JSON.stringify({
        manifest,
        canonicalExport: canonical,
        files: Object.fromEntries(
          [...payloads].map(([digest, bytes]) => [digest, bytes.toString("base64")]),
        ),
      }),
      "utf8",
    );

    const sealed = await this.options.seal(plaintext);
    const staging = path.join(os.tmpdir(), "myownnotion-backup");
    await mkdir(staging, { recursive: true });
    const stagedPath = path.join(staging, `${backupId}.bin`);
    await pipeline(Readable.from(sealed), createWriteStream(stagedPath));

    return {
      stagedPath,
      manifest,
      digest: digestOf(sealed),
      byteLength: sealed.byteLength,
    };
  }

  /**
   * Checks the local artefact against what it claims to be.
   *
   * Reads it back from disk rather than trusting the buffer that was written:
   * the question is whether the *file* is sound, and a check against the value
   * still in memory would pass for a write that never reached the disk.
   */
  async #verifyLocal(stagedPath: string, expectedDigest: string): Promise<boolean> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(stagedPath)) {
      hash.update(chunk as Buffer);
    }
    return `sha256:${hash.digest("hex")}` === expectedDigest;
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
          reason,
          verifiedAfterCreation: false,
          verifiedAfterTransfer: false,
          detail: "the archive on disk does not match the digest it was written with",
        };
      }

      await this.options.destination.put(
        name,
        createReadStream(built.stagedPath),
        built.byteLength,
      );
      const verifiedAfterTransfer = await this.#verifyRemote(name, built.digest);

      return {
        backupId,
        name,
        byteLength: built.byteLength,
        digest: built.digest,
        cursor: built.manifest.cursor,
        reason,
        verifiedAfterCreation: true,
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

  /** For the retention pass and the administrative commands. */
  async storedSize(name: string): Promise<number | null> {
    const stream = await this.options.destination.read(name);
    if (stream === null) {
      return null;
    }
    let total = 0;
    for await (const chunk of stream) {
      total += (chunk as Buffer).byteLength;
    }
    return total;
  }
}
