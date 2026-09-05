import { createHash } from "node:crypto";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createUpload, getUpload, schema } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { clearWorkspaceForRestore } from "../src/backup/database-restore-target.ts";
import { rotateProtectedFileBatch } from "../src/files/protected-file-rotation.ts";
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";
import { FileStorageMigration } from "../src/security/file-storage-migration.ts";
import {
  inventoryLegacyFileSources,
  readLegacyFileSource,
} from "../src/security/file-storage-source.ts";
import { enterStorageTransition } from "../src/security/file-storage-transition-guard.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";
import { createItemViaApi } from "./helpers/app.ts";
import { createProtectedFileHarness } from "./helpers/protected-files.ts";

async function* source(bytes: Uint8Array) {
  yield bytes;
}

it("protects a historical content identity in place without merging references or retiring its source", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const bytes = Buffer.from("historical shared and retained content");
    const raw = await files.deps.blobs.put(bytes);
    const contentId = generateUuidV7();
    await db.insert(schema.fileContents).values({
      id: contentId,
      ...raw,
      referenceCount: 2,
    });
    // Equal bytes already exist, but migration must retain the legacy UUID.
    const other = await db.transaction((tx) =>
      files.ingest(tx, source(bytes), { maxBytes: bytes.length }),
    );
    const protectedResult = await db.transaction((tx) =>
      files.protectLegacyContent(tx, contentId, source(bytes)),
    );
    expect(protectedResult.contentId).toBe(contentId);
    expect(protectedResult.contentId).not.toBe(other.contentId);
    expect(protectedResult.reusedExisting).toBe(false);
    const [row] = await db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, contentId));
    expect(row).toMatchObject({
      id: contentId,
      referenceCount: 2,
      sha256: null,
      storageKey: null,
      storageFormat: "encrypted-chunks-v1",
    });
    const chunks = [];
    for await (const chunk of files.read(db, contentId)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(await files.deps.blobs.get(raw.storageKey)).toEqual(new Uint8Array(bytes));
  } finally {
    await harness.close();
  }
});

it("refuses truncated or substituted historical bytes and leaves the legacy row recoverable", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const bytes = Buffer.from("original migration payload");
    const raw = await files.deps.blobs.put(bytes);
    const contentId = generateUuidV7();
    await db.insert(schema.fileContents).values({ id: contentId, ...raw, referenceCount: 1 });
    for (const invalid of [bytes.subarray(1), Buffer.alloc(bytes.length)]) {
      await expect(
        db.transaction((tx) => files.protectLegacyContent(tx, contentId, source(invalid))),
      ).rejects.toThrow();
      const [row] = await db
        .select()
        .from(schema.fileContents)
        .where(eq(schema.fileContents.id, contentId));
      expect(row).toMatchObject({
        storageFormat: "legacy-v1",
        storageKey: raw.storageKey,
        referenceCount: 1,
      });
      expect(Buffer.from(row?.sha256 ?? []).toString("hex")).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(
        await files.deps.content.readFileManifest(db, {
          kind: "content",
          id: contentId,
          recordVersion: 1,
        }),
      ).toBeNull();
    }
    await db.transaction((tx) => files.protectLegacyContent(tx, contentId, source(bytes)));
    expect((await files.manifest(db, contentId)).byteLength).toBe(bytes.length);
  } finally {
    await harness.close();
  }
});

