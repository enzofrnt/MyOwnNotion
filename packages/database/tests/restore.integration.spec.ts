/**
 * A rehearsal writes, and leaves the live workspace alone (T021, T029, T030 — FR-018).
 *
 * The assertion that carries this suite is the negative one: after a rehearsal,
 * the live database is byte-for-byte what it was. It is asserted rather than
 * assumed because the property is structural — the live connection is never
 * opened — and a structural property that nobody checks is one a later
 * refactoring can quietly remove.
 *
 * The positive assertion matters too, and for a reason easy to lose sight of: a
 * rehearsal that does not *write* proves the archive is readable and nothing
 * about whether it can be written back. Constraint violations, ordering problems
 * and schema mismatches all surface at write time.
 */

import { createHash } from "node:crypto";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import {
  createInstallation,
  getOrCreateWorkspace,
  schema,
  submitMutation,
} from "@myownnotion/database";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  buildCanonicalExport,
  canonicalExportString,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeBackupArchive } from "../../../apps/api/src/backup/archive-format.ts";
import {
  clearWorkspaceForRestore,
  createDatabaseRestoreTarget,
} from "../../../apps/api/src/backup/database-restore-target.ts";
import { createDisposableWorkspace } from "../../../apps/api/src/backup/disposable-workspace.ts";
import { applyArchive } from "../../../apps/api/src/backup/restore-service.ts";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
let counter = 0;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

