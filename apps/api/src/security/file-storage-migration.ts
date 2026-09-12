/** Durable source publication for the guarded protected-storage transition. */
import { createHash } from "node:crypto";
import {
  advanceStorageSource,
  advanceStorageTransition,
  type Database,
  getUpload,
  insertStorageSource,
  insertStorageTransition,
  listProtectedFileChunks,
  nextStorageSource,
  readStorageTransition,
  SCRUBBED_PLACEHOLDER,
  type StorageTransitionEntry,
  type StorageTransitionRecord,
  schema,
  type Transaction,
} from "@myownnotion/database";
import {
  type FullBackupSource,
  generateUuidV7,
  isUuid,
  isV0FullBackupSource,
  type Uuid,
} from "@myownnotion/domain";
import { and, eq, sql } from "drizzle-orm";
import { lockFullFileMaintenance, shareFullBlobDeletion } from "../backup/full/locks.ts";
import type { ProtectedFileService } from "../files/protected-file-service.ts";
import { ProtectedUploadService } from "../files/protected-upload-service.ts";
import {
  type CanonicalMetadataSource,
  canonicalMetadataDigest,
  inventoryCanonicalMetadata,
  protectCanonicalMetadata,
} from "./canonical-storage-migration.ts";
import {
  inventoryLegacyFileSources,
  type LegacyFileSource,
  readLegacyFileSource,
  retireLegacyFileSource,
} from "./file-storage-source.ts";
import { enterStorageTransition } from "./file-storage-transition-guard.ts";
import type { ProtectedRecordService } from "./protected-record-service.ts";

export type StorageMigrationBoundary =
  | "inventory"
  | "source-published"
  | "source-verified"
  | "metadata-protected"
  | "verified"
  | "cutover"
  | "source-unlinked"
  | "source-retired"
  | "complete";

export interface VerifiedStorageMigrationSourceBackup {
  readonly backupId: string;
  readonly source: FullBackupSource;
}

interface StorageTransitionInventory {
  readonly formatVersion: 2;
  readonly sourceBackupId: string;
  readonly installationId: string;
  readonly sourceProvenance: FullBackupSource | null;
  readonly digest: string;
  readonly entries: { readonly id: string; readonly kind: string; readonly objectId: string }[];
}

interface LegacyStorageTransitionInventory {
  readonly formatVersion: 1;
  readonly sourceBackupId: string;
  readonly installationId: string;
  readonly digest: string;
  readonly entries: { readonly id: string; readonly kind: string; readonly objectId: string }[];
}

export interface StorageMigrationDeps {
  readonly db: Database;
  readonly blobRoot: string;
  readonly files: ProtectedFileService;
  readonly records: ProtectedRecordService;
  /** Must authenticate the 024 pre-update receipt and actual archive for this installation. */
  readonly verifySourceBackup: (
    backupId: string,
  ) => Promise<VerifiedStorageMigrationSourceBackup | undefined>;
  readonly now?: () => Date;
  readonly onBoundary?: (boundary: StorageMigrationBoundary) => Promise<void>;
}

export class FileStorageMigration {
  constructor(readonly deps: StorageMigrationDeps) {}
  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private async write(tx: Transaction, type: string, id: string, value: unknown): Promise<string> {
    const payload = Buffer.from(JSON.stringify(value));
    try {
      return await this.deps.records.write(tx, {
        entityType: type,
        entityId: id,
        recordVersion: 1,
        payload,
      });
    } finally {
      payload.fill(0);
    }
  }

  private async read<T>(tx: Transaction, type: string, id: string): Promise<T> {
    const payload = await this.deps.records.read(tx, {
      entityType: type,
      entityId: id,
      recordVersion: 1,
    });
    if (payload === null) throw new Error("A protected storage checkpoint is unavailable.");
    try {
      return JSON.parse(Buffer.from(payload).toString("utf8")) as T;
    } finally {
      payload.fill(0);
    }
  }

  private checkedSourceBackup(
    backupId: string,
    verified: VerifiedStorageMigrationSourceBackup | undefined,
  ): VerifiedStorageMigrationSourceBackup {
    if (verified === undefined)
      throw new Error("An authenticated complete source backup is required.");
    if (verified.backupId !== backupId)
      throw new Error("The authenticated source backup identity does not match the transition.");
    return verified;
  }

