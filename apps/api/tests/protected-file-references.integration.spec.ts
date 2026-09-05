import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countProtectedFileChunksInGeneration,
  countRecordsInGeneration,
  createDatabase,
  createInstallation,
  type Database,
  findCurrentGeneration,
  getOrCreateWorkspace,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { startMigratedPostgres } from "@myownnotion/test-utils";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { parseCommand } from "../src/admin/command-parser.ts";
import {
  type DataKeyRotationDeps,
  rotationDataKeyCommand,
} from "../src/admin/commands/rotation-data-key.ts";
import { lockFullFileMaintenance } from "../src/backup/full/locks.ts";
import { countVerifiedFileGenerationReferences } from "../src/files/protected-file-references.ts";
import { createProtectedFileRuntime } from "../src/files/protected-file-runtime.ts";
import { ProtectedFileUnavailableError } from "../src/files/protected-file-service.ts";
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";
import { KeyUnavailableError } from "../src/security/key-hierarchy.ts";

interface Fixture {
  db: Database;
  runtime: ReturnType<typeof createProtectedFileRuntime>;
  deps: DataKeyRotationDeps;
  workspaceId: Uuid;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const postgres = await startMigratedPostgres();
  const handle = createDatabase(postgres.connectionString);
  const root = await mkdtemp(join(tmpdir(), "mon-file-references-"));
  const key = randomBytes(32);
  const now = () => new Date();
  try {
    const installationId = generateUuidV7();
    const workspaceId = (await getOrCreateWorkspace(handle.db)).id;
    await createInstallation(handle.db, {
      id: installationId,
      sourceLineageId: installationId,
      schemaVersion: 1,
    });
    const runtime = createProtectedFileRuntime({
      db: handle.db,
      installationId,
      workspaceId,
      blobRoot: root,
      deploymentKey: () => key,
      now,
    });
    await handle.db.transaction((tx) => runtime.keys.initialize(tx));
    await handle.db.insert(schema.rotationPolicies).values({
      id: generateUuidV7(),
      installationId,
      kind: "data-key",
      mode: "scheduled",
      dueIntervalDays: 180,
      dueAt: now(),
      writeBlockAt: new Date(Date.now() + 86_400_000),
      currentGeneration: 1,
      state: "due",
    });
    await run({
      db: handle.db,
      workspaceId: workspaceId as Uuid,
      runtime,
      deps: {
        db: handle.db,
        installationId,
        workspaceId,
        deploymentKey: () => key,
        now,
        batchSize: 2,
        protectedFiles: runtime.files,
      },
    });
  } finally {
    key.fill(0);
    await handle.close();
    await postgres.stop();
    await rm(root, { recursive: true, force: true });
  }
}

async function* source(bytes: Uint8Array) {
  yield bytes;
}

async function expectBytes(stream: AsyncIterable<Uint8Array>, expected: Buffer) {
  const chunks: Buffer[] = [];
  for await (const bytes of stream) chunks.push(Buffer.from(bytes));
  expect(Buffer.concat(chunks)).toEqual(expected);
}

async function createFiles({ db, runtime, workspaceId }: Fixture) {
  const content = Buffer.from("completed attachment whose index can be repaired");
  const partial = Buffer.from("acknowledged upload prefix whose index can be repaired");
  const stored = await db.transaction((tx) =>
    runtime.files.ingest(tx, source(content), { maxBytes: content.length }),
  );
  const transfers = new ProtectedUploadService(runtime.files);
  const upload = await db.transaction((tx) =>
    transfers.create(tx, {
      workspaceId,
      originalName: "recoverable upload.txt",
      mediaType: "text/plain",
      declaredLength: partial.length + 4,
      now: new Date(),
    }),
  );
  await db.transaction((tx) =>
    transfers.append(tx, { id: upload.id, offset: 0, source: source(partial) }),
  );
  return { content, partial, stored, upload, transfers };
}

function verify(fixture: Fixture, generation = 1, files = fixture.runtime.files) {
  return fixture.db.transaction(async (tx) => {
    await lockFullFileMaintenance(tx);
    return countVerifiedFileGenerationReferences(tx, {
      workspaceId: fixture.workspaceId,
      generation,
      files,
    });
  });
}

const rotate = parseCommand(["security", "rotation", "data-key", "--yes"]);
const revoke = parseCommand([
  "security",
  "rotation",
  "data-key",
  "--revoke-generation",
  "1",
  "--yes",
]);
const dryRevoke = parseCommand([
  "security",
  "rotation",
  "data-key",
  "--revoke-generation",
  "1",
  "--dry-run",
]);