it("preserves an acknowledged legacy upload prefix and resumes at exactly that offset", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files, workspaceId } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const uploads = new ProtectedUploadService(files);
    const bytes = Buffer.from("acknowledged private prefix");
    const legacy = await db.transaction((tx) =>
      createUpload(tx, {
        workspaceId: workspaceId as Uuid,
        originalName: "legacy private upload.txt",
        mediaType: "text/plain",
        declaredLength: bytes.length + 4,
        now: new Date(),
      }),
    );
    await db
      .update(schema.uploads)
      .set({ receivedLength: bytes.length })
      .where(eq(schema.uploads.id, legacy.id));
    await expect(
      db.transaction((tx) => uploads.protectLegacyUpload(tx, legacy.id, source(bytes.subarray(1)))),
    ).rejects.toThrow();
    expect(await getUpload(db, legacy.id)).toMatchObject({
      storageFormat: "legacy-v1",
      receivedLength: bytes.length,
      originalName: legacy.originalName,
    });
    const converted = await db.transaction((tx) =>
      uploads.protectLegacyUpload(tx, legacy.id, source(bytes)),
    );
    expect(converted).toMatchObject({
      id: legacy.id,
      receivedLength: bytes.length,
      declaredLength: bytes.length + 4,
      originalName: legacy.originalName,
      expiresAt: legacy.expiresAt,
    });
    const appended = await db.transaction((tx) =>
      uploads.append(tx, {
        id: legacy.id,
        offset: bytes.length,
        source: source(Buffer.from("tail")),
      }),
    );
    expect(appended.ok).toBe(true);
    const chunks = [];
    for await (const chunk of uploads.read(db, converted)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.concat([bytes, Buffer.from("tail")]));
    expect(await getUpload(db, legacy.id)).toMatchObject({
      originalName: "�",
      storageFormat: "encrypted-chunks-v1",
      receivedLength: bytes.length + 4,
    });
  } finally {
    await harness.close();
  }
});

it("inventories legacy prefixes, unacknowledged tails and temporary orphans without recopying protected chunks", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files, workspaceId } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const legacyBytes = Buffer.from("historical complete file");
    const blob = await files.deps.blobs.put(legacyBytes);
    const contentId = generateUuidV7();
    await db.insert(schema.fileContents).values({ id: contentId, ...blob, referenceCount: 1 });
    await db.transaction((tx) =>
      files.ingest(tx, source(Buffer.from("protected already")), { maxBytes: 100 }),
    );
    const upload = await db.transaction((tx) =>
      createUpload(tx, {
        workspaceId: workspaceId as Uuid,
        originalName: "interrupted.txt",
        mediaType: "text/plain",
        declaredLength: 100,
        now: new Date(),
      }),
    );
    const partial = Buffer.from("prefix with an unacknowledged tail");
    await db
      .update(schema.uploads)
      .set({ receivedLength: 6 })
      .where(eq(schema.uploads.id, upload.id));
    await mkdir(join(harness.blobRoot, "uploads"), { recursive: true });
    await writeFile(join(harness.blobRoot, "uploads", upload.id), partial);
    await mkdir(join(harness.blobRoot, "ab"), { recursive: true });
    const temporary = "ab/.tmp-0123456789abcdef";
    await writeFile(join(harness.blobRoot, temporary), "interrupted private write");
    const inventory = await inventoryLegacyFileSources(db, harness.blobRoot);
    expect(inventory).toHaveLength(4);
    expect(
      inventory
        .filter((entry) => entry.kind === "orphan")
        .map((entry) => entry.path)
        .sort(),
    ).toEqual([temporary, `uploads/${upload.id}`].sort());
    const acknowledged = inventory.find((entry) => entry.kind === "upload");
    if (acknowledged === undefined) throw new Error("Missing upload inventory");
    const chunks = [];
    for await (const bytes of readLegacyFileSource(harness.blobRoot, acknowledged))
      chunks.push(Buffer.from(bytes));
    expect(Buffer.concat(chunks)).toEqual(partial.subarray(0, 6));
    await writeFile(join(harness.blobRoot, "uploads", upload.id), Buffer.alloc(partial.length));
    await expect(
      (async () => {
        for await (const _ of readLegacyFileSource(harness.blobRoot, acknowledged)) {
          /* consume integrity boundary */
        }
      })(),
    ).rejects.toThrow("integrity");
  } finally {
    await harness.close();
  }
});

it("refuses symlinked or malformed historical sources instead of reading outside the store", async () => {
  const harness = await createProtectedFileHarness();
  const target = `${harness.blobRoot}-outside-source`;
  try {
    await writeFile(target, "must not be copied");
    const directory = join(harness.blobRoot, "ab");
    await mkdir(directory);
    const link = join(directory, ".tmp-0123456789abcdef");
    await symlink(target, link);
    await expect(
      inventoryLegacyFileSources(harness.built.context.db, harness.blobRoot),
    ).rejects.toThrow();
    await rm(link);
    await rm(target);
    await writeFile(join(directory, "unexpected.txt"), "unknown path");
    await expect(
      inventoryLegacyFileSources(harness.built.context.db, harness.blobRoot),
    ).rejects.toThrow("path");
  } finally {
    await rm(target, { force: true });
    await harness.close();
  }
});