  private isFullBackupSource(value: unknown): value is FullBackupSource {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    const text = (candidate: unknown) =>
      typeof candidate === "string" &&
      candidate.length > 0 &&
      candidate.length <= 1024 &&
      !Array.from(candidate).some((character) => character.charCodeAt(0) < 32);
    const migrations = source["appliedMigrations"];
    return (
      (source["installationId"] === null || isUuid(source["installationId"])) &&
      (source["applicationVersion"] === null || text(source["applicationVersion"])) &&
      (source["commit"] === null || /^[0-9a-f]{40,64}$/.test(String(source["commit"]))) &&
      (source["image"] === null || text(source["image"])) &&
      Number.isSafeInteger(source["postgresVersion"]) &&
      Number(source["postgresVersion"]) >= 180000 &&
      Number(source["postgresVersion"]) < 190000 &&
      Array.isArray(migrations) &&
      migrations.every(
        (migration) => typeof migration === "string" && /^[0-9a-z_-]+$/.test(migration),
      ) &&
      new Set(migrations).size === migrations.length
    );
  }

  private isInventoryEntries(
    value: unknown,
  ): value is { id: string; kind: string; objectId: string }[] {
    if (!Array.isArray(value)) return false;
    const ids = new Set<string>();
    const objects = new Set<string>();
    for (const entry of value) {
      if (
        entry === null ||
        typeof entry !== "object" ||
        !isUuid((entry as { id?: unknown }).id) ||
        !["content", "upload", "orphan", "metadata"].includes(
          String((entry as { kind?: unknown }).kind),
        ) ||
        !isUuid((entry as { objectId?: unknown }).objectId)
      )
        return false;
      const id = (entry as { id: string }).id;
      const object = `${String((entry as { kind: string }).kind)}:${(entry as { objectId: string }).objectId}`;
      if (ids.has(id) || objects.has(object)) return false;
      ids.add(id);
      objects.add(object);
    }
    return true;
  }

  private validateInventoryFields(inventory: {
    readonly sourceBackupId: string;
    readonly installationId: string;
    readonly digest: string;
    readonly entries: unknown;
  }): void {
    if (
      !isUuid(inventory.sourceBackupId) ||
      !isUuid(inventory.installationId) ||
      !/^[0-9a-f]{64}$/.test(inventory.digest) ||
      !this.isInventoryEntries(inventory.entries)
    )
      throw new Error("The protected transition inventory is invalid.");
  }

  private async readInventory(tx: Transaction, transitionId: string) {
    const inventory = await this.read<StorageTransitionInventory>(
      tx,
      "file.transition-inventory",
      transitionId,
    );
    if (
      inventory.formatVersion !== 2 ||
      (!this.isFullBackupSource(inventory.sourceProvenance) && inventory.sourceProvenance !== null)
    )
      throw new Error("The protected transition inventory is invalid.");
    this.validateInventoryFields(inventory);
    return inventory;
  }

