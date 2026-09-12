import { createUpload, schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { FileStorageMigration } from "../src/security/file-storage-migration.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";
import { createProtectedFileHarness } from "./helpers/protected-files.ts";

it.each([false, true])(
  "migrates retained historical file bytes with a live shared reference=%s and restores them through HTTP",
  async (shared) => {
    const harness = await createProtectedFileHarness();
    try {
      const { db, protectedFiles: files, workspaceId } = harness.built.context;
      if (files === undefined) throw new Error("Missing protected files");
      const originalBytes = Buffer.from("original retained private bytes");
      const filename = "historical-private-filename.txt";
      const upload = async () => {
        const start = await harness.owner({
          method: "POST",
          url: "/v1/uploads",
          headers: {
            "upload-length": String(originalBytes.length),
            "upload-metadata": `filename ${Buffer.from(filename).toString("base64")}`,
          },
        });
        expect(start.statusCode, start.body).toBe(201);
        const end = await harness.owner({
          method: "PATCH",
          url: String(start.headers.location),
          payload: originalBytes,
          headers: {
            "upload-offset": "0",
            "content-type": "application/offset+octet-stream",
          },
        });
        expect(end.statusCode, end.body).toBe(201);
        return start.json().id as string;
      };
      const id = await upload();
      const duplicate = shared ? await upload() : null;
      const original = (await harness.owner({ method: "GET", url: `/v1/items/${id}` })).json();
      const originalRevisionId = original.currentRevisionId as string;
      const [logical] = await db
        .select()
        .from(schema.logicalFiles)
        .where(eq(schema.logicalFiles.itemId, id));
      if (logical === undefined) throw new Error("Missing original logical file");
      const contentId = logical.contentId;
      const historicalSnapshot = await files.deps.content.readRevisionSnapshot(
        db,
        originalRevisionId,
      );
      expect(historicalSnapshot).not.toBeNull();
      const boundary = `history-${generateUuidV7()}`;
      const replacement = "current replacement remains independent";
      const changed = await harness.owner({
        method: "PUT",
        url: `/v1/files/${id}/content`,
        headers: {
          "idempotency-key": generateUuidV7(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.from(
          [
            `--${boundary}\r\nContent-Disposition: form-data; name="baseRevisionId"\r\n\r\n${originalRevisionId}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="replacement.txt"\r\nContent-Type: text/plain\r\n\r\n`,
            replacement,
            `\r\n--${boundary}--\r\n`,
          ].join(""),
        ),
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const oldChunks = await db
        .select()
        .from(schema.protectedBlobChunks)
        .where(eq(schema.protectedBlobChunks.contentId, contentId));
      const raw = await files.deps.blobs.put(originalBytes);
      // Recreate a mixed historical installation: retained file bytes/snapshot
      // and current metadata are readable; newer file content is already sealed.
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.protectedBlobChunks)
          .where(eq(schema.protectedBlobChunks.contentId, contentId));
        await tx
          .delete(schema.protectedEnvelopes)
          .where(
            and(
              eq(schema.protectedEnvelopes.entityId, contentId),
              eq(schema.protectedEnvelopes.entityType, "file.content-manifest"),
            ),
          );
        await tx
          .update(schema.fileContents)
          .set({ ...raw, storageFormat: "legacy-v1", manifestVersion: 0, lookupTag: null })
          .where(eq(schema.fileContents.id, contentId));
        await tx
          .update(schema.revisions)
          .set({ snapshot: historicalSnapshot })
          .where(eq(schema.revisions.id, originalRevisionId));
        await tx
          .delete(schema.protectedEnvelopes)
          .where(
            and(
              eq(schema.protectedEnvelopes.entityId, originalRevisionId),
              eq(schema.protectedEnvelopes.entityType, "revision.snapshot"),
            ),
          );
        await tx
          .update(schema.logicalFiles)
          .set({ originalName: filename, mediaType: "text/plain" })
          .where(eq(schema.logicalFiles.itemId, id));
        await tx
          .delete(schema.protectedEnvelopes)
          .where(
            and(
              eq(schema.protectedEnvelopes.entityId, id),
              eq(schema.protectedEnvelopes.entityType, "file.metadata"),
            ),
          );
        // A never-started historical upload has no filesystem directory/file.
        await createUpload(tx, {
          workspaceId,
          declaredLength: 100,
          originalName: filename,
          mediaType: "text/plain",
          now: new Date(),
        });
      });
      for (const chunk of oldChunks) await files.deps.blobs.delete(chunk.storageKey);
      const before = (
        await db.select().from(schema.fileContents).where(eq(schema.fileContents.id, contentId))
      )[0];
      expect(
        (
          await db
            .select()
            .from(schema.logicalFiles)
            .where(eq(schema.logicalFiles.contentId, contentId))
        ).length,
      ).toBe(shared ? 1 : 0);
      const records = new ProtectedRecordService({
        db,
        keys: files.deps.keys,
        workspaceId,
        installationId: files.deps.installationId,
        now: () => new Date(),
      });
      const migration = new FileStorageMigration({
        db,
        files,
        records,
        blobRoot: harness.blobRoot,
        // Actual verified archive refusal is exercised by guarded-migration tests.
        verifySourceBackup: async () => undefined,
      });
      expect((await migration.run(generateUuidV7())).phase).toBe("complete");
      expect(await files.deps.blobs.get(raw.storageKey)).toBeNull();
      const after = (
        await db.select().from(schema.fileContents).where(eq(schema.fileContents.id, contentId))
      )[0];
      expect(after).toMatchObject({
        id: contentId,
        storageFormat: "encrypted-chunks-v1",
        referenceCount: before?.referenceCount,
        byteLength: originalBytes.length,
      });
      const history = await harness.owner({
        method: "GET",
        url: `/v1/revisions/${originalRevisionId}`,
      });
      expect(history.statusCode, history.body).toBe(200);
      expect(history.json().snapshot.file).toMatchObject({ contentId, originalName: filename });
      expect((await harness.owner({ method: "GET", url: `/v1/files/${id}/content` })).body).toBe(
        replacement,
      );
      if (duplicate !== null)
        expect(
          (await harness.owner({ method: "GET", url: `/v1/files/${duplicate}/content` }))
            .rawPayload,
        ).toEqual(originalBytes);
      const current = (await harness.owner({ method: "GET", url: `/v1/items/${id}` })).json();
      const restored = await harness.owner({
        method: "POST",
        url: `/v1/revisions/${originalRevisionId}/restore`,
        headers: { "idempotency-key": generateUuidV7() },
        payload: { currentRevisionId: current.currentRevisionId },
      });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(
        (await harness.owner({ method: "GET", url: `/v1/files/${id}/content` })).rawPayload,
      ).toEqual(originalBytes);
      expect(JSON.stringify(await db.select().from(schema.logicalFiles))).not.toContain(filename);
      expect(JSON.stringify(await db.select().from(schema.revisions))).not.toContain(filename);
    } finally {
      await harness.close();
    }
  },
);