it.each(["content", "upload"] as const)(
  "keeps generation 1 recoverable after losing the entire %s index, then resumes the same rotation",
  async (kind) => {
    await withFixture(async (fixture) => {
      const { db, runtime, deps, workspaceId } = fixture;
      const { content, partial, stored, upload, transfers } = await createFiles(fixture);
      const savedContent = await db
        .select()
        .from(schema.protectedBlobChunks)
        .where(eq(schema.protectedBlobChunks.contentId, stored.contentId));
      const savedUpload = await db
        .select()
        .from(schema.protectedUploadChunks)
        .where(eq(schema.protectedUploadChunks.uploadId, upload.id));
      expect(savedContent).toHaveLength(1);
      expect(savedUpload).toHaveLength(1);
      if (kind === "content") {
        await db.delete(schema.protectedBlobChunks);
      } else {
        await db.delete(schema.protectedUploadChunks);
      }

      const failed = await rotationDataKeyCommand(rotate, deps, { execute: true });
      expect(failed.code, failed.message).toBe(EXIT_CODES.integrityFailure);
      expect(failed.data?.["operationId"]).toEqual(expect.any(String));
      expect((await findCurrentGeneration(db, workspaceId))?.generation).toBe(2);
      // Both mutable SQL counters now report zero. The authenticated manifest
      // is the remaining evidence that the old key still protects real bytes.
      expect(await countRecordsInGeneration(db, { workspaceId, keyGeneration: 1 })).toBe(0);
      expect(
        await countProtectedFileChunksInGeneration(db, { workspaceId, keyGeneration: 1 }),
      ).toBe(0);
      const currentUpload = await transfers.get(db, upload.id);
      if (currentUpload === null) throw new Error("Missing upload fixture");
      const manifest =
        kind === "content"
          ? await runtime.files.manifest(db, stored.contentId)
          : await transfers.state(db, currentUpload);
      expect(manifest.chunks.map((chunk) => chunk.keyGeneration)).toEqual([1]);

      const { protectedFiles: _files, ...withoutRuntime } = deps;
      for (const commandDeps of [deps, withoutRuntime]) {
        for (const [command, execute] of [
          [revoke, true],
          [dryRevoke, false],
        ] as const) {
          const refused = await rotationDataKeyCommand(command, commandDeps, { execute });
          expect(refused.code, refused.message).toBe(EXIT_CODES.integrityFailure);
        }
      }
      const missingRuntime = await rotationDataKeyCommand(rotate, withoutRuntime, {
        execute: true,
      });
      expect(missingRuntime.code, missingRuntime.message).toBe(EXIT_CODES.integrityFailure);
      expect(missingRuntime.data?.["operationId"]).toBe(failed.data?.["operationId"]);
      const oldKey = await runtime.keys.dataKey(db, { generation: 1, writable: false });
      expect(oldKey.material.byteLength).toBe(32);
      expect(await db.select().from(schema.rotationOperations)).toHaveLength(1);

      if (kind === "content") {
        await db.insert(schema.protectedBlobChunks).values(savedContent);
      } else {
        await db.insert(schema.protectedUploadChunks).values(savedUpload);
      }
      await expectBytes(runtime.files.read(db, stored.contentId), content);
      await expectBytes(transfers.read(db, currentUpload), partial);

      const resumed = await rotationDataKeyCommand(rotate, deps, { execute: true });
      expect(resumed.code, resumed.message).toBe(EXIT_CODES.ok);
      expect(resumed.data?.["operationId"]).toBe(failed.data?.["operationId"]);
      expect(await verify(fixture)).toBe(0);
      expect((await rotationDataKeyCommand(dryRevoke, deps, { execute: false })).code).toBe(
        EXIT_CODES.ok,
      );
      expect((await rotationDataKeyCommand(revoke, deps, { execute: true })).code).toBe(
        EXIT_CODES.ok,
      );
      await expect(
        runtime.keys.dataKey(db, { generation: 1, writable: false }),
      ).rejects.toBeInstanceOf(KeyUnavailableError);
      await expectBytes(runtime.files.read(db, stored.contentId), content);
      const finished = await transfers.get(db, upload.id);
      if (finished === null) throw new Error("Missing resumed upload fixture");
      expect(finished.receivedLength).toBe(partial.length);
      expect(finished.originalName).toBe("recoverable upload.txt");
      await expectBytes(transfers.read(db, finished), partial);
      expect(await db.select().from(schema.rotationOperations)).toHaveLength(1);
    });
  },
);

