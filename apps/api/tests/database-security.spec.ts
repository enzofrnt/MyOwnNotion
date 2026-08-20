/**
 * One recognizable structured payload across every server-side boundary (T104).
 *
 * The positive export assertion is as important as the negative storage ones:
 * an owner-authorized export must preserve the data, while PostgreSQL, logs,
 * technical errors and the object handed to a backup destination must not
 * expose it in plaintext.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import type { DatabaseDefinition, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sealBackupArchiveFile } from "../src/backup/archive-crypto.ts";
import { BackupService } from "../src/backup/backup-service.ts";
import type { BackupDestination, StoredBackup } from "../src/backup/destinations/destination.ts";
import { createApplicationLogger } from "../src/plugins/logging.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";

const SENTINELS = {
  database: "PRIVATE_DATABASE_TITLE_SENTINEL_907431",
  property: "PRIVATE_PROPERTY_LABEL_SENTINEL_907432",
  view: "PRIVATE_VIEW_FILTER_SENTINEL_907433",
  task: "PRIVATE_TASK_TITLE_SENTINEL_907434",
  status: "PRIVATE_TASK_STATUS_SENTINEL_907435",
  value: "PRIVATE_ENTRY_VALUE_SENTINEL_907436",
  error: "PRIVATE_INVALID_VALUE_SENTINEL_907437",
} as const;

let harness: ApiHarness;
let keyDirectory: string;
let databaseId: Uuid;
let textPropertyId: Uuid;
let entryId: Uuid;

function allSentinels(): string[] {
  return Object.values(SENTINELS);
}

function expectNoSentinel(text: string): void {
  for (const sentinel of allSentinels()) expect(text).not.toContain(sentinel);
}

async function exportArtifact(): Promise<Record<string, unknown>> {
  const started = await harness.built.app.inject({ method: "POST", url: "/v1/export" });
  expect(started.statusCode, started.body).toBe(202);
  const exportId = (started.json() as { exportId: string }).exportId;
  let status = "pending";
  for (let attempt = 0; attempt < 50 && status === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${exportId}`,
    });
    status = (response.json() as { status: string }).status;
  }
  expect(status).toBe("ready");
  const artifact = await harness.built.app.inject({
    method: "GET",
    url: `/v1/export/${exportId}/artifact`,
  });
  expect(artifact.statusCode, artifact.body).toBe(200);
  return artifact.json() as Record<string, unknown>;
}

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-database-security-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });

  databaseId = generateUuidV7();
  textPropertyId = generateUuidV7();
  const titlePropertyId = generateUuidV7();
  const statusPropertyId = generateUuidV7();
  const statusOptionId = generateUuidV7();
  const relationPropertyId = generateUuidV7();
  const initialViewId = generateUuidV7();
  const created = await harness.built.app.inject({
    method: "POST",
    url: "/v1/databases",
    headers: idempotencyHeaders(),
    payload: {
      id: databaseId,
      name: SENTINELS.database,
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
      titlePropertyId,
      initialViewId,
      initialViewName: "Initial table",
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const current = created.json() as {
    database: { definitionRevisionId: string; definition: DatabaseDefinition };
  };
  const definition: DatabaseDefinition = {
    ...current.database.definition,
    properties: [
      ...current.database.definition.properties,
      {
        id: textPropertyId,
        name: SENTINELS.property,
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: statusPropertyId,
        name: "Status",
        type: "status",
        positionKey: "c",
        state: "active",
        config: {
          options: [
            {
              id: statusOptionId,
              label: SENTINELS.status,
              positionKey: "a",
              tone: "neutral",
              state: "active",
            },
          ],
        },
      },
      {
        id: relationPropertyId,
        name: "Private relation",
        type: "relation",
        positionKey: "d",
        state: "active",
        config: { cardinality: "many" },
      },
    ],
    views: current.database.definition.views.map((view) => ({
      ...view,
      name: SENTINELS.view,
      properties: [
        ...view.properties,
        { propertyId: textPropertyId, visible: true, positionKey: "b" },
        { propertyId: statusPropertyId, visible: true, positionKey: "c" },
        { propertyId: relationPropertyId, visible: true, positionKey: "d" },
      ],
      filter: {
        mode: "all",
        criteria: [
          {
            id: generateUuidV7(),
            propertyId: textPropertyId,
            operator: "contains",
            operand: { kind: "text", value: SENTINELS.view },
          },
        ],
      },
    })),
    taskRoles: {
      statusPropertyId,
      dueDatePropertyId: null,
      priorityPropertyId: null,
    },
  };
  const replaced = await harness.built.app.inject({
    method: "PUT",
    url: `/v1/databases/${databaseId}/definition`,
    headers: idempotencyHeaders(),
    payload: { baseRevisionId: current.database.definitionRevisionId, definition },
  });
  expect(replaced.statusCode, replaced.body).toBe(200);

  const target = await createItemViaApi(harness, { kind: "page", name: "Relation target" });
  entryId = generateUuidV7();
  const entry = await harness.built.app.inject({
    method: "POST",
    url: `/v1/databases/${databaseId}/entries`,
    headers: idempotencyHeaders(),
    payload: {
      id: entryId,
      title: SENTINELS.task,
      placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "a" },
      values: {
        [textPropertyId]: { kind: "text", value: SENTINELS.value },
        [statusPropertyId]: { kind: "status", optionId: statusOptionId },
      },
      relationTargets: { [relationPropertyId]: [target.itemId] },
    },
  });
  expect(entry.statusCode, entry.body).toBe(201);
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

describe("structured security sentinels", () => {
  it("keeps private content out of the new structured PostgreSQL surfaces while preserving the owner export", async () => {
    const exported = await exportArtifact();
    // Item titles and retained revision snapshots belong to feature 002's
    // bounded plaintext-migration protocol. This feature audits every storage
    // surface it adds plus the export job it extends; querying inherited source
    // columns here would test the pre-scrub migration state rather than the 009
    // boundary. The protected revision envelope is still required below.
    const raw = await harness.built.database.db.execute(sql`
      SELECT jsonb_build_object(
        'databases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM databases t),
        'entries', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM database_entries t),
        'relationships', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM relationships t),
        'exports', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM exports t),
        'envelopes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM protected_envelopes t)
      ) AS state
    `);
    expectNoSentinel(JSON.stringify(raw.rows));

    const envelopeTypes = await harness.built.database.db.execute<{
      entity_type: string;
    }>(sql`SELECT entity_type FROM protected_envelopes`);
    expect(envelopeTypes.rows.map((row) => row.entity_type)).toEqual(
      expect.arrayContaining([
        "item.name",
        "database.definition",
        "database.entry-values",
        "export.manifest",
        "relationship.metadata",
        "revision.snapshot",
      ]),
    );

    const exportText = JSON.stringify(exported);
    for (const sentinel of allSentinels().filter((value) => value !== SENTINELS.error)) {
      expect(exportText).toContain(sentinel);
    }
    expect(
      (exported["databases"] as Array<{ databaseId: string }>).some(
        (row) => row.databaseId === databaseId,
      ),
    ).toBe(true);
    expect(
      (exported["databaseEntries"] as Array<{ entryId: string }>).some(
        (row) => row.entryId === entryId,
      ),
    ).toBe(true);
  });

  it("redacts structured logs and validation errors", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = createApplicationLogger({
      env: { MYOWNNOTION_LOG_COLOR: "never", NODE_ENV: "production" },
      isTTY: false,
      destination,
    });
    logger.error(
      {
        databaseId,
        definition: {
          properties: [{ name: SENTINELS.property }],
          views: [{ name: SENTINELS.view, filter: { value: SENTINELS.value } }],
          taskRoles: { label: SENTINELS.status },
        },
        values: { [textPropertyId]: { value: SENTINELS.value } },
        err: new Error(`projection refused ${SENTINELS.error}`),
      },
      "structured projection refused",
    );
    expectNoSentinel(chunks.join(""));

    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: SENTINELS.error,
        title: SENTINELS.error,
        placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "z" },
        values: { [textPropertyId]: { kind: "text", value: SENTINELS.error } },
        relationTargets: {},
      },
    });
    expect(response.statusCode).toBe(400);
    expectNoSentinel(response.body);
  });

  it("hands only ciphertext and a content-free name to the backup destination", async () => {
    let storedName = "";
    let storedBytes = Buffer.alloc(0);
    let storedAt = new Date(0);
    const destination: BackupDestination = {
      name: "memory-security-audit",
      put: async (name, contents) => {
        const chunks: Buffer[] = [];
        for await (const chunk of contents) chunks.push(Buffer.from(chunk as Uint8Array));
        storedName = name;
        storedBytes = Buffer.concat(chunks);
        storedAt = new Date();
      },
      list: async (): Promise<StoredBackup[]> => [
        { name: storedName, byteLength: storedBytes.byteLength, storedAt },
      ],
      read: async (name) => (name === storedName ? Readable.from(storedBytes) : null),
      delete: async () => undefined,
    };
    const backupKey = randomBytes(32);
    const outcome = await new BackupService({
      context: harness.built.context,
      destination,
      applicationVersion: "0.1.0-security-test",
      seal: async (plaintextPath, sealedPath) =>
        await sealBackupArchiveFile(backupKey, plaintextPath, sealedPath),
    }).run("manual");

    expect(outcome.verifiedAfterCreation).toBe(true);
    expect(outcome.verifiedAfterTransfer).toBe(true);
    expectNoSentinel(storedName);
    expectNoSentinel(storedBytes.toString("utf8"));
  });
});
