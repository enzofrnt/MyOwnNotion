/** Idempotent recovery of historical whole-document page conflicts. */

import type { RevisionDto } from "@myownnotion/contracts";
import {
  type BlockDocument,
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  generateUuidV7,
  isUuid,
  migrateDocumentV2ToV3,
  migrateStoredPageDocumentToV3,
  normaliseDocument,
  normaliseDocumentV3,
  readDocumentBody,
  readVersionedDocumentEnvelope,
  type Uuid,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  diffLegacyDocuments,
  LegacyDocumentDiffError,
  type LegacyOfflineBranch,
  OperationalPageDocument,
} from "@myownnotion/page-state";
import type {
  ConflictRecordRow,
  LegacySyncRecoveryReasonCode,
  LegacySyncRecoveryRow,
  LegacySyncRecoveryStatus,
  LocalDatabase,
} from "../local-store/schema.ts";
import type { LocalRecordCodec, SealedConflictRecordRow } from "../security/local-record-codec.ts";
import type {
  EncryptedPageOperationLog,
  LegacyOfflineBranchRecord,
} from "./encrypted-update-log.ts";
import { withPageStateWrite } from "./page-write-coordinator.ts";

export type LegacyRecoveryRevisionResult =
  | { readonly ok: true; readonly value: Pick<RevisionDto, "id" | "itemId" | "snapshot"> }
  | { readonly ok: false; readonly offline: boolean; readonly code: string };

export interface LegacyConflictRecoveryOptions {
  readonly db: LocalDatabase;
  readonly codec: LocalRecordCodec;
  readonly log: EncryptedPageOperationLog;
  readonly loadRevision: (revisionId: Uuid) => Promise<LegacyRecoveryRevisionResult>;
  readonly now?: () => Date;
  readonly createId?: () => Uuid;
}

export interface LegacyConflictRecoveryPass {
  readonly classified: number;
  readonly prepared: number;
  readonly completed: number;
  readonly quarantined: number;
  readonly offline: boolean;
  readonly pageIds: readonly Uuid[];
}

function documentV3(envelope: unknown): BlockDocumentV3 | null {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const record = envelope as Record<string, unknown>;
  if (typeof record["formatVersion"] !== "number") return null;
  const migrated = migrateStoredPageDocumentToV3({
    formatVersion: record["formatVersion"],
    body: record["body"],
  });
  return migrated.ok ? normaliseDocumentV3(migrated.document) : null;
}

function baseDocumentV2(snapshot: unknown): BlockDocument | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const envelope = (snapshot as Record<string, unknown>)["pageDocument"];
  const read = readVersionedDocumentEnvelope(envelope);
  if (read.kind === "v2") return read.result.ok ? normaliseDocument(read.result.document) : null;
  if (
    envelope !== null &&
    typeof envelope === "object" &&
    !Array.isArray(envelope) &&
    (envelope as Record<string, unknown>)["formatVersion"] === 1
  ) {
    const body = (envelope as Record<string, unknown>)["body"];
    const legacy = readDocumentBody(body);
    return legacy.kind === "legacy"
      ? normaliseDocument(upgradeLegacyBody(legacy.body))
      : legacy.result.ok
        ? normaliseDocument(legacy.result.document)
        : null;
  }
  return null;
}

function localDocument(conflict: ConflictRecordRow): BlockDocumentV3 | null {
  return documentV3(conflict.payload["document"]);
}

function pageIdFromConflict(conflict: ConflictRecordRow): Uuid | null {
  const itemId = conflict.payload["itemId"];
  return isUuid(itemId) ? itemId : null;
}

function sortedRecoveries(rows: readonly LegacySyncRecoveryRow[]): LegacySyncRecoveryRow[] {
  return [...rows].sort(
    (left, right) =>
      left.capturedAt.localeCompare(right.capturedAt) ||
      left.mutationId.localeCompare(right.mutationId),
  );
}

export class LegacyConflictRecovery {
  readonly #db: LocalDatabase;
  readonly #codec: LocalRecordCodec;
  readonly #log: EncryptedPageOperationLog;
  readonly #loadRevision: LegacyConflictRecoveryOptions["loadRevision"];
  readonly #now: () => Date;
  readonly #createId: () => Uuid;

  constructor(options: LegacyConflictRecoveryOptions) {
    this.#db = options.db;
    this.#codec = options.codec;
    this.#log = options.log;
    this.#loadRevision = options.loadRevision;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? generateUuidV7;
  }

