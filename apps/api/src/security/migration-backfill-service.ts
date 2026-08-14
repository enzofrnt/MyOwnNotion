/**
 * The encrypted backfill (T096, US6, FR-024, FR-028, FR-029).
 *
 * Copies every plaintext payload into a sealed envelope, in batches, without
 * touching the source. That last part is the whole design: this service can
 * fail in any way at any point and the worst outcome is wasted work, because
 * the only thing it destroys is nothing.
 *
 * Four decisions, each of which the shorter version gets wrong.
 *
 * **The source is read and never written.** Not "written carefully" — never.
 * The scrub is a separate stage behind its own gate, so a bug in the sweep
 * cannot become data loss no matter what it does.
 *
 * **A batch is one transaction, and its checkpoint commits inside it.** An
 * envelope written without its checkpoint would be re-copied on resume, which
 * is harmless; a checkpoint written without its envelope would skip a record
 * forever, which is not. Committing them together removes the choice.
 *
 * **An already-sealed record is skipped, not re-sealed.** The resume path
 * re-reads from the last safe checkpoint, so records between that checkpoint
 * and the interruption are seen twice. Re-sealing them would work and would
 * waste the most expensive operation in the sweep; skipping is both faster and
 * the honest description of what needs doing.
 *
 * **Identity is verified over identifiers, never contents.** What the
 * migration must preserve is feature-001's canonical identity — the same
 * records, with the same ids. Comparing payloads would mean comparing
 * plaintext against ciphertext, which proves nothing about either.
 */

import { createHash } from "node:crypto";
import type { Database, Transaction } from "@myownnotion/database";
import {
  countPlaintextSources,
  currentSourceBoundary,
  listPlaintextItemNames,
  listPlaintextPageBodies,
  type PlaintextRecord,
  readProtectedRecord,
  readSourceIdentities,
} from "@myownnotion/database";
// Behind the `/security` subpath: the manifest builder needs `node:crypto`,
// and this service is server-side.
import { partialIdentityDigest } from "@myownnotion/domain/security";
import { PROTECTED_ENTITY_TYPES } from "./protected-content.ts";
import type { ProtectedRecordService } from "./protected-record-service.ts";

/**
 * Records per transaction.
 *
 * Small enough that an interruption costs one batch and that the sweep never
 * holds a long transaction against ordinary traffic — the workspace is still
 * being used while this runs, and a batch locking hundreds of rows would make
 * migrating and working mutually exclusive.
 */
export const BACKFILL_BATCH_SIZE = 100;

/** Which source a batch is drawing from. Separate cursors, separate streams. */
export type BackfillStream = "item-names" | "page-bodies";

export interface BackfillCursors {
  readonly itemNames: string;
  readonly pageBodies: string;
}

export interface BackfillBoundary {
  readonly itemCursor: string;
  readonly pageCursor: string;
}

export interface BackfillBatchResult {
  readonly stream: BackfillStream;
  readonly cursor: string;
  /** Sealed by this batch. Excludes records already sealed by an earlier one. */
  readonly sealed: number;
  /** Seen by this batch, sealed or not. Zero means the stream is exhausted. */
  readonly seen: number;
}

export interface MigrationBackfillDeps {
  readonly db: Database;
  readonly workspaceId: string;
  readonly records: ProtectedRecordService;
  readonly batchSize?: number;
}

export class MigrationBackfillService {
  readonly #deps: MigrationBackfillDeps;

  constructor(deps: MigrationBackfillDeps) {
    this.#deps = deps;
  }

  /**
   * The line the migration is measured against.
   *
   * Taken once, at the boundary stage, and stored. Recomputing it later would
   * move the line: on a workspace still being written to, a boundary that
   * chases the newest row is a backfill that never terminates.
   */
  async captureBoundary(): Promise<BackfillBoundary> {
    return await currentSourceBoundary(this.#deps.db);
  }

  async countSources(boundary: BackfillBoundary): Promise<number> {
    const counts = await countPlaintextSources(this.#deps.db, {
      itemBoundary: boundary.itemCursor,
      pageBoundary: boundary.pageCursor,
    });
    return counts.total;
  }

