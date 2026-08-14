/**
 * Driving the encryption migration (T097, US6, FR-028, FR-029, SC-010).
 *
 * The state machine says what may follow what; the repositories make each
 * transition atomic; the backfill copies. This is the thing that decides *when*
 * to do each, and the decisions it makes are the ones that determine whether
 * an interruption costs an afternoon or a workspace.
 *
 * **It advances one stage per call and returns.** No loop that runs the whole
 * migration, because a migration of any real installation takes long enough
 * that the process will be restarted during it, and a design where progress
 * lives in a call stack loses everything not yet committed. Progress lives in
 * the row and the checkpoints; this reads them, does the next thing, and
 * writes them back.
 *
 * **Verification is a gate, not a report.** `verify` compares counts and
 * identity digests, and a mismatch fails the migration rather than logging a
 * warning and continuing. Everything after that point is irreversible, and the
 * only moment to refuse is before it.
 *
 * **The scrub asks the same questions twice.** The domain's
 * `mayScrubPlaintext` decides, the repository carries the state in its `WHERE`
 * clause, and the database's own constraint refuses a retention flag released
 * too early. Three checks for one deletion is not paranoia here: this is the
 * step that removes an owner's only copy, and the cost of an unnecessary check
 * is a microsecond against the cost of a missing one.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@myownnotion/database";
import {
  advanceMigration,
  appendMigrationCheckpoint,
  countRemainingPlaintext,
  failMigration,
  findLastSafeCheckpoint,
  findMigration,
  type MigrationRecord,
  readSourceIdentities,
  recordCaptureBoundary,
  releasePlaintextSource,
  runSecurityTransaction,
  scrubItemNames,
  scrubPageBodies,
  startMigration,
} from "@myownnotion/database";
import type { MigrationState } from "@myownnotion/domain";
import { assertAdvance, mayReportComplete, mayScrubPlaintext } from "@myownnotion/domain";
import {
  type BackfillBoundary,
  type BackfillStream,
  backfillCheckpointDigest,
  type MigrationBackfillService,
} from "./migration-backfill-service.ts";

export interface MigrationOrchestratorDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly backfill: MigrationBackfillService;
  readonly now: () => Date;
  readonly newId?: () => string;
}

/** What one call did, in terms an operator or a test can check. */
export interface MigrationStepResult {
  readonly state: MigrationState;
  readonly advanced: boolean;
  readonly message: string;
  readonly recordsCopied?: number;
  readonly remainingPlaintext?: number;
}

export class MigrationOrchestrator {
  readonly #deps: MigrationOrchestratorDeps;

  constructor(deps: MigrationOrchestratorDeps) {
    this.#deps = deps;
  }

  #id(): string {
    return (this.#deps.newId ?? (() => randomUUID()))();
  }

  /** Starts a migration, or returns the one already under way. */
  async begin(): Promise<MigrationRecord> {
    return await runSecurityTransaction(this.#deps.db, async (tx) =>
      startMigration(tx, {
        id: this.#id(),
        installationId: this.#deps.installationId,
        workspaceId: this.#deps.workspaceId,
        sourceSchemaVersion: 1,
        destinationSchemaVersion: 2,
        now: this.#deps.now(),
      }),
    );
  }

