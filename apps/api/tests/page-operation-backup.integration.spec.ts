/** Backup/restore of the causal page state with an absent replica (T126/T147, US5). */

import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBackupCommand } from "../src/admin/commands/backup-commands.ts";
import { restoreTestCommand } from "../src/admin/commands/restore-test.ts";
import { decodeBackupArchive } from "../src/backup/archive-format.ts";
import { BackupService } from "../src/backup/backup-service.ts";
import {
  clearWorkspaceForRestore,
  createDatabaseRestoreTarget,
} from "../src/backup/database-restore-target.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { readPageOperationArchive } from "../src/backup/page-operation-archive.ts";
import { applyArchive } from "../src/backup/restore-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;
let destinationRoot: string;

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
  destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-operation-backup-"));
}, 180_000);

afterAll(async () => {
  await harness?.close();
  if (destinationRoot !== undefined) await rm(destinationRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await harness.reset();
  await rm(destinationRoot, { recursive: true, force: true });
  destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-operation-backup-"));
});

async function activate(
  page: { readonly itemId: Uuid; readonly revisionId: Uuid; readonly canonicalDigest: string },
  headers: Record<string, string>,
) {
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${page.itemId}/activate`,
    headers,
    payload: {
      requestId: generateUuidV7(),
      expectedRevisionId: page.revisionId,
      expectedCanonicalDigest: page.canonicalDigest,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    checkpointBytes: string;
    checkpointDigest: string;
    versionVector: string;
  };
}

async function replica(pageId: Uuid, checkpoint: Awaited<ReturnType<typeof activate>>) {
  return await OperationalPageDocument.fromSnapshotTransport({
    pageId,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
}

async function transportUpdate(
  transaction: ReturnType<OperationalPageDocument["transact"]>,
  updateId = generateUuidV7(),
) {
  return {
    updateId,
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: "2026-08-23T10:00:00.000Z",
  };
}

async function sync(input: {
  readonly pageId: Uuid;
  readonly headers: Record<string, string>;
  readonly replica: OperationalPageDocument;
  readonly update?: Awaited<ReturnType<typeof transportUpdate>>;
  readonly revisionBoundary?: "editor-closed";
}) {
  return await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${input.pageId}/sync`,
    headers: input.headers,
    payload: {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector: Buffer.from(input.replica.versionVectorBytes()).toString("base64url"),
      knownServerPageSequence: 0,
      updates: input.update === undefined ? [] : [input.update],
      maxRemoteBytes: 1024 * 1024,
      ...(input.revisionBoundary === undefined ? {} : { revisionBoundary: input.revisionBoundary }),
    },
  });
}

function checkpoints() {
  const service = harness.api.built.pageCheckpoints;
  if (service === undefined) throw new Error("page checkpoint service is unavailable");
  return service;
}

function backupRuntime(destination: FilesystemDestination) {
  return new BackupService({
    context: harness.api.built.context,
    destination,
    applicationVersion: "0.1.0-operation-test",
    seal: async (plaintextPath, sealedPath) => await copyFile(plaintextPath, sealedPath),
  });
}

async function produceBackup(destination: FilesystemDestination) {
  const result = await runBackupCommand({
    db: harness.api.built.context.db,
    workspaceId: harness.api.built.context.workspaceId,
    service: backupRuntime(destination),
    destination,
  });
  expect(result.code, result.message).toBe(0);
  const backupId = String(result.data?.["backupId"] ?? "");
  const stored = (await destination.list()).find(({ name }) => name.includes(backupId.slice(0, 8)));
  if (backupId === "" || stored === undefined) {
    throw new Error("the operational backup was not stored");
  }
  return {
    backupId,
    archive: await readFile(path.join(destinationRoot, stored.name)),
  };
}

async function rehearseBackup(destination: FilesystemDestination, backupId: string) {
  const result = await restoreTestCommand(
    {
      db: harness.api.built.context.db,
      databaseUrl: harness.api.postgres.connectionString,
      workspaceId: harness.api.built.context.workspaceId,
      destination,
      open: async (ciphertext) => ciphertext,
      installation: {
        schemaVersion: harness.api.built.context.schemaVersion,
        recordFormatVersion: 1,
      },
    },
    { id: backupId },
  );
  expect(result.code, result.message).toBe(0);
}

async function restoreBackup(archive: Buffer) {
  const pageOperationCrypto = harness.api.built.pageOperationCrypto;
  if (pageOperationCrypto === undefined) {
    throw new Error("page operation crypto is unavailable");
  }
  await harness.api.built.database.db.transaction(async (tx) => {
    await applyArchive(
      archive,
      createDatabaseRestoreTarget({
        tx,
        workspaceId: harness.api.built.context.workspaceId,
        contentStore: harness.api.built.context.contentStore,
        prepare: async () =>
          await clearWorkspaceForRestore(tx, harness.api.built.context.workspaceId),
        ...(harness.api.built.context.protectedContent === undefined
          ? {}
          : { protectedContent: harness.api.built.context.protectedContent }),
        pageOperationCrypto,
      }),
    );
  });
}

