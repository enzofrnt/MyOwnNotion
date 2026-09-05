import {
  createUpload,
  type Database,
  getUpload,
  listProtectedFileChunks,
  lockDataKeyGeneration,
  lockUpload,
  putProtectedFileChunk,
  SCRUBBED_PLACEHOLDER,
  schema,
  type Transaction,
  type UploadRecord,
} from "@myownnotion/database";
import {
  PROTECTED_FILE_CHUNK_BYTES,
  type ProtectedFileManifest,
  type Uuid,
} from "@myownnotion/domain";
import { and, eq, lt } from "drizzle-orm";
import { shareFullFileMutation } from "../backup/full/locks.ts";
import { pinnedFileRead } from "./pinned-file-read.ts";
import { queueProtectedFileGarbage } from "./protected-file-cleanup.ts";
import {
  type ProtectedFileService,
  ProtectedFileUnavailableError,
} from "./protected-file-service.ts";

type UploadManifest = ProtectedFileManifest & { kind: "upload" };
export type ProtectedAppendOutcome =
  | { readonly ok: true; readonly upload: UploadRecord }
  | { readonly ok: false; readonly reason: "not-found" }
  | { readonly ok: false; readonly reason: "offset-mismatch"; readonly expected: number };

export class UploadLengthExceededError extends RangeError {
  constructor() {
    super("The upload would exceed its declared length.");
  }
}

export class ProtectedUploadService {
  constructor(readonly files: ProtectedFileService) {}

  async lockGeneration(tx: Transaction): Promise<number> {
    await shareFullFileMutation(tx);
    const key = await this.files.deps.keys.dataKey(tx, { writable: true });
    await lockDataKeyGeneration(tx, {
      workspaceId: this.files.deps.workspaceId,
      generation: key.generation,
      writable: true,
    });
    return key.generation;
  }

  async create(tx: Transaction, input: Parameters<typeof createUpload>[1]): Promise<UploadRecord> {
    await this.lockGeneration(tx);
    const upload = await createUpload(tx, {
      ...input,
      storageFormat: "encrypted-chunks-v1",
      originalName: SCRUBBED_PLACEHOLDER,
      mediaType: "application/octet-stream",
    });
    await this.files.deps.content.writeFileMetadata(tx, {
      kind: "upload",
      id: upload.id,
      recordVersion: 1,
      metadata: { originalName: input.originalName, mediaType: input.mediaType },
    });
    await this.files.deps.content.writeFileManifest(tx, {
      format: "myownnotion.protected-file",
      formatVersion: 1,
      kind: "upload",
      id: upload.id,
      recordVersion: 1,
      byteLength: 0,
      declaredLength: upload.declaredLength,
      sha256: null,
      chunks: [],
    });
    return { ...upload, originalName: input.originalName, mediaType: input.mediaType };
  }

  async state(executor: Database | Transaction, upload: UploadRecord): Promise<UploadManifest> {
    if (upload.storageFormat !== "encrypted-chunks-v1") throw new ProtectedFileUnavailableError();
    const state = await this.files.deps.content.readFileManifest(executor, {
      kind: "upload",
      id: upload.id,
      recordVersion: upload.manifestVersion,
    });
    if (
      state === null ||
      state.kind !== "upload" ||
      state.byteLength !== upload.receivedLength ||
      state.declaredLength !== upload.declaredLength
    )
      throw new ProtectedFileUnavailableError();
    return state;
  }

  async resolve(executor: Database | Transaction, upload: UploadRecord): Promise<UploadRecord> {
    await this.state(executor, upload);
    const metadata = await this.files.deps.content.readFileMetadata(executor, {
      kind: "upload",
      id: upload.id,
      recordVersion: 1,
    });
    if (metadata === null) throw new ProtectedFileUnavailableError();
    return { ...upload, ...metadata };
  }

  async get(executor: Database | Transaction, id: Uuid): Promise<UploadRecord | null> {
    const raw = await getUpload(executor, id);
    return raw === null ? null : this.resolve(executor, raw);
  }