it("blocks existing HTTP writers and a new server until the transaction-local migration resumes", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const page = await createItemViaApi(harness, { kind: "page", name: "pre-transition" });
    const [envelope] = await db.select().from(schema.protectedEnvelopes).limit(1);
    if (envelope === undefined) throw new Error("Missing envelope fixture");
    const transitionId = generateUuidV7();
    await db.insert(schema.fileStorageTransitions).values({
      id: transitionId,
      installationId: files.deps.installationId,
      sourceBackupId: generateUuidV7(),
      sourceInventoryEnvelopeId: envelope.id,
      phase: "inventoried",
    });
    const refused = await harness.owner({
      method: "PATCH",
      url: `/v1/items/${page.itemId}`,
      headers: { "idempotency-key": generateUuidV7() },
      payload: { name: "must roll back", baseRevisionId: page.revisionId },
    });
    expect(refused.statusCode, refused.body).toBe(503);
    expect(refused.json().code).toBe("migration_in_progress");
    expect((await files.deps.content.readItemPresentation(db, page.itemId))?.name).toBe(
      "pre-transition",
    );
    await expect(
      buildApp({
        databaseUrl: harness.postgres.connectionString,
        blobRoot: harness.blobRoot,
      }),
    ).rejects.toThrow("transition is incomplete");
    await db.transaction(async (tx) => {
      await enterStorageTransition(tx, transitionId);
      await files.deps.content.writeItemName(tx, {
        itemId: page.itemId,
        recordVersion: 1,
        name: "migration-authorized",
      });
    });
    await expect(
      files.deps.content.writeItemName(db, {
        itemId: page.itemId,
        recordVersion: 1,
        name: "no leaked bypass",
      }),
    ).rejects.toThrow("transition is incomplete");
    await db
      .update(schema.fileStorageTransitions)
      .set({ phase: "complete", completedAt: new Date() })
      .where(eq(schema.fileStorageTransitions.id, transitionId));
    await files.deps.content.writeItemName(db, {
      itemId: page.itemId,
      recordVersion: 1,
      name: "resumed",
    });
  } finally {
    await harness.close();
  }
});