  private async readAndUpgradeInventory(
    tx: Transaction,
    transitionId: string,
    verified: VerifiedStorageMigrationSourceBackup,
    expected: Pick<StorageTransitionRecord, "sourceBackupId" | "installationId" | "phase">,
  ): Promise<StorageTransitionInventory> {
    const inventory = await this.read<
      StorageTransitionInventory | LegacyStorageTransitionInventory
    >(tx, "file.transition-inventory", transitionId);
    this.validateInventoryFields(inventory);
    if (
      inventory.sourceBackupId !== expected.sourceBackupId ||
      inventory.installationId !== expected.installationId ||
      inventory.installationId !== this.deps.files.deps.installationId
    )
      throw new Error("The protected inventory identity does not match the storage transition.");
    if (inventory.formatVersion !== 1) return this.readInventory(tx, transitionId);
    if (!this.isFullBackupSource(verified.source))
      throw new Error("The authenticated source backup provenance is invalid.");
    if (
      verified.source.installationId !== null &&
      verified.source.installationId !== this.deps.files.deps.installationId
    )
      throw new Error("The source archive belongs to another installation.");
    const existingEntries = await tx
      .select()
      .from(schema.fileStorageTransitionEntries)
      .where(eq(schema.fileStorageTransitionEntries.transitionId, transitionId));
    if (existingEntries.length !== inventory.entries.length)
      throw new Error("The V1 inventory does not match its transition entries.");
    const byId = new Map(existingEntries.map((entry) => [entry.id, entry]));
    const sources: (LegacyFileSource | CanonicalMetadataSource)[] = [];
    for (const expectedEntry of inventory.entries) {
      const entry = byId.get(expectedEntry.id);
      if (
        entry === undefined ||
        entry.kind !== expectedEntry.kind ||
        entry.objectId !== expectedEntry.objectId
      )
        throw new Error("The V1 inventory does not match its transition entries.");
      const source = await this.read<LegacyFileSource | CanonicalMetadataSource>(
        tx,
        "file.transition-source",
        entry.id,
      );
      if (source.kind !== entry.kind || source.objectId !== entry.objectId)
        throw new Error("The V1 source checkpoint identity does not match its entry.");
      sources.push(source);
    }
    if (createHash("sha256").update(JSON.stringify(sources)).digest("hex") !== inventory.digest)
      throw new Error("The V1 source inventory digest does not match.");
    const hasMetadata = sources.some((source) => source.kind === "metadata");
    const metadata = await inventoryCanonicalMetadata(
      tx,
      this.deps.files.deps.content,
      this.deps.files.deps.workspaceId,
      { allowLegacyReservedValues: isV0FullBackupSource(verified.source) },
    );
    const existingMetadata = new Set(
      sources
        .filter((source): source is CanonicalMetadataSource => source.kind === "metadata")
        .map((source) => `${source.category}/${source.entityId}`),
    );
    const missingMetadata = metadata
      .filter((source) => !existingMetadata.has(`${source.category}/${source.entityId}`))
      .sort((left, right) => {
        const leftKey = `${left.category}/${left.entityId}`;
        const rightKey = `${right.category}/${right.entityId}`;
        return leftKey.localeCompare(rightKey);
      });
    if (hasMetadata && missingMetadata.length > 0)
      throw new Error("The V1 metadata inventory is incomplete.");
    if (missingMetadata.length > 0 && !["inventoried", "backfilling"].includes(expected.phase))
      throw new Error("The V1 metadata inventory cannot be extended in this phase.");
    const additions = hasMetadata
      ? []
      : missingMetadata.map((source) => ({ id: generateUuidV7(), source }));
    for (const addition of additions) {
      const sourceEnvelopeId = await this.write(
        tx,
        "file.transition-source",
        addition.id,
        addition.source,
      );
      await insertStorageSource(tx, {
        id: addition.id,
        transitionId,
        kind: addition.source.kind,
        objectId: addition.source.objectId,
        sourceEnvelopeId,
        phase: "inventoried",
      });
      sources.push(addition.source);
    }
    const upgraded: StorageTransitionInventory = {
      ...inventory,
      formatVersion: 2,
      sourceProvenance: verified.source,
      digest: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
      entries: [
        ...inventory.entries,
        ...additions.map((addition) => ({
          id: addition.id,
          kind: addition.source.kind,
          objectId: addition.source.objectId,
        })),
      ],
    };
    await this.write(tx, "file.transition-inventory", transitionId, upgraded);
    return this.readInventory(tx, transitionId);
  }

  private assertInventoryProvenance(
    inventory: StorageTransitionInventory,
    verified: VerifiedStorageMigrationSourceBackup | null,
  ): void {
    const actual = verified?.source ?? null;
    if (JSON.stringify(inventory.sourceProvenance) !== JSON.stringify(actual))
      throw new Error("The authenticated source provenance changed after inventory.");
  }

  private sourceAllowsLegacyReservedValues(inventory: StorageTransitionInventory): boolean {
    return inventory.sourceProvenance !== null && isV0FullBackupSource(inventory.sourceProvenance);
  }

