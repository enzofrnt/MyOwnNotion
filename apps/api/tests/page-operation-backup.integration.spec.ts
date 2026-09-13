/** Backup/restore of the causal page state with an absent replica (T126/T147, US5). */

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runBackupCommand } from "../src/admin/commands/backup-commands.ts";
import { restoreTestCommand } from "../src/admin/commands/restore-test.ts";
import { buildApp } from "../src/app.ts";
import { decodeBackupArchive } from "../src/backup/archive-format.ts";
import { BackupService } from "../src/backup/backup-service.ts";
import {
  clearWorkspaceForRestore,
  createDatabaseRestoreTarget,
} from "../src/backup/database-restore-target.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { activateFullRestore, restoreFullBackup } from "../src/backup/full/restore.ts";
import { FullBackupService } from "../src/backup/full/service.ts";
import { readPageOperationArchive } from "../src/backup/page-operation-archive.ts";
import { applyArchive } from "../src/backup/restore-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
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
  createdAt = "2026-08-23T10:00:00.000Z",
) {
  return {
    updateId,
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt,
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
    seal: async (plaintext, sealedPath) =>
      await pipeline(
        Readable.from(plaintext, { objectMode: false }),
        createWriteStream(sealedPath, { flags: "wx", mode: 0o600 }),
      ),
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
  it("preserves a device absent 90 days and merges its newer local branch after restore", async () => {
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
    const absentUpdate = await transportUpdate(
      absentTransaction,
      absentUpdateId,
      "2026-05-27T10:00:00.000Z",
    );

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
    if (decoded.operationalState === null) {
      throw new Error("the operational state is missing from the backup");
    }
    const archivedOperations = readPageOperationArchive(JSON.parse(decoded.operationalState));
    expect(archivedOperations.pages[0]).toMatchObject({
      pageId: page.itemId,
      lastUpdateSequence: 1,
      updates: [expect.objectContaining({ id: onlineUpdate.updateId })],
      deviceFrontiers: expect.arrayContaining([
        expect.objectContaining({ deviceId: absentDeviceId, deviceState: "authorized" }),
      ]),
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

    const restoredState = await harness.api.built.database.db.execute(sql`
      SELECT s.last_update_sequence,
             count(f.device_id)::int AS frontier_count
        FROM page_operation_states s
        LEFT JOIN page_device_frontiers f ON f.page_id = s.page_id
       WHERE s.page_id = ${page.itemId}::uuid
       GROUP BY s.last_update_sequence
    `);
    expect(
      (
        restoredState as unknown as {
          rows: Array<{ last_update_sequence: string; frontier_count: number }>;
        }
      ).rows[0],
    ).toEqual({ last_update_sequence: "1", frontier_count: 2 });

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

    const causallyAhead = JSON.parse(decoded.operationalState) as {
      pages: Array<{
        updates: Array<{
          resultFrontier: { versionVector: string; frontiers: string };
        }>;
      }>;
    };
    const archivedUpdate = causallyAhead.pages[0]?.updates[0];
    if (archivedUpdate === undefined) throw new Error("the archived update is missing");
    archivedUpdate.resultFrontier = {
      versionVector: Buffer.from(later.resultVersionVector).toString("base64url"),
      frontiers: Buffer.from(later.resultFrontiers).toString("base64url"),
    };
    expect(() => readPageOperationArchive(causallyAhead)).toThrow(
      "checkpoint frontier does not match its covered sequence",
    );

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

it("round-trips every SQL table in a full archive and accepts an offline replica after fresh authentication", async () => {
  const headers = await harness.authenticate();
  const absentDeviceId = generateUuidV7();
  const absentBinding = `web-${randomUUID()}`;
  await harness.authenticateAsDevice({
    deviceId: absentDeviceId,
    name: "Absent full-recovery device",
  });
  await harness.api.built.database.db.execute(
    sql`UPDATE authorized_devices SET device_binding_id = ${absentBinding} WHERE id = ${absentDeviceId}::uuid`,
  );
  const page = await harness.createLegacyPage("Full recovery convergence");
  const checkpoint = await activate(page, headers);
  const online = await replica(page.itemId, checkpoint);
  const absent = await replica(page.itemId, checkpoint);
  const onlineTransaction = online.transact([
    {
      type: "insert-block",
      block: {
        type: "paragraph",
        id: generateUuidV7(),
        content: [{ text: "full snapshot entry" }],
      },
      parentBlockId: null,
      beforeBlockId: null,
    },
  ]);
  const accepted = await sync({
    pageId: page.itemId,
    headers,
    replica: online,
    update: await transportUpdate(onlineTransaction),
    revisionBoundary: "editor-closed",
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const key = Buffer.from((await readFile(harness.deploymentKeyFile, "utf8")).trim(), "base64");
  const transferIds: string[] = [];
  for (const length of [4, 8]) {
    const created = await harness.api.built.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: {
        ...headers,
        "upload-length": String(length),
        "upload-metadata": `filename ${Buffer.from("Recovered private attachment.txt").toString("base64")}`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    transferIds.push(id);
    const accepted = await harness.api.built.app.inject({
      method: "PATCH",
      url: `/v1/uploads/${id}`,
      headers: {
        ...headers,
        "upload-offset": "0",
        "content-type": "application/offset+octet-stream",
      },
      payload: Buffer.from("head"),
    });
    expect(accepted.statusCode, accepted.body).toBe(length === 4 ? 201 : 204);
  }
  const full = new FullBackupService({
    connectionString: harness.api.postgres.connectionString,
    blobRoot: harness.api.blobRoot,
    backupRoot: path.join(destinationRoot, "complete"),
    key: () => key,
  });
  const archived = await full.run("manual");
  const target = await startDisposablePostgres();
  const sourceReader = new pg.Client({ connectionString: harness.api.postgres.connectionString });
  const targetReader = new pg.Client({ connectionString: target.connectionString });
  const targetDirectory = path.join(destinationRoot, "complete-restored");
  let restored: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await restoreFullBackup({
      archivePath: archived.path,
      workingDirectory: destinationRoot,
      targetDirectory,
      targetConnectionString: target.connectionString,
      activeConnectionString: harness.api.postgres.connectionString,
      activeDirectory: harness.api.blobRoot,
      key,
    });
    await sourceReader.connect();
    await targetReader.connect();
    const tables = (
      await sourceReader.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )
    ).rows;
    expect(tables.length).toBeGreaterThan(30);
    for (const { tablename } of tables) {
      // Names originate from the system catalogue and still use quoted identifiers.
      const identifier = `"${tablename.replaceAll('"', '""')}"`;
      const query = `SELECT row_to_json(t)::text AS value FROM public.${identifier} t ORDER BY row_to_json(t)::text`;
      expect((await targetReader.query(query)).rows, tablename).toEqual(
        (await sourceReader.query(query)).rows,
      );
    }
    await activateFullRestore({
      targetDirectory,
      targetConnectionString: target.connectionString,
      key,
    });
    restored = await buildApp({
      databaseUrl: target.connectionString,
      blobRoot: targetDirectory,
      logger: false,
      security: loadSecurityConfig({
        MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
        MYOWNNOTION_API_HOST: "127.0.0.1",
        MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: harness.deploymentKeyFile,
      }),
    });
    expect(
      (await restored.app.inject({ method: "GET", url: `/v1/items/${page.itemId}`, headers }))
        .statusCode,
    ).toBe(401);
    const login = await restored.app.inject({
      method: "POST",
      url: "/v1/auth/login/password",
      payload: {
        password: "correct horse battery staple",
        device: {
          deviceBindingId: absentBinding,
          name: "Absent full-recovery device",
          platform: "Test platform",
        },
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0] ?? "";
    const fresh = {
      cookie,
      "x-csrf-token": login.json().csrfToken,
      "x-myownnotion-client-protocol": "3",
    };
    const attachment = await restored.app.inject({
      method: "GET",
      url: `/v1/files/${transferIds[0]}/content`,
      headers: fresh,
    });
    expect(attachment.statusCode, attachment.body).toBe(200);
    expect(attachment.body).toBe("head");
    const partial = await restored.app.inject({
      method: "HEAD",
      url: `/v1/uploads/${transferIds[1]}`,
      headers: fresh,
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.headers["upload-offset"]).toBe("4");
    const completed = await restored.app.inject({
      method: "PATCH",
      url: `/v1/uploads/${transferIds[1]}`,
      headers: {
        ...fresh,
        "upload-offset": "4",
        "content-type": "application/offset+octet-stream",
      },
      payload: Buffer.from("tail"),
    });
    expect(completed.statusCode, completed.body).toBe(201);
    const resumed = await restored.app.inject({
      method: "GET",
      url: `/v1/files/${transferIds[1]}/content`,
      headers: fresh,
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.body).toBe("headtail");
    const offlineTransaction = absent.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "created while the server was recovered" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const returned = await restored.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers: fresh,
      payload: {
        mode: "active",
        requestId: generateUuidV7(),
        operationalVersion: 1,
        persistedVersionVector: Buffer.from(absent.versionVectorBytes()).toString("base64url"),
        knownServerPageSequence: 0,
        updates: [await transportUpdate(offlineTransaction)],
        maxRemoteBytes: 1024 * 1024,
        revisionBoundary: "editor-closed",
      },
    });
    expect(returned.statusCode, returned.body).toBe(200);
    const document = await restored.app.inject({
      method: "GET",
      url: `/v1/items/${page.itemId}`,
      headers: fresh,
    });
    expect(document.statusCode, document.body).toBe(200);
    expect(JSON.stringify(document.json().pageDocument.body)).toContain("full snapshot entry");
    expect(JSON.stringify(document.json().pageDocument.body)).toContain(
      "created while the server was recovered",
    );
    expect(
      (
        await targetReader.query("SELECT state FROM authorized_devices WHERE id = $1", [
          absentDeviceId,
        ])
      ).rows,
    ).toEqual([{ state: "active" }]);
  } finally {
    await restored?.close();
    await sourceReader.end();
    await targetReader.end();
    await target.stop();
    key.fill(0);
  }
});