  async #openConflict(stored: unknown): Promise<ConflictRecordRow> {
    if (typeof stored === "object" && stored !== null && "payload" in stored) {
      return stored as ConflictRecordRow;
    }
    return await this.#codec.openConflict(stored as SealedConflictRecordRow);
  }

  async #fallbackPageId(row: ConflictRecordRow | SealedConflictRecordRow): Promise<Uuid | null> {
    const headers = await this.#db.revisionHeaders.bulkGet([
      ...row.localRevisionIds,
      ...row.baseRevisionIds,
    ]);
    return headers.find((header) => header !== undefined)?.itemId ?? null;
  }

  async classify(): Promise<{ readonly classified: number; readonly quarantined: number }> {
    const rows = (await this.#db.conflicts.toArray()).filter(
      ({ commandType }) => commandType === "page.document.replace",
    );
    let classified = 0;
    let quarantined = 0;
    for (const stored of rows) {
      if ((await this.#db.legacySyncRecoveries.get(stored.mutationId)) !== undefined) continue;
      let pageId = await this.#fallbackPageId(stored as ConflictRecordRow);
      let status: LegacySyncRecoveryStatus = "pending";
      let reasonCode: LegacySyncRecoveryReasonCode | null = null;
      try {
        const conflict = await this.#openConflict(stored);
        pageId = pageIdFromConflict(conflict) ?? pageId;
        if (pageId === null || localDocument(conflict) === null) {
          status = "quarantined";
          reasonCode =
            pageId === null
              ? "legacy-recovery.item-not-page"
              : "legacy-recovery.schema-unsupported";
        }
      } catch {
        status = "quarantined";
        reasonCode = "legacy-recovery.payload-unreadable";
      }
      const timestamp = this.#now().toISOString();
      const installed = await this.#db.transaction(
        "rw",
        this.#db.legacySyncRecoveries,
        async () => {
          if ((await this.#db.legacySyncRecoveries.get(stored.mutationId)) !== undefined) {
            return false;
          }
          await this.#db.legacySyncRecoveries.add({
            mutationId: stored.mutationId,
            pageId,
            status,
            reasonCode,
            branchId: null,
            attemptCount: 0,
            capturedAt: stored.capturedAt,
            updatedAt: timestamp,
          });
          return true;
        },
      );
      if (installed) {
        classified += 1;
        if (status === "quarantined") quarantined += 1;
      }
    }
    return { classified, quarantined };
  }

  async list(statuses?: readonly LegacySyncRecoveryStatus[]): Promise<LegacySyncRecoveryRow[]> {
    const rows = await this.#db.legacySyncRecoveries.toArray();
    const selected =
      statuses === undefined ? rows : rows.filter(({ status }) => statuses.includes(status));
    return sortedRecoveries(selected);
  }

  async retainedConflict(mutationId: Uuid): Promise<ConflictRecordRow | null> {
    const stored = await this.#db.conflicts.get(mutationId);
    if (stored === undefined) return null;
    try {
      return await this.#openConflict(stored);
    } catch {
      return null;
    }
  }

  async #transition(
    row: LegacySyncRecoveryRow,
    status: LegacySyncRecoveryStatus,
    reasonCode: LegacySyncRecoveryReasonCode | null,
  ): Promise<void> {
    await this.#db.legacySyncRecoveries.update(row.mutationId, {
      status,
      reasonCode,
      attemptCount: row.attemptCount + 1,
      updatedAt: this.#now().toISOString(),
    });
  }

  async #complete(row: LegacySyncRecoveryRow): Promise<void> {
    await this.#db.transaction(
      "rw",
      [this.#db.conflicts, this.#db.legacySyncRecoveries],
      async () => {
        const current = await this.#db.legacySyncRecoveries.get(row.mutationId);
        if (current === undefined) return;
        await this.#db.legacySyncRecoveries.put({
          ...current,
          status: "converted",
          reasonCode: null,
          updatedAt: this.#now().toISOString(),
        });
        await this.#db.conflicts.delete(row.mutationId);
      },
    );
  }

  async #currentPage(pageId: Uuid): Promise<{
    readonly isPage: boolean;
    readonly documents: readonly BlockDocumentV3[];
  }> {
    const stored = await this.#db.items.get(pageId);
    if (stored === undefined || stored.kind !== "page") {
      return { isPage: false, documents: [] };
    }
    // Opening proves that the routing row still belongs to the local key, but
    // its page body is deliberately NOT proof of server integration. A refused
    // whole-document mutation already updated that optimistic cache, so using
    // it here would archive the very draft we still need to convert.
    await this.#codec.openItem(stored);
    const state = await this.#log.getState(pageId);
    const documents = [
      ...(state?.status === "active" && state.projection !== null
        ? [normaliseDocumentV3(state.projection.document)]
        : []),
    ];
    return { isPage: true, documents };
  }

  async #prepare(row: LegacySyncRecoveryRow): Promise<{
    readonly kind: "prepared" | "completed" | "quarantined" | "offline" | "busy";
    readonly pageId?: Uuid;
  }> {
    const pageId = row.pageId;
    if (pageId === null) return { kind: "quarantined" };
    const storedConflict = await this.#db.conflicts.get(row.mutationId);
    if (storedConflict === undefined) {
      await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
      return { kind: "quarantined" };
    }
    let conflict: ConflictRecordRow;
    try {
      conflict = await this.#openConflict(storedConflict);
    } catch {
      await this.#transition(row, "quarantined", "legacy-recovery.payload-unreadable");
      return { kind: "quarantined" };
    }
    const local = localDocument(conflict);
    if (local === null) {
      await this.#transition(row, "quarantined", "legacy-recovery.schema-unsupported");
      return { kind: "quarantined" };
    }
    const payloadPageId = pageIdFromConflict(conflict);
    if (payloadPageId !== null && payloadPageId !== pageId) {
      await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
      return { kind: "quarantined" };
    }
    let current: {
      readonly isPage: boolean;
      readonly documents: readonly BlockDocumentV3[];
    };
    try {
      current = await this.#currentPage(pageId);
    } catch {
      await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
      return { kind: "quarantined" };
    }
    if (!current.isPage) {
      await this.#transition(row, "quarantined", "legacy-recovery.item-not-page");
      return { kind: "quarantined" };
    }
    const localJson = canonicalDocumentJsonV3(local);
    if (current.documents.some((document) => canonicalDocumentJsonV3(document) === localJson)) {
      await this.#complete(row);
      return { kind: "completed", pageId };
    }

    const rawBaseRevisionId = conflict.baseRevisionIds[0] ?? conflict.payload["baseRevisionId"];
    if (!isUuid(rawBaseRevisionId)) {
      await this.#transition(row, "quarantined", "legacy-recovery.base-unavailable");
      return { kind: "quarantined" };
    }
    const header = await this.#db.revisionHeaders.get(rawBaseRevisionId);
    const baseRevisionId = header?.canonicalRevisionId ?? rawBaseRevisionId;
    const revision = await this.#loadRevision(baseRevisionId);
    if (!revision.ok) {
      if (revision.offline) return { kind: "offline", pageId };
      await this.#transition(row, "quarantined", "legacy-recovery.base-unavailable");
      return { kind: "quarantined" };
    }
    if (revision.value.itemId !== pageId) {
      await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
      return { kind: "quarantined" };
    }
    const baseV2 = baseDocumentV2(revision.value.snapshot);
    if (baseV2 === null) {
      await this.#transition(row, "quarantined", "legacy-recovery.schema-unsupported");
      return { kind: "quarantined" };
    }

    let branch: LegacyOfflineBranch;
    try {
      const branchId = row.branchId ?? this.#createId();
      const diff = await diffLegacyDocuments({
        pageId,
        base: normaliseDocumentV3(migrateDocumentV2ToV3(baseV2)),
        local,
      });
      branch = await createLegacyOfflineBranch({
        branchId,
        pageId,
        baseRevisionId,
        baseDocument: baseV2,
        createdAt: row.capturedAt,
      });
      branch = await appendLegacySemanticTransaction(branch, {
        transactionId: this.#createId(),
        sequence: 1,
        commands: diff.commands,
      });
    } catch (error) {
      const reasonCode =
        error instanceof LegacyDocumentDiffError
          ? "legacy-recovery.diff-unprovable"
          : "legacy-recovery.integrity-failed";
      await this.#transition(row, "quarantined", reasonCode);
      return { kind: "quarantined" };
    }

    const projection = await OperationalPageDocument.create({
      pageId,
      document: local,
    }).project();
    const record: LegacyOfflineBranchRecord = {
      pageId,
      branchId: branch.branchId,
      status: "editing",
      createdAt: branch.createdAt,
      recordVersion: 1,
      branch,
      requiredFileIds: projection.fileUsageIds,
    };
    const sealed = await this.#log.codec.sealLegacyBranch(record);
    const installed = await withPageStateWrite(
      this.#db,
      pageId,
      async () =>
        await this.#db.transaction(
          "rw",
          [this.#db.conflicts, this.#db.legacyOfflineBranches, this.#db.legacySyncRecoveries],
          async () => {
            const [source, recovery, existingBranch] = await Promise.all([
              this.#db.conflicts.get(row.mutationId),
              this.#db.legacySyncRecoveries.get(row.mutationId),
              this.#db.legacyOfflineBranches.get(pageId),
            ]);
            if (source === undefined || recovery?.status !== "pending") return false;
            if (existingBranch !== undefined && existingBranch.status !== "converted") return false;
            if (existingBranch !== undefined) await this.#db.legacyOfflineBranches.delete(pageId);
            await this.#db.legacyOfflineBranches.put(sealed);
            await this.#db.legacySyncRecoveries.put({
              ...recovery,
              status: "converting",
              reasonCode: null,
              branchId: branch.branchId,
              attemptCount: recovery.attemptCount + 1,
              updatedAt: this.#now().toISOString(),
            });
            return true;
          },
        ),
    );
    return installed ? { kind: "prepared", pageId } : { kind: "busy" };
  }

  async recoverAvailable(): Promise<LegacyConflictRecoveryPass> {
    const classified = await this.classify();
    let prepared = 0;
    let completed = 0;
    let quarantined = classified.quarantined;
    let offline = false;
    const pageIds = new Set<Uuid>();

    // A crash from an earlier build may have persisted the terminal routing
    // row but not retired the source conflict. Delete it only when both the
    // exact converted branch and an active checkpoint still prove success.
    const converted = await this.list(["converted"]);
    for (const row of converted) {
      if ((await this.#db.conflicts.get(row.mutationId)) === undefined) continue;
      if (row.pageId === null || row.branchId === null) {
        await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
        quarantined += 1;
        continue;
      }
      const [branch, state] = await Promise.all([
        this.#log.getLegacyBranch(row.pageId),
        this.#log.getState(row.pageId),
      ]);
      if (
        branch?.branchId === row.branchId &&
        branch.status === "converted" &&
        state?.status === "active"
      ) {
        await this.#complete(row);
        completed += 1;
      } else {
        await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
        quarantined += 1;
      }
    }

    const converting = await this.list(["converting"]);
    for (const row of converting) {
      if (row.pageId === null || row.branchId === null) {
        await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
        quarantined += 1;
        continue;
      }
      const [source, branch] = await Promise.all([
        this.#db.conflicts.get(row.mutationId),
        this.#db.legacyOfflineBranches.get(row.pageId),
      ]);
      if (branch === undefined || branch.branchId !== row.branchId) {
        await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
        quarantined += 1;
      } else if (branch.status === "converted") {
        const state = await this.#log.getState(row.pageId);
        if (state?.status !== "active") {
          await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
          quarantined += 1;
        } else {
          await this.#complete(row);
          completed += 1;
        }
      } else if (branch.status === "blocked") {
        await this.#transition(row, "quarantined", "legacy-recovery.base-unavailable");
        quarantined += 1;
      } else if (source === undefined) {
        await this.#transition(row, "quarantined", "legacy-recovery.integrity-failed");
        quarantined += 1;
      } else {
        pageIds.add(row.pageId);
      }
    }

    const activePages = new Set(pageIds);
    for (const row of await this.list(["pending"])) {
      if (row.pageId !== null && activePages.has(row.pageId)) continue;
      const outcome = await this.#prepare(row);
      if (outcome.pageId !== undefined) {
        pageIds.add(outcome.pageId);
        activePages.add(outcome.pageId);
      }
      if (outcome.kind === "prepared") prepared += 1;
      else if (outcome.kind === "completed") completed += 1;
      else if (outcome.kind === "quarantined") quarantined += 1;
      else if (outcome.kind === "offline") offline = true;
    }
    return {
      classified: classified.classified,
      prepared,
      completed,
      quarantined,
      offline,
      pageIds: [...pageIds].sort(),
    };
  }
}
