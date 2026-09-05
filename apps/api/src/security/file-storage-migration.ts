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
  type StorageTransitionRecord,
  schema,
  type Transaction,
} from "@myownnotion/database";
import { generateUuidV7, isUuid, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { lockFullFileMaintenance } from "../backup/full/locks.ts";
import type { ProtectedFileService } from "../files/protected-file-service.ts";
import { ProtectedUploadService } from "../files/protected-upload-service.ts";
import {
  type CanonicalMetadataSource,
  inventoryCanonicalMetadata,
  protectCanonicalMetadata,
} from "./canonical-storage-migration.ts";
import {
  inventoryLegacyFileSources,
  type LegacyFileSource,
  readLegacyFileSource,
} from "./file-storage-source.ts";
import { enterStorageTransition } from "./file-storage-transition-guard.ts";
import type { ProtectedRecordService } from "./protected-record-service.ts";

export interface StorageMigrationDeps {
  readonly db: Database;
  readonly blobRoot: string;
  readonly files: ProtectedFileService;
  readonly records: ProtectedRecordService;
  /** Must authenticate the 024 pre-update receipt and actual archive for this installation. */
  readonly verifySourceBackup: (backupId: string) => Promise<void>;
  readonly now?: () => Date;
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

  /** Caller owns the full RUN lock. No source/schema writes precede verified backup evidence. */
  async prepare(sourceBackupId: string): Promise<StorageTransitionRecord> {
    if (!isUuid(sourceBackupId)) throw new Error("A verified complete source backup is required.");
    const existing = await readStorageTransition(this.deps.db, this.deps.files.deps.installationId);
    await this.deps.verifySourceBackup(existing?.sourceBackupId ?? sourceBackupId);
    if (existing !== null) return existing;
    return this.deps.db.transaction(async (tx) => {
      await lockFullFileMaintenance(tx);
      const sources = [
        ...(await inventoryLegacyFileSources(tx, this.deps.blobRoot)),
        ...(await inventoryCanonicalMetadata(
          tx,
          this.deps.files.deps.content,
          this.deps.files.deps.workspaceId,
        )),
      ];
      const transitionId = generateUuidV7();
      const entries = sources.map((source) => ({ id: generateUuidV7(), source }));
      const inventoryId = await this.write(tx, "file.transition-inventory", transitionId, {
        formatVersion: 1,
        sourceBackupId,
        installationId: this.deps.files.deps.installationId,
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
      await advanceStorageSource(tx, {
        id: entry.id,
        from: "published",
        to: "verified",
        now: this.now(),
      });
      return true;
    });
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
}