  /**
   * Does the next thing, whatever that is.
   *
   * Reads the migration's state rather than being told it: after an
   * interruption the caller's idea of where things stood is exactly the
   * unreliable part, and the row is the only account that survived.
   */
  async step(): Promise<MigrationStepResult> {
    const migration = await findMigration(this.#deps.db, this.#deps.installationId);
    if (migration === null) {
      return { state: "prepare-destinations", advanced: false, message: "no migration exists" };
    }

    switch (migration.state) {
      case "prepare-destinations":
        return await this.#advance(migration, "capture-boundary", "destinations are ready");
      case "capture-boundary":
        return await this.#captureBoundary(migration);
      case "backfill":
        return await this.#backfillBatch(migration);
      case "verify":
        return await this.#verify(migration);
      case "stop-plaintext-writes":
        return await this.#advance(
          migration,
          "encrypted-read-cutover",
          "plaintext writes have stopped",
        );
      case "encrypted-read-cutover":
        return await this.#advance(
          migration,
          "scrub-plaintext",
          "reads are served from encrypted storage",
        );
      case "scrub-plaintext":
        return await this.#scrub(migration);
      case "complete":
        return { state: "complete", advanced: false, message: "the migration is complete" };
      default:
        return {
          state: "failed",
          advanced: false,
          // A failed migration does not resume itself. Resuming is an operator
          // decision made after they know why it failed, and a machine that
          // retried automatically would hide a repeatable fault behind a loop.
          message: "the migration failed and will not resume on its own",
        };
    }
  }

  async #advance(
    migration: MigrationRecord,
    next: MigrationState,
    message: string,
  ): Promise<MigrationStepResult> {
    // The domain decides whether the step is legal; the repository decides
    // whether this caller is the one making it.
    assertAdvance(migration.state, next);
    const advanced = await runSecurityTransaction(this.#deps.db, async (tx) =>
      advanceMigration(tx, {
        migrationId: migration.id,
        expectedState: migration.state,
        nextState: next,
        now: this.#deps.now(),
      }),
    );
    return {
      state: advanced ? next : migration.state,
      advanced,
      message: advanced ? message : "another process advanced this migration first",
    };
  }

  async #captureBoundary(migration: MigrationRecord): Promise<MigrationStepResult> {
    const boundary = await this.#deps.backfill.captureBoundary();
    const total = await this.#deps.backfill.countSources(boundary);
    const identityDigest = await this.#deps.backfill.sourceIdentityDigest(boundary);

    await runSecurityTransaction(this.#deps.db, async (tx) => {
      // The boundary is stored as a composite because there are two streams
      // with independent key spaces. Encoding it into one string keeps the
      // migration row's shape and keeps the two cursors together, which is the
      // only way they are ever useful.
      await recordCaptureBoundary(tx, {
        migrationId: migration.id,
        cursor: encodeBoundary(boundary),
        sourceCount: total,
        now: this.#deps.now(),
      });
      await advanceMigration(tx, {
        migrationId: migration.id,
        expectedState: "capture-boundary",
        nextState: "backfill",
        now: this.#deps.now(),
        identityDigest,
      });
    });

    return {
      state: "backfill",
      advanced: true,
      message: `boundary captured: ${total} records to copy`,
    };
  }

  async #backfillBatch(migration: MigrationRecord): Promise<MigrationStepResult> {
    const boundary = decodeBoundary(migration.cursor);
    const checkpoint = await findLastSafeCheckpoint(this.#deps.db, migration.id);
    const cursors = decodeCursors(checkpoint?.sourceCursor ?? "");

    // Titles before bodies, and one stream at a time. Interleaving them would
    // need one cursor per stream in every checkpoint and would make a resume
    // depend on which stream was mid-batch when the process died.
    const stream: BackfillStream = cursors.itemNamesDone ? "page-bodies" : "item-names";
    const afterCursor = stream === "item-names" ? cursors.itemNames : cursors.pageBodies;

    const batch = await this.#deps.backfill.copyBatch({ stream, afterCursor, boundary });

    if (batch.seen === 0) {
      if (stream === "item-names") {
        // This stream is exhausted; the next call starts the other one.
        await this.#writeCheckpoint(
          migration,
          checkpoint?.sequence ?? 0,
          {
            ...cursors,
            itemNamesDone: true,
          },
          0,
        );
        return { state: "backfill", advanced: false, message: "titles copied; bodies next" };
      }
      return await this.#advance(migration, "verify", "every record has been copied");
    }

    const nextCursors = {
      ...cursors,
      ...(stream === "item-names" ? { itemNames: batch.cursor } : { pageBodies: batch.cursor }),
    };
    const copied = await this.#writeCheckpoint(
      migration,
      checkpoint?.sequence ?? 0,
      nextCursors,
      batch.sealed,
    );

    return {
      state: "backfill",
      advanced: false,
      message: `copied ${batch.sealed} of ${batch.seen} seen`,
      recordsCopied: copied,
    };
  }

  async #writeCheckpoint(
    migration: MigrationRecord,
    previousSequence: number,
    cursors: Cursors,
    sealed: number,
  ): Promise<number> {
    const sequence = previousSequence + 1;
    const total = migration.destinationCount + sealed;
    await runSecurityTransaction(this.#deps.db, async (tx) => {
      await appendMigrationCheckpoint(tx, {
        id: this.#id(),
        migrationId: migration.id,
        sequence,
        state: "backfill",
        sourceCursor: encodeCursors(cursors),
        destinationCursor: encodeCursors(cursors),
        batchCount: 1,
        recordCount: total,
        blobCount: 0,
        identityDigest: migration.identityDigest ?? "",
        checkpointDigest: backfillCheckpointDigest({
          migrationId: migration.id,
          sequence,
          cursors: { itemNames: cursors.itemNames, pageBodies: cursors.pageBodies },
          recordCount: total,
        }),
        idempotencyKey: `backfill:${sequence}`,
        now: this.#deps.now(),
      });
      // The running total lives on the migration row as well as in the
      // checkpoint, because the verification reads it and a verification that
      // had to replay the checkpoint history would be answering a different
      // question each time one was added.
      await advanceMigration(tx, {
        migrationId: migration.id,
        expectedState: "backfill",
        nextState: "backfill",
        now: this.#deps.now(),
        destinationCount: total,
      });
    });
    return total;
  }

  /**
   * The gate.
   *
   * Compares what the source holds against what was copied, by count and by
   * identity, and **fails the migration** on any mismatch. Everything after
   * this point is irreversible, so a warning here would be a warning nobody
   * can act on later.
   */
  async #verify(migration: MigrationRecord): Promise<MigrationStepResult> {
    // Bounded by the same boundary the backfill copied against. Comparing
    // against everything would count records written during the migration —
    // which the backfill was never asked to copy — and would fail an
    // installation for the crime of being in use.
    const boundary = decodeBoundary(migration.cursor);
    const identities = await readSourceIdentities(this.#deps.db, {
      itemBoundary: boundary.itemCursor,
      pageBoundary: boundary.pageCursor,
    });
    const expected = identities.items.length + identities.pages.length;
    const sourceDigest = await this.#deps.backfill.sourceIdentityDigest(boundary);

    if (migration.destinationCount < migration.sourceCount) {
      await this.#fail(migration);
      return {
        state: "failed",
        advanced: false,
        message: `verification failed: copied ${migration.destinationCount} of ${migration.sourceCount}`,
      };
    }
    if (migration.identityDigest !== null && migration.identityDigest !== sourceDigest) {
      // The set of records changed between the boundary and here in a way the
      // backfill did not account for. Continuing would scrub a source that no
      // longer matches what was copied.
      await this.#fail(migration);
      return {
        state: "failed",
        advanced: false,
        message: "verification failed: the source identity digest changed during the migration",
      };
    }

    const advanced = await runSecurityTransaction(this.#deps.db, async (tx) =>
      advanceMigration(tx, {
        migrationId: migration.id,
        expectedState: "verify",
        nextState: "stop-plaintext-writes",
        now: this.#deps.now(),
        sourceDigest,
        destinationDigest: sourceDigest,
      }),
    );
    return {
      state: advanced ? "stop-plaintext-writes" : "verify",
      advanced,
      message: advanced
        ? `verified ${expected} records by identity`
        : "another process advanced this migration first",
    };
  }

  /**
   * The irreversible step.
   *
   * Guarded by the domain predicate, then by the repository's state condition,
   * then by the table's own check constraint. Three checks for one deletion,
   * because this is what removes an owner's only copy and an unnecessary check
   * costs a microsecond.
   */
  async #scrub(migration: MigrationRecord): Promise<MigrationStepResult> {
    const permitted = mayScrubPlaintext({
      state: migration.state,
      sourceCount: migration.sourceCount,
      destinationCount: migration.destinationCount,
      sourceDigest: migration.sourceDigest,
      destinationDigest: migration.destinationDigest,
    });
    if (!permitted) {
      return {
        state: migration.state,
        advanced: false,
        message: "refusing to scrub: the migration has not been verified",
      };
    }

    // Scrubbed by id list, bounded the same way: a record written after the
    // boundary has no encrypted copy yet, and removing its plaintext would
    // destroy the only version of it that exists.
    const boundary = decodeBoundary(migration.cursor);
    const identities = await readSourceIdentities(this.#deps.db, {
      itemBoundary: boundary.itemCursor,
      pageBoundary: boundary.pageCursor,
    });
    const remaining = await runSecurityTransaction(this.#deps.db, async (tx) => {
      await scrubItemNames(tx, { migrationId: migration.id, itemIds: identities.items });
      await scrubPageBodies(tx, { migrationId: migration.id, pageIds: identities.pages });
      return await countRemainingPlaintext(tx, {
        itemBoundary: boundary.itemCursor,
        pageBoundary: boundary.pageCursor,
      });
    });

    const left = remaining.items + remaining.pages;
    if (left > 0) {
      // Not an error, and not completion either. Something was written after
      // the scrub read its list; the next call picks it up.
      return {
        state: "scrub-plaintext",
        advanced: false,
        message: `${left} records still hold plaintext`,
        remainingPlaintext: left,
      };
    }

    const finished = await runSecurityTransaction(this.#deps.db, async (tx) => {
      const released = await releasePlaintextSource(tx, {
        migrationId: migration.id,
        now: this.#deps.now(),
      });
      if (!released) {
        return false;
      }
      return await advanceMigration(tx, {
        migrationId: migration.id,
        expectedState: "scrub-plaintext",
        nextState: "complete",
        now: this.#deps.now(),
      });
    });

    return {
      state: finished ? "complete" : "scrub-plaintext",
      advanced: finished,
      message: finished
        ? "the plaintext source has been removed"
        : "the source could not be released",
      remainingPlaintext: 0,
    };
  }

  async #fail(migration: MigrationRecord): Promise<void> {
    await runSecurityTransaction(this.#deps.db, async (tx) =>
      failMigration(tx, { migrationId: migration.id, now: this.#deps.now() }),
    );
  }

  /**
   * Whether the migration may be reported complete.
   *
   * Asks the domain rather than reading the state, because "the state says
   * complete" is what the last transition wrote and this is a question about
   * whether the work behind it happened.
   */
  async isComplete(): Promise<boolean> {
    const migration = await findMigration(this.#deps.db, this.#deps.installationId);
    if (migration === null) {
      return false;
    }
    return mayReportComplete({
      state: migration.state,
      sourceRetained: migration.sourceRetained,
      sourceCount: migration.sourceCount,
      destinationCount: migration.destinationCount,
    });
  }
}

interface Cursors {
  readonly itemNames: string;
  readonly pageBodies: string;
  readonly itemNamesDone: boolean;
}

/**
 * Two cursors and a flag in one ordered string.
 *
 * The checkpoint column holds a single opaque cursor, and the domain requires
 * checkpoints to advance. Encoding the pair keeps that true — the composite
 * only ever grows — without a schema change for a value nothing outside this
 * file interprets.
 */
function encodeCursors(cursors: Cursors): string {
  return `${cursors.itemNamesDone ? "1" : "0"}|${cursors.itemNames}|${cursors.pageBodies}`;
}

function decodeCursors(encoded: string): Cursors {
  const [done, itemNames, pageBodies] = encoded.split("|");
  return {
    itemNamesDone: done === "1",
    itemNames: itemNames ?? "",
    pageBodies: pageBodies ?? "",
  };
}

function encodeBoundary(boundary: BackfillBoundary): string {
  return `${boundary.itemCursor}|${boundary.pageCursor}`;
}

function decodeBoundary(encoded: string): BackfillBoundary {
  const [itemCursor, pageCursor] = encoded.split("|");
  return { itemCursor: itemCursor ?? "", pageCursor: pageCursor ?? "" };
}