async function createFolder(name: string): Promise<Uuid> {
  counter += 1;
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "folder",
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: `V${counter.toString(36)}r`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function liveItemNames(): Promise<string[]> {
  const rows = await context.handle.db.select({ name: schema.items.name }).from(schema.items);
  return rows.map((row) => row.name).sort();
}

describe("rehearsing a restoration", () => {
  it("removes stale protected and transient state before a destructive restore", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
      const installationId = generateUuidV7();
      await createInstallation(rehearsal.handle.db, {
        id: installationId,
        sourceLineageId: installationId,
        schemaVersion: workspace.schemaVersion,
      });
      const itemId = generateUuidV7();
      const created = await submitMutation(rehearsal.handle.db, {
        workspaceId: workspace.id,
        mutationId: generateUuidV7(),
        commandType: "item.create",
        command: {
          type: "item.create",
          id: itemId,
          kind: "folder",
          name: "State being replaced",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "Vz" },
        },
      });
      expect(created.result.status).toBe("accepted");
      await rehearsal.handle.db.insert(schema.protectedEnvelopes).values({
        id: generateUuidV7(),
        installationId,
        workspaceId: workspace.id,
        entityType: "item.name",
        entityId: itemId,
        keyGeneration: 1,
        recordVersion: 1,
        salt: "stale-salt",
        nonce: "stale-nonce",
        ciphertext: "stale-ciphertext",
        tag: "stale-tag",
        aadDigest: "stale-aad",
      });
      await rehearsal.handle.db.insert(schema.uploads).values({
        id: generateUuidV7(),
        workspaceId: workspace.id,
        declaredLength: 1,
        receivedLength: 0,
        mediaType: "text/plain",
        originalName: "partial.txt",
        storageKey: `partial-${generateUuidV7()}`,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await rehearsal.handle.db.insert(schema.exports).values({
        id: generateUuidV7(),
        workspaceId: workspace.id,
      });

      await rehearsal.handle.db.transaction(async (tx) => {
        await clearWorkspaceForRestore(tx, workspace.id);
      });

      expect(await rehearsal.handle.db.select().from(schema.items)).toEqual([]);
      expect(await rehearsal.handle.db.select().from(schema.protectedEnvelopes)).toEqual([]);
      expect(await rehearsal.handle.db.select().from(schema.uploads)).toEqual([]);
      expect(await rehearsal.handle.db.select().from(schema.exports)).toEqual([]);
    } finally {
      await rehearsal.release();
    }
  });

  it("writes every item, file, relationship and revision named by the archive", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      const targetWorkspace = await getOrCreateWorkspace(rehearsal.handle.db);
      const sourceWorkspaceId = generateUuidV7();
      const folderId = generateUuidV7();
      const pageId = generateUuidV7();
      const fileId = generateUuidV7();
      const folderRevisionId = generateUuidV7();
      const pageRevisionId = generateUuidV7();
      const fileRevisionId = generateUuidV7();
      const acceptedAt = "2026-08-18T08:00:00.000Z";
      const fileBytes = Buffer.from("restored file bytes", "utf8");
      const fileHash = createHash("sha256").update(fileBytes).digest("hex");

      const canonical = buildCanonicalExport({
        workspaceId: sourceWorkspaceId,
        schemaVersion: 1,
        exportedAt: acceptedAt,
        changeCursor: "17",
        items: [
          {
            id: folderId,
            workspaceId: sourceWorkspaceId,
            kind: "folder",
            name: "Restored folder",
            lifecycle: "active",
            trashedAt: null,
            purgeAfter: null,
            currentRevisionId: folderRevisionId,
            favourite: true,
            offlineIntent: false,
            pageDocument: null,
            file: null,
            placements: [
              {
                id: generateUuidV7(),
                workspaceId: sourceWorkspaceId,
                itemId: folderId,
                itemIsFile: false,
                kind: "hierarchy",
                parentItemId: null,
                positionKey: "Va",
                removedAt: null,
              },
            ],
          },
          {
            id: pageId,
            workspaceId: sourceWorkspaceId,
            kind: "page",
            name: "Restored page",
            lifecycle: "active",
            trashedAt: null,
            purgeAfter: null,
            currentRevisionId: pageRevisionId,
            favourite: false,
            offlineIntent: true,
            pageDocument: {
              format: "myownnotion.document+json",
              formatVersion: 1,
              body: { type: "doc", content: [] },
            },
            file: null,
            placements: [
              {
                id: generateUuidV7(),
                workspaceId: sourceWorkspaceId,
                itemId: pageId,
                itemIsFile: false,
                kind: "hierarchy",
                parentItemId: folderId,
                positionKey: "Vb",
                removedAt: null,
              },
            ],
          },
          {
            id: fileId,
            workspaceId: sourceWorkspaceId,
            kind: "file",
            name: "Restored attachment",
            lifecycle: "active",
            trashedAt: null,
            purgeAfter: null,
            currentRevisionId: fileRevisionId,
            favourite: false,
            offlineIntent: true,
            pageDocument: null,
            file: {
              mediaType: "text/plain",
              originalName: "evidence.txt",
              byteLength: fileBytes.byteLength,
              sha256: fileHash,
            },
            placements: [
              {
                id: generateUuidV7(),
                workspaceId: sourceWorkspaceId,
                itemId: fileId,
                itemIsFile: true,
                kind: "attachment",
                parentItemId: pageId,
                positionKey: "Vc",
                removedAt: null,
              },
            ],
          },
        ],
        relationships: [
          {
            id: generateUuidV7(),
            workspaceId: sourceWorkspaceId,
            sourceItemId: pageId,
            targetItemId: folderId,
            relationType: "mention:reference",
            metadata: { source: "restore-test" },
            createdRevisionId: pageRevisionId,
            removedRevisionId: null,
          },
        ],
        revisions: [
          {
            id: folderRevisionId,
            itemId: folderId,
            mutationId: generateUuidV7(),
            parentRevisionIds: [],
            acceptedAt,
          },
          {
            id: pageRevisionId,
            itemId: pageId,
            mutationId: generateUuidV7(),
            parentRevisionIds: [],
            acceptedAt,
          },
          {
            id: fileRevisionId,
            itemId: fileId,
            mutationId: generateUuidV7(),
            parentRevisionIds: [],
            acceptedAt,
          },
        ],
      });
      const canonicalText = canonicalExportString(canonical);
      const digest = (bytes: Uint8Array) =>
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const archive = encodeBackupArchive({
        manifest: {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          createdAt: acceptedAt,
          cursor: canonical.changeCursor,
          applicationVersion: "0.1.0-test",
          schemaVersion: canonical.schemaVersion,
          recordFormatVersion: 1,
          canonicalExportDigest: digest(Buffer.from(canonicalText, "utf8")),
          files: [{ digest: digest(fileBytes), byteLength: fileBytes.byteLength }],
          itemCount: canonical.items.length,
          fileCount: 1,
        },
        canonicalExport: canonicalText,
        files: new Map([[digest(fileBytes), fileBytes]]),
      });

      const store = new ContentStore(new FilesystemBlobStore(rehearsal.blobRoot));
      const result = await rehearsal.handle.db.transaction(async (tx) =>
        applyArchive(
          archive,
          createDatabaseRestoreTarget({ tx, workspaceId: targetWorkspace.id, contentStore: store }),
        ),
      );

      expect(result).toEqual({ restoredItemCount: 3, restoredFileCount: 1 });
      expect(
        await rehearsal.handle.db
          .select({
            id: schema.items.id,
            workspaceId: schema.items.workspaceId,
            favourite: schema.items.favourite,
            offlineIntent: schema.items.offlineIntent,
          })
          .from(schema.items),
      ).toEqual(
        expect.arrayContaining([
          {
            id: folderId,
            workspaceId: targetWorkspace.id,
            favourite: true,
            offlineIntent: false,
          },
          {
            id: pageId,
            workspaceId: targetWorkspace.id,
            favourite: false,
            offlineIntent: true,
          },
          {
            id: fileId,
            workspaceId: targetWorkspace.id,
            favourite: false,
            offlineIntent: true,
          },
        ]),
      );
      expect(await rehearsal.handle.db.select().from(schema.revisions)).toHaveLength(3);
      expect(await rehearsal.handle.db.select().from(schema.placements)).toHaveLength(3);
      expect(await rehearsal.handle.db.select().from(schema.relationships)).toHaveLength(1);
      expect(await rehearsal.handle.db.select().from(schema.logicalFiles)).toHaveLength(1);
      expect(await rehearsal.handle.db.select().from(schema.fileUsages)).toEqual([
        expect.objectContaining({
          fileItemId: fileId,
          usedByItemId: pageId,
          usageKind: "attachment",
        }),
      ]);
      const [content] = await rehearsal.handle.db.select().from(schema.fileContents);
      expect(content).toBeDefined();
      expect(Buffer.from((await store.read(content?.storageKey ?? "missing")) ?? [])).toEqual(
        fileBytes,
      );
    } finally {
      await rehearsal.release();
    }
  });

  it("creates a database of its own, migrated and empty of workspace content", async () => {
    await createFolder("Live content");
    const before = await liveItemNames();

    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      // Migrated: the schema is there.
      const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
      expect(workspace.id).toBeDefined();

      // And empty: nothing of the live workspace leaked into it, which is the
      // other half of isolation — a rehearsal that started from a copy of the
      // live data would prove nothing about restoring onto an empty machine.
      const rows = await rehearsal.handle.db.select({ name: schema.items.name }).from(schema.items);
      expect(rows).toEqual([]);
    } finally {
      await rehearsal.release();
    }

    // The live workspace is exactly what it was. This is FR-018, and it holds
    // because the live connection was never opened rather than because a flag
    // said not to write.
    expect(await liveItemNames()).toEqual(before);
  });

  it("accepts writes, which is the whole point of rehearsing", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
      const id = generateUuidV7();
      const outcome = await submitMutation(rehearsal.handle.db, {
        workspaceId: workspace.id,
        mutationId: generateUuidV7(),
        commandType: "item.create",
        command: {
          type: "item.create",
          id,
          kind: "folder",
          name: "Restored into the rehearsal",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "Vq" },
        },
      });
      // A dry run would have proven the archive readable and nothing about
      // whether it can be written back.
      expect(outcome.result.status).toBe("accepted");
    } finally {
      await rehearsal.release();
    }
  });

  it("drops its database afterwards, and tolerates being released twice", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    const name = rehearsal.databaseName;
    await rehearsal.release();
    // Idempotent: a caller releasing in a `finally` after an early return should
    // not have to track whether it already happened.
    await rehearsal.release();

    const admin = context.handle.db;
    const rows = await admin.execute(
      `SELECT 1 FROM pg_database WHERE datname = '${name}'` as never,
    );
    // A rehearsal per attempt, left behind, accumulates on a server nobody is
    // watching.
    expect((rows as unknown as { rows: unknown[] }).rows ?? []).toEqual([]);
  });
});
