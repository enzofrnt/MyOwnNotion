/**
 * Reconciliation (T044, US6, FR-040/FR-041/FR-042).
 *
 * Reconnect pipeline:
 * 1. Recover interrupted `sending` rows to `pending`.
 * 2. Submit the durable outbox in order with stable mutation IDs
 *    (idempotent server replay absorbs duplicate transport delivery).
 * 3. Per-result: acknowledge, retain for retry, or capture a durable
 *    conflict with competing revision identities.
 * 4. Catch up through the ordered change cursor; a compacted cursor falls
 *    back to the verified snapshot WITHOUT touching the outbox.
 */
import type {
  CanonicalSnapshotDto,
  ChangesResponseDto,
  ItemDto,
  QueuedMutationDto,
  QueuedMutationResultDto,
  RevisionDto,
} from "@myownnotion/contracts";
import {
  type BlockDocument,
  type DatabaseDefinition,
  type EntryValues,
  mergeDatabaseDefinitions,
  mergeDocuments,
  mergeEntryValues,
  mergeRelationTargets,
  readDocumentBody,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";
import { LocalRepository } from "../local-store/local-repository.ts";
import {
  type LocalDatabase,
  META_KEYS,
  type StructuredConflictContext,
} from "../local-store/schema.ts";
import { Outbox } from "../outbox/outbox.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";

export interface ReconcileTransport {
  submitMutationBatch(
    mutations: QueuedMutationDto[],
  ): Promise<
    { ok: true; value: { results: QueuedMutationResultDto[] } } | { ok: false; offline: boolean }
  >;
  listChanges(
    after: string,
    limit?: number,
  ): Promise<
    { ok: true; value: ChangesResponseDto } | { ok: false; offline: boolean; compacted?: boolean }
  >;
  currentSnapshot(): Promise<
    { ok: true; value: CanonicalSnapshotDto } | { ok: false; offline: boolean }
  >;
  /**
   * One revision's retained content, for the automatic merge (feature 006).
   *
   * Optional so that a transport written before this feature — and every test
   * double built against it — keeps working. Without it, no merge is attempted
   * and a divergence is recorded as a conflict, which is the behaviour that
   * existed before: less convenient, never wrong.
   */
  getRevision?(
    revisionId: Uuid,
  ): Promise<{ ok: true; value: RevisionDto } | { ok: false; offline: boolean }>;
}

export interface ReconcileOutcome {
  readonly submitted: number;
  readonly accepted: number;
  readonly conflicts: number;
  /** Mutations the server refused for a condition retrying cannot clear. */
  readonly blocked: number;
  readonly retained: number;
  readonly caughtUpTo: string;
  readonly usedSnapshotFallback: boolean;
  readonly offline: boolean;
}

const BATCH_LIMIT = 100;

/**
 * Whether a refusal is a condition on the server rather than a competing change.
 *
 * The distinction decides what the owner is asked to do. A conflict needs them
 * to choose between two versions; a block needs them to wait or to clear the
 * condition, and offering a choice between versions would be nonsense because
 * there is only one.
 */
function isWriteBlock(code: string | undefined): boolean {
  return code === "write_blocked" || code === "rotation.write-blocked";
}

/**
 * Reads a revision's body as blocks, or gives up.
 *
 * Gives up on a legacy body rather than converting one. A legacy document has no
 * block identities, so "the same block changed on both sides" is not a question
 * that can be asked about it — and a merge that guessed would be guessing about
 * an owner's words.
 */
function blocksOf(document: unknown): BlockDocument | null {
  const read = readDocumentBody(document);
  return read.kind === "blocks" && read.result.ok ? read.result.document : null;
}

/**
 * Tries to merge a refused edit with the head that beat it (T025, FR-013).
 *
 * Returns the payload to resubmit, or `null` when the owner has to decide. Every
 * `null` here is a decision to ask rather than to guess, and the reasons to ask
 * are deliberately broad: an unavailable revision, a legacy body, a missing
 * transport method, more than one competing revision. None of those are
 * conflicts, but in all of them a merge would be operating on less than it
 * needs — and the cost of asking unnecessarily is an interruption, while the cost
 * of merging wrongly is lost work.
 */
type AutomaticMergeAttempt =
  | {
      readonly kind: "merged";
      readonly payload: Record<string, unknown>;
      readonly baseRevisionIds: Uuid[];
    }
  | { readonly kind: "needs-owner"; readonly structured: StructuredConflictContext }
  | null;

function snapshotRecord(snapshot: unknown): Record<string, unknown> | null {
  return typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>)
    : null;
}