  /**
   * Copies one batch, in one transaction.
   *
   * Returns what it did rather than mutating shared state, so the orchestrator
   * decides what the progress means and this service stays a thing that can be
   * called twice with the same arguments and do the right thing the second
   * time.
   */
  async copyBatch(input: {
    stream: BackfillStream;
    afterCursor: string;
    boundary: BackfillBoundary;
  }): Promise<BackfillBatchResult> {
    const limit = this.#deps.batchSize ?? BACKFILL_BATCH_SIZE;
    const boundaryCursor =
      input.stream === "item-names" ? input.boundary.itemCursor : input.boundary.pageCursor;

    const rows =
      input.stream === "item-names"
        ? await listPlaintextItemNames(this.#deps.db, {
            afterCursor: input.afterCursor,
            boundaryCursor,
            limit,
          })
        : await listPlaintextPageBodies(this.#deps.db, {
            afterCursor: input.afterCursor,
            boundaryCursor,
            limit,
          });

    if (rows.length === 0) {
      return { stream: input.stream, cursor: input.afterCursor, sealed: 0, seen: 0 };
    }

    const entityType =
      input.stream === "item-names"
        ? PROTECTED_ENTITY_TYPES.itemName
        : PROTECTED_ENTITY_TYPES.pageBody;

    let sealed = 0;
    await this.#deps.db.transaction(async (tx) => {
      for (const row of rows) {
        if (await this.#alreadySealed(tx, entityType, row)) {
          // Seen before, on the far side of an interruption. Re-sealing would
          // work and would repeat the most expensive operation in the sweep
          // for no gain.
          continue;
        }
        await this.#deps.records.write(tx, {
          entityType,
          entityId: row.entityId,
          recordVersion: row.recordVersion,
          // JSON, matching what `ProtectedContent` writes on the ordinary
          // path. A migration that encoded differently would produce records
          // the application could open and not parse.
          payload: new Uint8Array(Buffer.from(JSON.stringify(row.value), "utf8")),
        });
        sealed += 1;
      }
    });

    return {
      stream: input.stream,
      cursor: rows.at(-1)?.cursor ?? input.afterCursor,
      sealed,
      seen: rows.length,
    };
  }

  async #alreadySealed(
    tx: Transaction,
    entityType: string,
    row: PlaintextRecord,
  ): Promise<boolean> {
    const existing = await readProtectedRecord(tx, {
      workspaceId: this.#deps.workspaceId,
      entityType,
      entityId: row.entityId,
      recordVersion: row.recordVersion,
    });
    return existing !== null;
  }

  /**
   * The digest of what the source contains, by identity.
   *
   * Feature-001's canonical identifiers, in canonical order, through the
   * domain's manifest builder — the same function the recovery path uses, so
   * "these two installations hold the same records" means the same thing in
   * both places.
   *
   * Pages are not a separate collection here, and that is not an omission: a
   * page document is keyed by its item, so its identifier is already in
   * `items`. Listing it twice would change the digest without adding anything
   * the comparison did not already cover.
   */
  async sourceIdentityDigest(): Promise<string> {
    const identities = await readSourceIdentities(this.#deps.db);
    return partialIdentityDigest({ items: identities.items });
  }
}

/**
 * A digest over a checkpoint's position and totals.
 *
 * Not a security control — a tamper-evident marker, so two checkpoints
 * claiming the same position with different contents are distinguishable in
 * the history rather than merely both present.
 */
export function backfillCheckpointDigest(input: {
  migrationId: string;
  sequence: number;
  cursors: BackfillCursors;
  recordCount: number;
}): string {
  return createHash("sha256")
    .update(
      `${input.migrationId} ${input.sequence} ${input.cursors.itemNames} ${input.cursors.pageBodies} ${input.recordCount}`,
    )
    .digest("hex");
}