describe("operational backup and restore", () => {
  it("preserves a separately authorized absent device and merges its older offline branch", async () => {
    const headers = await harness.authenticate();
    const absentDeviceId = generateUuidV7();
    const absentHeaders = await harness.authenticateAsDevice({
      deviceId: absentDeviceId,
      name: "Offline tablet",
    });
    const page = await harness.createLegacyPage("Backup convergence");
    const checkpoint = await activate(page, headers);
    const online = await replica(page.itemId, checkpoint);
    const absent = await replica(page.itemId, checkpoint);

    const absentFrontier = await sync({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
    });
    expect(absentFrontier.statusCode, absentFrontier.body).toBe(200);

    const onlineBlockId = generateUuidV7();
    const onlineTransaction = online.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: onlineBlockId,
          content: [{ text: "present in backup" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const onlineUpdate = await transportUpdate(onlineTransaction);
    const accepted = await sync({
      pageId: page.itemId,
      headers,
      replica: online,
      update: onlineUpdate,
      revisionBoundary: "editor-closed",
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const absentBlockId = generateUuidV7();
    const absentTransaction = absent.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: absentBlockId,
          content: [{ text: "written while absent" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const absentUpdateId = generateUuidV7();
    const absentUpdate = await transportUpdate(absentTransaction, absentUpdateId);

    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);

    const destination = new FilesystemDestination(destinationRoot);
    const { backupId, archive } = await produceBackup(destination);
    const decoded = decodeBackupArchive(archive);
    expect(typeof decoded.operationalState).toBe("string");
    expect(decoded.manifest).toMatchObject({
      operationalPageCount: 1,
      operationalCheckpointCount: 2,
      operationalUpdateCount: 1,
    });

    const coverage = await harness.api.built.database.db.execute(sql`
      SELECT verified_backup_id
        FROM page_operation_checkpoints
       WHERE id = ${candidate.id}::uuid
    `);
    expect(
      (coverage as unknown as { rows: Array<{ verified_backup_id: string | null }> }).rows[0]
        ?.verified_backup_id,
    ).toBe(backupId);
    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "device-frontier-behind",
      deviceIds: [absentDeviceId],
    });

    await rehearseBackup(destination, backupId);

    const later = online.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "must disappear after restore" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    expect(
      (
        await sync({
          pageId: page.itemId,
          headers,
          replica: online,
          update: await transportUpdate(later),
        })
      ).statusCode,
    ).toBe(200);

    await restoreBackup(archive);

    const returned = await sync({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
      update: absentUpdate,
    });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().accepted).toContainEqual(
      expect.objectContaining({ updateId: absentUpdateId }),
    );

    const repeated = await sync({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
      update: absentUpdate,
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().repeated).toContainEqual(
      expect.objectContaining({ updateId: absentUpdateId }),
    );

    const item = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(item.statusCode, item.body).toBe(200);
    const blocks = item.json().pageDocument.body.blocks as Array<{
      id: Uuid;
      content?: Array<{ text: string }>;
    }>;
    expect(new Set(blocks.map(({ id }) => id))).toEqual(new Set([onlineBlockId, absentBlockId]));
    expect(JSON.stringify(blocks)).not.toContain("must disappear after restore");
  });

  it("backs up and restores a promoted checkpoint with compacted receipt-only updates", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Compacted backup");
    const checkpoint = await activate(page, headers);
    const author = await replica(page.itemId, checkpoint);
    const retainedBlockId = generateUuidV7();
    const retained = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: retainedBlockId,
          content: [{ text: "survives compaction" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const accepted = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      update: await transportUpdate(retained),
      revisionBoundary: "editor-closed",
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    const destination = new FilesystemDestination(destinationRoot);
    await produceBackup(destination);
    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toMatchObject({
      kind: "compacted",
      checkpointId: candidate.id,
      throughPageSequence: 1,
    });

    const compactedBackup = await produceBackup(destination);
    const decoded = decodeBackupArchive(compactedBackup.archive);
    expect(decoded.manifest).toMatchObject({
      operationalPageCount: 1,
      operationalCheckpointCount: 1,
      operationalUpdateCount: 1,
    });
    if (decoded.operationalState === null) {
      throw new Error("the compacted operational state is missing");
    }
    const operational = readPageOperationArchive(JSON.parse(decoded.operationalState));
    expect(operational.pages[0]?.updates[0]).toMatchObject({
      baseFrontier: null,
      updateBytes: null,
    });
    expect(operational.pages[0]?.updates[0]?.compactedAt).not.toBeNull();
    const tampered = JSON.parse(decoded.operationalState) as {
      pages: Array<{ canonicalDigest: string }>;
    };
    if (tampered.pages[0] === undefined) throw new Error("the archived page is missing");
    tampered.pages[0].canonicalDigest = "0".repeat(64);
    const archiveService = harness.api.built.pageOperationArchive;
    if (archiveService === undefined) throw new Error("page operation archive is unavailable");
    await expect(
      archiveService.verify(
        readPageOperationArchive(tampered),
        JSON.parse(decoded.canonicalExport),
      ),
    ).rejects.toThrow("does not reproduce its archived head");
    await rehearseBackup(destination, compactedBackup.backupId);

    const later = author.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "must disappear after compacted restore" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const advanced = await sync({
      pageId: page.itemId,
      headers,
      replica: author,
      update: await transportUpdate(later),
    });
    expect(advanced.statusCode, advanced.body).toBe(200);

    await restoreBackup(compactedBackup.archive);
    const item = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers,
    });
    expect(item.statusCode, item.body).toBe(200);
    expect(JSON.stringify(item.json().pageDocument.body.blocks)).toContain("survives compaction");
    expect(JSON.stringify(item.json().pageDocument.body.blocks)).not.toContain(
      "must disappear after compacted restore",
    );
  });
});