it("requires source backup evidence and resumes atomic publication without losing orphan recovery references", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const contentId = generateUuidV7();
    const original = Buffer.from("checkpoint-preserved original bytes");
    const raw = await files.deps.blobs.put(original);
    await db.insert(schema.fileContents).values({ id: contentId, ...raw, referenceCount: 2 });
    await mkdir(join(harness.blobRoot, "ab"), { recursive: true });
    await writeFile(join(harness.blobRoot, "ab/.tmp-0123456789abcdef"), "recoverable orphan");
    await writeFile(join(harness.blobRoot, "ab/.tmp-fedcba9876543210"), "");
    const backupId = generateUuidV7();
    const verify = vi
      .fn<(id: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("missing verified archive"))
      .mockResolvedValue(undefined);
    const records = new ProtectedRecordService({
      db,
      keys: files.deps.keys,
      workspaceId: files.deps.workspaceId,
      installationId: files.deps.installationId,
      now: () => new Date(),
    });
    const migration = new FileStorageMigration({
      db,
      files,
      records,
      blobRoot: harness.blobRoot,
      verifySourceBackup: verify,
    });
    await expect(migration.prepare(backupId)).rejects.toThrow("verified archive");
    expect(await db.select().from(schema.fileStorageTransitions)).toHaveLength(0);
    expect(
      (await db.select().from(schema.fileContents).where(eq(schema.fileContents.id, contentId)))[0]
        ?.storageFormat,
    ).toBe("legacy-v1");
    const prepared = await migration.prepare(backupId);
    const publish = files.deps.blobs.put.bind(files.deps.blobs);
    vi.spyOn(files.deps.blobs, "put").mockImplementationOnce(async (bytes) => {
      await publish(bytes);
      throw new Error("interrupted after physical publication");
    });
    await expect(migration.publishNext(prepared.id)).rejects.toThrow("interrupted");
    expect(
      (await db.select().from(schema.fileStorageTransitionEntries)).every(
        (entry) => entry.phase === "inventoried",
      ),
    ).toBe(true);
    vi.restoreAllMocks();
    const resumed = await migration.prepare(generateUuidV7());
    expect(resumed.id).toBe(prepared.id);
    expect(verify).toHaveBeenLastCalledWith(backupId);
    let published = 0;
    while (await migration.publishNext(prepared.id)) published++;
    expect(published).toBe(3);
    expect(
      (await db.select().from(schema.fileStorageTransitionEntries)).every(
        (entry) => entry.phase === "published",
      ),
    ).toBe(true);
    const [firstChunk] = await db
      .select()
      .from(schema.protectedBlobChunks)
      .where(eq(schema.protectedBlobChunks.contentId, contentId));
    if (firstChunk === undefined) throw new Error("Missing published ciphertext");
    const encrypted = await files.deps.blobs.get(firstChunk.storageKey);
    if (encrypted === null) throw new Error("Missing ciphertext fixture");
    const physicalPath = join(
      harness.blobRoot,
      firstChunk.storageKey.slice(0, 2),
      firstChunk.storageKey,
    );
    const damaged = Buffer.from(encrypted);
    damaged[0] = (damaged[0] ?? 0) ^ 1;
    await writeFile(physicalPath, damaged);
    await expect(migration.verifyNext(prepared.id)).rejects.toThrow();
    expect(
      (await db.select().from(schema.fileStorageTransitionEntries)).every(
        (entry) => entry.phase === "published",
      ),
    ).toBe(true);
    await writeFile(physicalPath, encrypted);
    let verified = 0;
    while (await migration.verifyNext(prepared.id)) verified++;
    expect(verified).toBe(3);
    expect(
      (await db.select().from(schema.fileStorageTransitionEntries)).every(
        (entry) => entry.phase === "verified",
      ),
    ).toBe(true);
    const quarantine = await db.select().from(schema.protectedFileQuarantine);
    expect(quarantine).toHaveLength(2);
    expect(quarantine.filter((row) => row.storageKey === null)).toHaveLength(1);
    await db.transaction(async (tx) => {
      await enterStorageTransition(tx, prepared.id);
      const chunks = [];
      for await (const bytes of files.read(tx, contentId)) chunks.push(Buffer.from(bytes));
      expect(Buffer.concat(chunks)).toEqual(original);
      for (const orphan of quarantine) {
        const manifest = await files.manifest(tx, orphan.contentId);
        expect(manifest.byteLength).toBe(orphan.storageKey === null ? 0 : 18);
      }
    });
    expect(await files.deps.blobs.get(raw.storageKey)).toEqual(new Uint8Array(original));
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe("backfilling");
    // Isolate post-transition recovery boundaries; this fixture does not claim full cutover.
    await db
      .update(schema.fileStorageTransitions)
      .set({ phase: "complete", completedAt: new Date() })
      .where(eq(schema.fileStorageTransitions.id, prepared.id));
    await db.transaction((tx) => files.deps.keys.startNextGeneration(tx));
    while (await db.transaction((tx) => rotateProtectedFileBatch(tx, files, 1, 2, 1))) {
      /* bounded rotation */
    }
    const rotated = await db.select().from(schema.protectedFileQuarantine);
    for (const row of rotated.filter((row) => row.storageKey !== null))
      expect(quarantine.some((old) => old.storageKey === row.storageKey)).toBe(false);
    await db.transaction((tx) => clearWorkspaceForRestore(tx, files.deps.workspaceId as Uuid));
    expect(await db.select().from(schema.protectedFileQuarantine)).toHaveLength(2);
    for (const orphan of rotated) {
      const chunks = [];
      for await (const bytes of files.read(db, orphan.contentId)) chunks.push(Buffer.from(bytes));
      expect(Buffer.concat(chunks).toString()).toBe(
        orphan.storageKey === null ? "" : "recoverable orphan",
      );
    }
  } finally {
    vi.restoreAllMocks();
    await harness.close();
  }
});
