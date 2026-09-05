import { createHash } from "node:crypto";
import { createUpload, getUpload, schema } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";
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