async function tryAutomaticMerge(
  db: LocalDatabase,
  codec: LocalRecordCodec,
  transport: ReconcileTransport,
  row: { commandType: string; payload: Record<string, unknown>; baseRevisionIds: Uuid[] },
  competingRevisionIds: readonly Uuid[],
): Promise<AutomaticMergeAttempt> {
  if (transport.getRevision === undefined) return null;
  const competing = competingRevisionIds[0];
  const ancestorId = row.baseRevisionIds[0];
  if (competing === undefined || competingRevisionIds.length !== 1 || ancestorId === undefined) {
    return null;
  }

  const [ancestorRead, remoteRead] = await Promise.all([
    transport.getRevision(ancestorId),
    transport.getRevision(competing),
  ]);
  if (!ancestorRead.ok || !remoteRead.ok) {
    // Often because the snapshot passed its retention window. The three-way
    // comparison needs the common ancestor, and without it the honest answer is
    // that this cannot be merged safely.
    return null;
  }

  const ancestorSnapshot = snapshotRecord(ancestorRead.value.snapshot);
  const remoteSnapshot = snapshotRecord(remoteRead.value.snapshot);

  if (row.commandType === "database.definition.replace") {
    // A destructive confirmation digest is tied to the old base. Reusing it
    // after a merge would turn an obsolete decision into permission.
    if (row.payload["impactConfirmation"] !== undefined) return null;
    const ancestor = ancestorSnapshot?.["databaseDefinition"] as DatabaseDefinition | undefined;
    const local = row.payload["definition"] as DatabaseDefinition | undefined;
    const remote = remoteSnapshot?.["databaseDefinition"] as DatabaseDefinition | undefined;
    if (ancestor === undefined || local === undefined || remote === undefined) return null;
    const outcome = mergeDatabaseDefinitions(ancestor, local, remote);
    if (outcome.kind === "needs-owner") {
      return {
        kind: "needs-owner",
        structured: {
          kind: "database-definition",
          conflicts: outcome.conflicts,
          ancestor,
          local,
          remote,
        },
      };
    }
    return {
      kind: "merged",
      payload: { ...row.payload, baseRevisionId: competing, definition: outcome.value },
      baseRevisionIds: [competing],
    };
  }

  if (row.commandType === "database.entry.values.replace") {
    const entryId = row.payload["entryId"];
    if (typeof entryId !== "string") return null;
    const stored = await db.databaseEntries.get(entryId as Uuid);
    if (stored === undefined || stored.sealedValues === null) return null;
    const local = (await codec.openDatabaseEntry(stored)).values;
    const ancestor = ancestorSnapshot?.["databaseEntryValues"] as EntryValues | undefined;
    const remote = remoteSnapshot?.["databaseEntryValues"] as EntryValues | undefined;
    if (ancestor === undefined || remote === undefined) return null;
    const ancestorRelationTargets =
      (ancestorSnapshot?.["databaseRelationTargets"] as RelationTargets | undefined) ?? {};
    const localRelationTargets =
      (row.payload["relationTargets"] as RelationTargets | undefined) ?? {};
    const remoteRelationTargets =
      (remoteSnapshot?.["databaseRelationTargets"] as RelationTargets | undefined) ?? {};
    const valueOutcome = mergeEntryValues({ ancestor, local, remote });
    const relationOutcome = mergeRelationTargets(
      ancestorRelationTargets,
      localRelationTargets,
      remoteRelationTargets,
    );
    if (valueOutcome.kind === "needs-owner" || relationOutcome.kind === "needs-owner") {
      return {
        kind: "needs-owner",
        structured: {
          kind: "database-entry-values",
          conflicts: [
            ...(valueOutcome.kind === "needs-owner" ? valueOutcome.conflicts : []),
            ...(relationOutcome.kind === "needs-owner" ? relationOutcome.conflicts : []),
          ],
          ancestor,
          local,
          remote,
          ancestorRelationTargets,
          localRelationTargets,
          remoteRelationTargets,
        },
      };
    }
    return {
      kind: "merged",
      payload: {
        ...row.payload,
        baseRevisionId: competing,
        values: valueOutcome.value.values,
        relationTargets: relationOutcome.value,
      },
      baseRevisionIds: [competing],
    };
  }

  if (row.commandType !== "page.document.replace") return null;
  const ancestor = blocksOf(snapshotBody(ancestorSnapshot));
  const remote = blocksOf(snapshotBody(remoteSnapshot));
  const local = blocksOf((row.payload["document"] as { body?: unknown } | undefined)?.body);
  if (ancestor === null || remote === null || local === null) {
    return null;
  }

  const outcome = mergeDocuments(ancestor, local, remote);
  if (outcome.kind !== "merged") {
    return null;
  }
  const document = row.payload["document"] as Record<string, unknown>;
  return {
    kind: "merged",
    payload: {
      ...row.payload,
      document: { ...document, body: outcome.document },
      // Rebased onto the head that refused it. Keeping the old base would have
      // the server refuse the merged result for the same reason it refused the
      // original.
      baseRevisionId: competing,
    },
    baseRevisionIds: [competing],
  };
}