  /** Caller owns the full RUN lock. No source/schema writes precede verified backup evidence. */
  async prepare(sourceBackupId: string): Promise<StorageTransitionRecord> {
    if (!isUuid(sourceBackupId)) throw new Error("A verified complete source backup is required.");
    const existing = await readStorageTransition(this.deps.db, this.deps.files.deps.installationId);
    if (existing?.phase === "complete") return existing;
    const authenticatedBackupId = existing?.sourceBackupId ?? sourceBackupId;
    const verified = this.checkedSourceBackup(
      authenticatedBackupId,
      await this.deps.verifySourceBackup(authenticatedBackupId),
    );
    if (!this.isFullBackupSource(verified.source))
      throw new Error("The authenticated source backup provenance is invalid.");
    if (
      verified.source.installationId !== null &&
      verified.source.installationId !== this.deps.files.deps.installationId
    )
      throw new Error("The source archive belongs to another installation.");
    if (existing !== null) {
      await this.deps.db.transaction(async (tx) => {
        await enterStorageTransition(tx, existing.id);
        await lockFullFileMaintenance(tx);
        const inventory = await this.readAndUpgradeInventory(tx, existing.id, verified, existing);
        this.assertInventoryProvenance(inventory, verified);
      });
      return existing;
    }
    return this.deps.db.transaction(async (tx) => {
      await lockFullFileMaintenance(tx);
      const allowLegacyReservedValues = isV0FullBackupSource(verified.source);
      const sources = [
        ...(await inventoryLegacyFileSources(tx, this.deps.blobRoot)),
        ...(await inventoryCanonicalMetadata(
          tx,
          this.deps.files.deps.content,
          this.deps.files.deps.workspaceId,
          { allowLegacyReservedValues },
        )),
      ];
      const transitionId = generateUuidV7();
      const entries = sources.map((source) => ({ id: generateUuidV7(), source }));
      const inventoryId = await this.write(tx, "file.transition-inventory", transitionId, {
        formatVersion: 2,
        sourceBackupId,
        installationId: this.deps.files.deps.installationId,
        sourceProvenance: verified?.source ?? null,
        digest: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
        entries: entries.map((entry) => ({
          id: entry.id,
          kind: entry.source.kind,
          objectId: entry.source.objectId,
        })),
      });
      await insertStorageTransition(tx, {
        id: transitionId,
        installationId: this.deps.files.deps.installationId,
        sourceBackupId,
        sourceInventoryEnvelopeId: inventoryId,
        phase: "inventoried",
      });
      await enterStorageTransition(tx, transitionId);
      for (const entry of entries) {
        const envelopeId = await this.write(tx, "file.transition-source", entry.id, entry.source);
        await insertStorageSource(tx, {
          id: entry.id,
          transitionId,
          kind: entry.source.kind,
          objectId: entry.source.objectId,
          sourceEnvelopeId: envelopeId,
          phase: "inventoried",
        });
      }
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (transition === null) throw new Error("The storage inventory did not commit.");
      return transition;
    });
  }