it.each(["content", "upload"] as const)(
  "rejects %s index metadata that disagrees with the authenticated manifest",
  async (kind) => {
    await withFixture(async (fixture) => {
      const { db } = fixture;
      await createFiles(fixture);
      const table = kind === "content" ? schema.protectedBlobChunks : schema.protectedUploadChunks;
      const [original] = await db.select().from(table);
      if (original === undefined) throw new Error("Missing chunk fixture");
      expect(await verify(fixture)).toBe(2);
      for (const change of [
        { chunkIndex: 1 },
        { storageKey: "0".repeat(64) },
        { byteLength: original.byteLength + 1 },
        { keyGeneration: 2 },
        { recordVersion: original.recordVersion + 1 },
      ]) {
        await db.update(table).set(change).where(eq(table.id, original.id));
        await expect(verify(fixture)).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
        await db.update(table).set(original).where(eq(table.id, original.id));
      }
      expect(await verify(fixture)).toBe(2);
    });
  },
);

it.each(["content", "upload"] as const)(
  "finds a remaining %s manifest even when its object and all chunk index rows are gone",
  async (kind) => {
    await withFixture(async (fixture) => {
      const { db } = fixture;
      const { stored, upload } = await createFiles(fixture);
      if (kind === "content") {
        await db.delete(schema.protectedBlobChunks);
        await db.delete(schema.fileContents).where(eq(schema.fileContents.id, stored.contentId));
      } else {
        await db.delete(schema.uploads).where(eq(schema.uploads.id, upload.id));
      }
      await expect(verify(fixture)).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
    });
  },
);

it.each(["content", "upload"] as const)(
  "rejects a %s object whose current authenticated manifest is missing",
  async (kind) => {
    await withFixture(async (fixture) => {
      const { db } = fixture;
      const { stored, upload } = await createFiles(fixture);
      await db
        .delete(schema.protectedEnvelopes)
        .where(
          and(
            eq(
              schema.protectedEnvelopes.entityType,
              kind === "content" ? "file.content-manifest" : "file.upload-state",
            ),
            eq(
              schema.protectedEnvelopes.entityId,
              kind === "content" ? stored.contentId : upload.id,
            ),
          ),
        );
      await expect(verify(fixture)).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
    });
  },
);

it("requires the matching protected runtime only when file identities exist", async () => {
  await withFixture(async (fixture) => {
    const countWithoutRuntime = () =>
      fixture.db.transaction(async (tx) => {
        await lockFullFileMaintenance(tx);
        return countVerifiedFileGenerationReferences(tx, {
          workspaceId: fixture.workspaceId,
          generation: 1,
          files: undefined,
        });
      });
    expect(await countWithoutRuntime()).toBe(0);
    await createFiles(fixture);
    await fixture.db.delete(schema.protectedBlobChunks);
    await fixture.db.delete(schema.protectedUploadChunks);
    await expect(countWithoutRuntime()).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
    await expect(
      fixture.db.transaction(async (tx) => {
        await lockFullFileMaintenance(tx);
        return countVerifiedFileGenerationReferences(tx, {
          workspaceId: generateUuidV7(),
          generation: 1,
          files: fixture.runtime.files,
        });
      }),
    ).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
  });
});

it("checks beyond the first 64 objects before accepting a zero-reference generation", async () => {
  await withFixture(async (fixture) => {
    const ids: Uuid[] = [];
    await fixture.db.transaction(async (tx) => {
      for (let index = 0; index < 65; index++) {
        const contentId = `018f2b7c-0000-7000-8000-${index.toString(16).padStart(12, "0")}` as Uuid;
        const bytes = Buffer.from(`small pagination fixture ${index}`);
        await fixture.runtime.files.ingest(tx, source(bytes), {
          contentId,
          maxBytes: bytes.length,
        });
        ids.push(contentId);
      }
    });
    expect(await verify(fixture)).toBe(65);
    expect(await verify(fixture, 2)).toBe(0);
    const lastId = ids.at(-1);
    if (lastId === undefined) throw new Error("Missing last page fixture");
    await fixture.db
      .delete(schema.protectedBlobChunks)
      .where(eq(schema.protectedBlobChunks.contentId, lastId));
    await expect(verify(fixture, 2)).rejects.toBeInstanceOf(ProtectedFileUnavailableError);
  });
});