/** Where a revision snapshot keeps the page body. */
function snapshotBody(snapshot: Record<string, unknown> | null): unknown {
  if (snapshot === null) {
    return null;
  }
  const document = snapshot["pageDocument"] as { body?: unknown } | undefined;
  return document?.body;
}

export async function reconcile(
  db: LocalDatabase,
  transport: ReconcileTransport,
  codec: LocalRecordCodec,
): Promise<ReconcileOutcome> {
  const outbox = new Outbox(db);
  const repository = new LocalRepository(db, codec);

  await outbox.recoverInterrupted();

  let submitted = 0;
  let accepted = 0;
  let conflicts = 0;
  let blocked = 0;
  /**
   * Mutations already merged and requeued in this pass.
   *
   * A bound, not a cache. A requeued mutation goes back to `pending`, so the
   * submission loop picks it up again — and if the head moved once more it can be
   * refused, merged and requeued again, indefinitely, on a workspace where
   * another device is writing steadily. One merge per mutation per pass means the
   * second refusal becomes a conflict the owner is told about, which is slower
   * but terminates.
   */
  const alreadyMerged = new Set<string>();

  // Submit the durable queue in stable order.
  for (;;) {
    const pending = (await outbox.pending()).slice(0, BATCH_LIMIT);
    if (pending.length === 0) {
      break;
    }
    const mutationIds = pending.map((row) => row.mutationId);
    await outbox.markSending(mutationIds);
    const response = await transport.submitMutationBatch(
      pending.map((row) => ({
        mutationId: row.mutationId,
        commandType: row.commandType,
        baseRevisionIds: row.baseRevisionIds,
        payload: row.payload,
      })),
    );
    if (!response.ok) {
      // Interrupted attempt: everything recovers to pending, nothing is lost.
      for (const mutationId of mutationIds) {
        await outbox.markPendingAgain(mutationId);
      }
      return {
        submitted,
        accepted,
        conflicts,
        blocked,
        retained: (await outbox.pending()).length,
        caughtUpTo: await repository.getLastChangeCursor(),
        usedSnapshotFallback: false,
        offline: true,
      };
    }

    submitted += pending.length;
    for (const result of response.value.results) {
      const mutationId = result.mutationId as Uuid;
      if (result.status === "accepted" || result.status === "already-accepted") {
        accepted += 1;
        await outbox.acknowledge(mutationId);
      } else if (result.status === "conflict") {
        // Before asking the owner anything: most "conflicts" are two devices
        // touching different paragraphs of the same page, and asking about those
        // teaches an owner that the question is noise (FR-013). A merge is
        // attempted, and only a genuine divergence — the same block changed on
        // both sides, or deleted on one and rewritten on the other — becomes a
        // conflict record.
        const row = pending.find((queued) => queued.mutationId === mutationId);
        const merged =
          row === undefined || alreadyMerged.has(mutationId)
            ? null
            : await tryAutomaticMerge(
                db,
                codec,
                transport,
                row,
                (result.competingRevisionIds ?? []) as Uuid[],
              );
        if (merged?.kind === "merged") {
          alreadyMerged.add(mutationId);
          // Requeued as an ordinary edit based on the head that beat it. Not as
          // a resolution: nothing needed deciding, so recording a two-parent
          // revision would put a conflict in the history that never happened.
          await outbox.requeueMerged(mutationId, merged.payload, merged.baseRevisionIds);
          continue;
        }
        conflicts += 1;
        await outbox.captureConflict(
          mutationId,
          (result.competingRevisionIds ?? []) as Uuid[],
          result.problem?.code ?? "mutation.conflict",
          undefined,
          merged?.kind === "needs-owner" ? merged.structured : undefined,
        );
      } else if (isWriteBlock(result.problem?.code)) {
        // Refused by a condition on the server rather than by a competing
        // change: retrying will not help until that condition clears. Recording
        // it as a conflict would ask the owner to choose between versions when
        // there is no second version — and would hide the one thing they can
        // act on (FR-010).
        blocked += 1;
        await outbox.markBlocked(
          mutationId,
          result.problem?.title ?? "The server is not accepting changes right now.",
        );
      } else {
        // Deterministic rejection: retain durably as a conflict record so
        // the local work stays recoverable rather than silently dropped.
        conflicts += 1;
        await outbox.captureConflict(
          mutationId,
          (result.competingRevisionIds ?? []) as Uuid[],
          result.problem?.code ?? "mutation.rejected",
        );
      }
    }
  }

  // Ordered catch-up after the durable cursor.
  let usedSnapshotFallback = false;
  let cursor = await repository.getLastChangeCursor();
  for (;;) {
    const page = await transport.listChanges(cursor);
    if (!page.ok) {
      if (page.compacted === true) {
        // Verified snapshot fallback (FR-041): rebuild the projection,
        // preserving outbox and conflicts untouched.
        const snapshot = await transport.currentSnapshot();
        if (!snapshot.ok) {
          return {
            submitted,
            accepted,
            conflicts,
            blocked,
            retained: (await outbox.pending()).length,
            caughtUpTo: cursor,
            usedSnapshotFallback: false,
            offline: true,
          };
        }
        await repository.replaceFromSnapshot({
          workspaceId: snapshot.value.workspaceId as Uuid,
          schemaVersion: snapshot.value.schemaVersion,
          cursor: snapshot.value.cursor,
          items: snapshot.value.items as ItemDto[],
          relationships: snapshot.value.relationships,
          ...(snapshot.value.databases === undefined
            ? {}
            : { databases: snapshot.value.databases }),
          ...(snapshot.value.databaseEntries === undefined
            ? {}
            : { databaseEntries: snapshot.value.databaseEntries }),
        });
        usedSnapshotFallback = true;
        cursor = snapshot.value.cursor;
        continue;
      }
      return {
        submitted,
        accepted,
        conflicts,
        blocked,
        retained: (await outbox.pending()).length,
        caughtUpTo: cursor,
        usedSnapshotFallback,
        offline: true,
      };
    }

    for (const change of page.value.changes) {
      await repository.applyServerChange({
        cursor: String(change.sequence),
        items: (change.changedItems ?? []) as ItemDto[],
        ...(change.relationships === undefined ? {} : { relationships: change.relationships }),
        ...(change.databases === undefined ? {} : { databases: change.databases }),
        ...(change.databaseEntries === undefined
          ? {}
          : { databaseEntries: change.databaseEntries }),
      });
    }
    cursor = page.value.nextCursor;
    if (page.value.changes.length === 0) {
      await repository.setMeta(META_KEYS.lastChangeCursor, cursor);
    }
    if (!page.value.hasMore) {
      break;
    }
  }

  return {
    submitted,
    accepted,
    conflicts,
    blocked,
    retained: (await outbox.pending()).length,
    caughtUpTo: cursor,
    usedSnapshotFallback,
    offline: false,
  };
}