  async append(
    tx: Transaction,
    input: { id: Uuid; offset: number; source: AsyncIterable<Uint8Array> },
  ): Promise<ProtectedAppendOutcome> {
    const generation = await this.lockGeneration(tx);
    const raw = await lockUpload(tx, input.id);
    if (raw === null) return { ok: false, reason: "not-found" };
    const upload = await this.resolve(tx, raw);
    if (input.offset !== upload.receivedLength)
      return { ok: false, reason: "offset-mismatch", expected: upload.receivedLength };
    const state = await this.state(tx, upload);
    const scope = this.files.scope("upload", upload.id);
    const existing = await listProtectedFileChunks(tx, scope);
    if (
      existing.length !== state.chunks.length ||
      existing.some((part, index) => {
        const trusted = state.chunks[index];
        return (
          trusted === undefined ||
          trusted.index !== part.chunkIndex ||
          trusted.storageKey !== part.storageKey ||
          trusted.byteLength !== part.byteLength ||
          trusted.keyGeneration !== part.keyGeneration ||
          trusted.recordVersion !== part.recordVersion
        );
      })
    )
      throw new ProtectedFileUnavailableError();
    const startIndex = Math.floor(upload.receivedLength / PROTECTED_FILE_CHUNK_BYTES);
    const oldTail = existing[startIndex];
    const store = this.files.chunkStore(tx);
    const nextVersion = upload.manifestVersion + 1;
    const binding = {
      installationId: scope.installationId,
      workspaceId: scope.workspaceId,
      kind: "upload" as const,
      contentId: upload.id,
      keyGeneration: generation,
      recordVersion: nextVersion,
    };
    let receivedLength = upload.receivedLength;
    const combined = (async function* () {
      if (oldTail !== undefined) {
        const bytes = await store.readChunk(oldTail, {
          ...binding,
          keyGeneration: oldTail.keyGeneration,
          recordVersion: oldTail.recordVersion,
        });
        try {
          yield bytes;
        } finally {
          bytes.fill(0);
        }
      }
      for await (const bytes of input.source) {
        receivedLength += bytes.byteLength;
        if (!Number.isSafeInteger(receivedLength) || receivedLength > upload.declaredLength)
          throw new UploadLengthExceededError();
        yield bytes;
      }
    })();
    const replacement = [];
    for await (const chunk of store.writeStream(combined, binding, startIndex))
      replacement.push(chunk);
    const chunks = [...existing.slice(0, startIndex), ...replacement];
    for (const chunk of replacement)
      await putProtectedFileChunk(tx, scope, chunk, this.files.deps.now());
    if (oldTail !== undefined)
      await queueProtectedFileGarbage(tx, scope.workspaceId, [oldTail.storageKey]);
    await this.files.deps.content.writeFileManifest(tx, {
      ...state,
      recordVersion: nextVersion,
      byteLength: receivedLength,
      chunks: chunks.map((chunk) => ({
        index: chunk.chunkIndex,
        byteLength: chunk.byteLength,
        storageKey: chunk.storageKey,
        keyGeneration: chunk.keyGeneration,
        recordVersion: chunk.recordVersion,
      })),
    });
    await tx
      .update(schema.uploads)
      .set({ receivedLength, manifestVersion: nextVersion })
      .where(eq(schema.uploads.id, upload.id));
    // Accepted upload state has one current version; obsolete inventories must
    // not accumulate once their offset/reference transaction has superseded them.
    await tx
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityType, "file.upload-state"),
          eq(schema.protectedEnvelopes.entityId, upload.id),
          lt(schema.protectedEnvelopes.recordVersion, nextVersion),
        ),
      );
    return { ok: true, upload: { ...upload, receivedLength, manifestVersion: nextVersion } };
  }

  async *read(executor: Database | Transaction, upload: UploadRecord): AsyncGenerator<Uint8Array> {
    const service = this;
    yield* pinnedFileRead(executor, async function* (tx: Transaction) {
      const current = await lockUpload(tx, upload.id);
      if (current === null) throw new ProtectedFileUnavailableError();
      yield* service.readPinned(tx, current);
    });
  }

  private async *readPinned(
    executor: Transaction,
    upload: UploadRecord,
  ): AsyncGenerator<Uint8Array> {
    const state = await this.state(executor, upload);
    const scope = this.files.scope("upload", upload.id);
    const chunks = await listProtectedFileChunks(executor, scope);
    yield* this.files.chunkStore(executor).readStream(
      chunks,
      {
        ...scope,
        contentId: upload.id,
        keyGeneration: chunks[0]?.keyGeneration ?? 1,
        recordVersion: state.recordVersion,
      },
      state,
    );
  }
}