  /** One source, its replacement and its progress commit together. Sources remain on disk. */
  async publishNext(transitionId: string): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (
        transition?.id !== transitionId ||
        !["inventoried", "backfilling"].includes(transition.phase)
      )
        throw new Error("The storage transition cannot publish in this phase.");
      const entry = await nextStorageSource(tx, transitionId, "inventoried", "files");
      if (entry === null) return false;
      const source = await this.read<LegacyFileSource>(tx, "file.transition-source", entry.id);
      if (
        source.kind !== entry.kind ||
        source.objectId !== entry.objectId ||
        !isUuid(source.objectId)
      )
        throw new Error("The historical source checkpoint identity does not match.");
      const bytes = readLegacyFileSource(this.deps.blobRoot, source);
      if (source.kind === "content") {
        await this.deps.files.protectLegacyContent(tx, source.objectId as Uuid, bytes);
      } else if (source.kind === "upload") {
        await new ProtectedUploadService(this.deps.files).protectLegacyUpload(
          tx,
          source.objectId as Uuid,
          bytes,
        );
      } else if (source.kind === "orphan") {
        await this.deps.files.ingest(tx, bytes, {
          contentId: source.objectId as Uuid,
          expectedLength: source.byteLength,
          maxBytes: source.byteLength,
        });
      } else throw new Error("Unsupported historical source kind.");
      const replacementId = await this.write(tx, "file.transition-replacement", entry.id, {
        kind: source.kind,
        objectId: source.objectId,
        byteLength: source.byteLength,
        sha256: source.sha256,
      });
      if (source.kind === "orphan") {
        const chunks = await listProtectedFileChunks(
          tx,
          this.deps.files.scope("content", source.objectId),
        );
        for (const storageKey of chunks.length === 0
          ? [null]
          : chunks.map((chunk) => chunk.storageKey)) {
          await tx.insert(schema.protectedFileQuarantine).values({
            id: generateUuidV7(),
            transitionEntryId: entry.id,
            contentId: source.objectId,
            storageKey,
            manifestEnvelopeId: replacementId,
          });
        }
      }
      await advanceStorageSource(tx, {
        id: entry.id,
        from: "inventoried",
        to: "published",
        replacementEnvelopeId: replacementId,
        now: this.now(),
      });
      if (transition.phase === "inventoried")
        await advanceStorageTransition(tx, {
          id: transitionId,
          from: "inventoried",
          to: "backfilling",
          now: this.now(),
        });
      return true;
    });
  }

  /** Authenticate every replacement byte before advancing the durable verification checkpoint. */
  async verifyNext(transitionId: string): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (transition?.id !== transitionId || transition.phase !== "backfilling")
        throw new Error("The storage transition cannot verify in this phase.");
      const entry = await nextStorageSource(tx, transitionId, "published", "files");
      if (entry === null) return false;
      await this.verifyFileReplacement(tx, entry);
      await advanceStorageSource(tx, {
        id: entry.id,
        from: "published",
        to: "verified",
        now: this.now(),
      });
      return true;
    });
  }

  private async verifyFileReplacement(
    tx: Transaction,
    entry: StorageTransitionEntry,
  ): Promise<LegacyFileSource> {
    const source = await this.read<LegacyFileSource>(tx, "file.transition-source", entry.id);
    const replacement = await this.read<
      Pick<LegacyFileSource, "kind" | "objectId" | "byteLength" | "sha256">
    >(tx, "file.transition-replacement", entry.id);
    if (
      source.kind !== entry.kind ||
      source.objectId !== entry.objectId ||
      replacement.kind !== source.kind ||
      replacement.objectId !== source.objectId ||
      replacement.byteLength !== source.byteLength ||
      replacement.sha256 !== source.sha256
    )
      throw new Error("The replacement checkpoint does not match its source.");
    let bytes: AsyncIterable<Uint8Array>;
    if (source.kind === "upload") {
      const uploads = new ProtectedUploadService(this.deps.files);
      const upload = await getUpload(tx, source.objectId as Uuid);
      if (
        upload === null ||
        upload.declaredLength !== source.declaredLength ||
        upload.expiresAt.toISOString() !== source.expiresAt
      )
        throw new Error("Historical upload identity or lifetime changed.");
      const resolved = await uploads.resolve(tx, upload);
      if (
        resolved.originalName !== source.metadata?.originalName ||
        resolved.mediaType !== source.metadata?.mediaType
      )
        throw new Error("Historical upload metadata changed.");
      bytes = uploads.read(tx, upload);
    } else {
      if (source.kind === "content") {
        const [row] = await tx
          .select()
          .from(schema.fileContents)
          .where(eq(schema.fileContents.id, source.objectId));
        if (row?.referenceCount !== source.referenceCount)
          throw new Error("Historical content references changed.");
      }
      bytes = this.deps.files.read(tx, source.objectId);
    }
    const digest = createHash("sha256");
    let length = 0;
    for await (const chunk of bytes) {
      length += chunk.byteLength;
      digest.update(chunk);
    }
    if (length !== source.byteLength || digest.digest("hex") !== source.sha256)
      throw new Error("The protected replacement does not match its historical source.");
    return source;
  }

  /** Each historical current/history payload is sealed and verified in one resumable batch. */
  async publishMetadataNext(transitionId: string): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (
        transition?.id !== transitionId ||
        !["inventoried", "backfilling"].includes(transition.phase)
      )
        throw new Error("The storage transition cannot protect metadata in this phase.");
      if (
        (await nextStorageSource(tx, transitionId, "inventoried", "files")) !== null ||
        (await nextStorageSource(tx, transitionId, "published", "files")) !== null
      )
        throw new Error("Historical file replacements must verify before metadata cutover.");
      const entry = await nextStorageSource(tx, transitionId, "inventoried", "metadata");
      if (entry === null) {
        await advanceStorageTransition(tx, {
          id: transitionId,
          from: transition.phase as "inventoried" | "backfilling",
          to: "metadata-protected",
          now: this.now(),
        });
        return false;
      }
      const source = await this.read<CanonicalMetadataSource>(
        tx,
        "file.transition-source",
        entry.id,
      );
      if (
        source.kind !== "metadata" ||
        source.objectId !== entry.objectId ||
        !isUuid(source.entityId)
      )
        throw new Error("Historical metadata checkpoint identity does not match.");
      if (source.legacyPlaintextPlaceholder === true || source.legacyPlaintextPayload === true) {
        const inventory = await this.readInventory(tx, transitionId);
        if (!this.sourceAllowsLegacyReservedValues(inventory))
          throw new Error("Reserved legacy metadata has no authenticated V0 provenance.");
      }
      await protectCanonicalMetadata(tx, this.deps.files.deps.content, source);
      const replacementEnvelopeId = await this.write(
        tx,
        "file.transition-replacement",
        entry.id,
        source,
      );
      await advanceStorageSource(tx, {
        id: entry.id,
        from: "inventoried",
        to: "verified",
        replacementEnvelopeId,
        now: this.now(),
      });
      return true;
    });
  }

  /** Reconcile the complete authenticated inventory before recording global verification. */
  async finishVerification(transitionId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (transition?.id !== transitionId || transition.phase !== "metadata-protected")
        throw new Error("The storage transition cannot complete verification in this phase.");
      const inventory = await this.readInventory(tx, transitionId);
      if (
        inventory.sourceBackupId !== transition.sourceBackupId ||
        inventory.installationId !== transition.installationId ||
        !Array.isArray(inventory.entries)
      )
        throw new Error("The protected transition inventory is invalid.");
      const entries = await tx
        .select()
        .from(schema.fileStorageTransitionEntries)
        .where(eq(schema.fileStorageTransitionEntries.transitionId, transitionId));
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      if (
        entries.length !== inventory.entries.length ||
        new Set(inventory.entries.map((entry) => entry.id)).size !== entries.length
      )
        throw new Error("The storage inventory lost or added a checkpoint.");
      const sources: (LegacyFileSource | CanonicalMetadataSource)[] = [];
      for (const expected of inventory.entries) {
        const entry = byId.get(expected.id);
        if (
          entry === undefined ||
          entry.kind !== expected.kind ||
          entry.objectId !== expected.objectId ||
          entry.phase !== "verified"
        )
          throw new Error("A storage source has not reached verified cutover.");
        const source = await this.read<LegacyFileSource | CanonicalMetadataSource>(
          tx,
          "file.transition-source",
          entry.id,
        );
        if (source.kind !== entry.kind || source.objectId !== entry.objectId)
          throw new Error("The protected source identity does not match its checkpoint.");
        if (
          source.kind === "metadata" &&
          (source.legacyPlaintextPlaceholder === true || source.legacyPlaintextPayload === true) &&
          !this.sourceAllowsLegacyReservedValues(inventory)
        )
          throw new Error("Reserved legacy metadata has no authenticated V0 provenance.");
        for (const [type, envelopeId] of [
          ["file.transition-source", entry.sourceEnvelopeId],
          ["file.transition-replacement", entry.replacementEnvelopeId],
        ] as const) {
          const [record] = await tx
            .select({ id: schema.protectedEnvelopes.id })
            .from(schema.protectedEnvelopes)
            .where(
              and(
                eq(schema.protectedEnvelopes.entityType, type),
                eq(schema.protectedEnvelopes.entityId, entry.id),
                eq(schema.protectedEnvelopes.recordVersion, 1),
                eq(schema.protectedEnvelopes.workspaceId, this.deps.files.deps.workspaceId),
              ),
            );
          if (record?.id !== envelopeId)
            throw new Error("The storage checkpoint references another envelope.");
        }
        sources.push(source);
      }
      if (createHash("sha256").update(JSON.stringify(sources)).digest("hex") !== inventory.digest)
        throw new Error("The protected source inventory digest does not match.");
      const current = await inventoryCanonicalMetadata(
        tx,
        this.deps.files.deps.content,
        this.deps.files.deps.workspaceId,
      );
      const expectedMetadata = new Map(
        sources
          .filter((source): source is CanonicalMetadataSource => source.kind === "metadata")
          .map((source) => [`${source.category}/${source.entityId}`, source.digest]),
      );
      if (
        current.length !== expectedMetadata.size ||
        current.some(
          (source) =>
            expectedMetadata.get(`${source.category}/${source.entityId}`) !== source.digest,
        )
      )
        throw new Error("Canonical metadata identities or values changed during migration.");
      await this.assertProtectedCanonicalMetadata(tx, transitionId);
      await this.assertNoReadableSources(tx);
      await advanceStorageTransition(tx, {
        id: transitionId,
        from: "metadata-protected",
        to: "verified",
        now: this.now(),
      });
    });
  }

  private async assertProtectedCanonicalMetadata(
    tx: Transaction,
    transitionId: string,
  ): Promise<void> {
    const entries = await tx
      .select()
      .from(schema.fileStorageTransitionEntries)
      .where(
        and(
          eq(schema.fileStorageTransitionEntries.transitionId, transitionId),
          eq(schema.fileStorageTransitionEntries.kind, "metadata"),
        ),
      );
    for (const entry of entries) {
      const source = await this.read<CanonicalMetadataSource>(
        tx,
        "file.transition-source",
        entry.id,
      );
      if (
        source.kind !== "metadata" ||
        source.objectId !== entry.objectId ||
        (await canonicalMetadataDigest(tx, this.deps.files.deps.content, source, {
          requireProtected: true,
        })) !== source.digest
      )
        throw new Error("Protected canonical metadata changed during the transition.");
    }
  }

  private async assertNoReadableSources(tx: Transaction): Promise<void> {
    const workspaceId = this.deps.files.deps.workspaceId;
    const marker = JSON.stringify({ $myownnotionProtected: 1 });
    const result = await tx.execute<{ remaining: boolean }>(sql`SELECT
      EXISTS (SELECT 1 FROM file_contents WHERE storage_format <> 'encrypted-chunks-v1') OR
      EXISTS (SELECT 1 FROM uploads WHERE workspace_id = ${workspaceId} AND storage_format <> 'encrypted-chunks-v1') OR
      EXISTS (SELECT 1 FROM items WHERE workspace_id = ${workspaceId} AND (name <> ${SCRUBBED_PLACEHOLDER} OR icon IS NOT NULL)) OR
      EXISTS (SELECT 1 FROM page_documents p JOIN items i ON i.id = p.page_id
        WHERE i.workspace_id = ${workspaceId} AND p.body <> ${marker}::jsonb) OR
      EXISTS (SELECT 1 FROM logical_files f JOIN items i ON i.id = f.item_id
        WHERE i.workspace_id = ${workspaceId} AND (f.original_name <> ${SCRUBBED_PLACEHOLDER} OR f.media_type <> 'application/octet-stream')) OR
      EXISTS (SELECT 1 FROM revisions r JOIN items i ON i.id = r.item_id
        WHERE i.workspace_id = ${workspaceId} AND r.snapshot IS NOT NULL) OR
      EXISTS (SELECT 1 FROM relationships WHERE workspace_id = ${workspaceId}
        AND relation_type <> 'database:property' AND metadata <> ${marker}::jsonb) OR
      EXISTS (SELECT 1 FROM exports WHERE workspace_id = ${workspaceId} AND manifest IS NOT NULL)
      AS remaining`);
    if (result.rows[0]?.remaining !== false)
      throw new Error("Readable canonical sources remain before protected cutover.");
  }

  async cutover(transitionId: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      await this.assertProtectedCanonicalMetadata(tx, transitionId);
      await this.assertNoReadableSources(tx);
      await advanceStorageTransition(tx, {
        id: transitionId,
        from: "verified",
        to: "cutover",
        now: this.now(),
      });
    });
  }

  /** Reauthenticate replacements before durable unlink; a lost SQL acknowledgement is retryable. */
  async retireNext(transitionId: string): Promise<boolean> {
    return this.deps.db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await lockFullFileMaintenance(tx);
      const transition = await readStorageTransition(tx, this.deps.files.deps.installationId);
      if (
        transition?.id !== transitionId ||
        !["cutover", "retiring-sources"].includes(transition.phase)
      )
        throw new Error("The storage transition cannot retire sources in this phase.");
      if (transition.phase === "cutover")
        await advanceStorageTransition(tx, {
          id: transitionId,
          from: "cutover",
          to: "retiring-sources",
          now: this.now(),
        });
      const entry = await nextStorageSource(tx, transitionId, "verified");
      if (entry === null) {
        const inventory = await this.read<{
          entries: { id: string; kind: string; objectId: string }[];
        }>(tx, "file.transition-inventory", transitionId);
        const checkpoints = await tx
          .select()
          .from(schema.fileStorageTransitionEntries)
          .where(eq(schema.fileStorageTransitionEntries.transitionId, transitionId));
        const expected = new Map(inventory.entries.map((source) => [source.id, source]));
        if (
          checkpoints.length !== inventory.entries.length ||
          expected.size !== checkpoints.length ||
          checkpoints.some(
            (source) =>
              source.phase !== "retired" ||
              expected.get(source.id)?.kind !== source.kind ||
              expected.get(source.id)?.objectId !== source.objectId,
          )
        )
          throw new Error("The completed storage transition lost a retired checkpoint.");
        await this.assertProtectedCanonicalMetadata(tx, transitionId);
        await this.assertNoReadableSources(tx);
        await advanceStorageTransition(tx, {
          id: transitionId,
          from: "retiring-sources",
          to: "complete",
          now: this.now(),
        });
        return false;
      }
      if (entry.kind === "metadata") {
        const source = await this.read<CanonicalMetadataSource>(
          tx,
          "file.transition-source",
          entry.id,
        );
        if (
          source.kind !== "metadata" ||
          source.objectId !== entry.objectId ||
          (await canonicalMetadataDigest(tx, this.deps.files.deps.content, source, {
            requireProtected: true,
          })) !== source.digest
        )
          throw new Error("Canonical metadata changed before source retirement.");
      } else {
        const source = await this.verifyFileReplacement(tx, entry);
        await shareFullBlobDeletion(tx);
        const key = /^[0-9a-f]{2}\/([0-9a-f]{64})$/.exec(source.path)?.[1];
        if (key !== undefined) {
          const references = await tx.execute<{ referenced: boolean }>(sql`SELECT
            EXISTS (SELECT 1 FROM protected_blob_chunks WHERE storage_key = ${key}) OR
            EXISTS (SELECT 1 FROM protected_upload_chunks WHERE storage_key = ${key}) OR
            EXISTS (SELECT 1 FROM protected_file_quarantine WHERE storage_key = ${key}) OR
            EXISTS (SELECT 1 FROM file_contents WHERE storage_key = ${key}) AS referenced`);
          if (references.rows[0]?.referenced !== false)
            throw new Error("The legacy source is still referenced by active storage.");
        }
        await retireLegacyFileSource(this.deps.blobRoot, source);
        await this.deps.onBoundary?.("source-unlinked");
      }
      await advanceStorageSource(tx, {
        id: entry.id,
        from: "verified",
        to: "retired",
        now: this.now(),
      });
      return true;
    });
  }

  /** The guarded update owns RUN throughout; committed phases determine restart behavior. */
  async run(sourceBackupId: string): Promise<StorageTransitionRecord> {
    const prepared = await this.prepare(sourceBackupId);
    if (prepared.phase !== "complete") await this.deps.onBoundary?.("inventory");
    for (;;) {
      const transition = await readStorageTransition(
        this.deps.db,
        this.deps.files.deps.installationId,
      );
      if (transition?.id !== prepared.id) throw new Error("The storage transition disappeared.");
      const boundary = this.deps.onBoundary;
      switch (transition.phase) {
        case "inventoried":
        case "backfilling":
          if (await this.publishNext(transition.id)) {
            await boundary?.("source-published");
            break;
          }
          if (transition.phase === "backfilling" && (await this.verifyNext(transition.id))) {
            await boundary?.("source-verified");
            break;
          }
          await this.publishMetadataNext(transition.id);
          await boundary?.("metadata-protected");
          break;
        case "metadata-protected":
          await this.finishVerification(transition.id);
          await boundary?.("verified");
          break;
        case "verified":
          await this.cutover(transition.id);
          await boundary?.("cutover");
          break;
        case "cutover":
        case "retiring-sources":
          if (await this.retireNext(transition.id)) await boundary?.("source-retired");
          else await boundary?.("complete");
          break;
        case "complete":
          return transition;
        default:
          throw new Error("Unsupported protected storage transition phase.");
      }
    }
  }
}
