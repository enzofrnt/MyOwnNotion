import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { schema } from "@myownnotion/database";
import { type EntryValues, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseQueryService } from "../src/databases/database-query-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";
import { authenticatedContent } from "./helpers/content-owner.ts";

let harness: ApiHarness;
let owner: Awaited<ReturnType<typeof authenticatedContent>>;
let directory: string;
let databaseId: Uuid;
let viewId: Uuid;
const entryIds = Array.from({ length: 24 }, () => generateUuidV7());

beforeAll(async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "mon-projection-load-"));
  const key = path.join(directory, "key");
  writeFileSync(key, randomBytes(32).toString("base64"), { mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: key,
    }),
  });
  owner = await authenticatedContent(harness);
  const host = await createItemViaApi(harness, {
    kind: "page",
    name: "Host",
    headers: owner.headers,
  });
  databaseId = generateUuidV7();
  viewId = generateUuidV7();
  const source = await owner({
    method: "POST",
    url: "/v1/databases",
    headers: idempotencyHeaders(),
    payload: {
      id: databaseId,
      hostPageId: host.itemId,
      name: "Protected source",
      titlePropertyId: generateUuidV7(),
      initialViewId: viewId,
      initialViewName: "Table",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a0" },
    },
  });
  expect(source.statusCode, source.body).toBe(201);
  const seeded = await owner({
    method: "POST",
    url: "/v1/mutations/batch",
    payload: {
      mutations: entryIds.map((id, index) => ({
        mutationId: generateUuidV7(),
        commandType: "database.entry.create",
        baseRevisionIds: [],
        payload: {
          id,
          databaseId,
          title: `Private entry ${index}`,
          placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a0" },
          values: {},
          relationTargets: {},
        },
      })),
    },
  });
  expect(seeded.statusCode, seeded.body).toBe(200);
  expect(
    seeded.json().results.every((result: { status: string }) => result.status === "accepted"),
  ).toBe(true);
}, 180_000);
afterAll(async () => {
  await harness?.close();
  rmSync(directory, { recursive: true, force: true });
});

function dependencies() {
  const { db, workspaceId, protectedContent } = harness.built.context;
  if (protectedContent === undefined) throw new Error("Missing protected test boundary");
  return { db, workspaceId, protectedContent };
}

describe("SQL loading of encrypted database projections", () => {
  it("batches protected fields, skips page bodies, and refreshes only a changed entry", async () => {
    const input = dependencies();
    const names = vi.spyOn(input.protectedContent, "readItemNames");
    const values = vi.spyOn(input.protectedContent, "readDatabaseEntryValuesMany");
    const bodies = vi.spyOn(input.protectedContent, "readPageBodies");
    const service = createDatabaseQueryService(input);
    const started = performance.now();
    await service.rebuild();
    expect(names).toHaveBeenCalledTimes(1);
    expect(new Set(names.mock.calls[0]?.[1])).toEqual(new Set(entryIds));
    expect(values).toHaveBeenCalledTimes(1);
    expect(bodies).not.toHaveBeenCalled();
    const page = service.query(databaseId, { viewId, limit: 1000 });
    expect(page.rows).toHaveLength(24);
    expect(page.rows.every((row) => row.title.startsWith("Private entry"))).toBe(true);
    const coldMs = performance.now() - started;
    const changed = entryIds[0] as Uuid;
    const entry = (
      await owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${changed}` })
    ).json();
    const rename = await owner({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "item.rename",
            baseRevisionIds: [entry.revisionId],
            payload: { itemId: changed, name: "Changed canonical name" },
          },
        ],
      },
    });
    expect(rename.json().results[0].status).toBe("accepted");
    names.mockClear();
    values.mockClear();
    bodies.mockClear();
    const refreshStarted = performance.now();
    await service.applyCommittedChanges([changed], 10_000);
    expect(names.mock.calls.map((call) => call[1])).toEqual([[changed]]);
    expect(values.mock.calls[0]?.[1]).toEqual([
      {
        entryId: changed,
        revisionId: expect.any(String),
        storedName: expect.any(String),
        storedValues: null,
        valueVersion: 1,
      },
    ]);
    expect(bodies).not.toHaveBeenCalled();
    const refreshed = service.query(databaseId, { viewId, limit: 1000 });
    expect(refreshed.rows).toHaveLength(24);
    expect(refreshed.rows.find((row) => row.entryId === changed)?.title).toBe(
      "Changed canonical name",
    );
    console.info(
      JSON.stringify({
        encryptedSqlEntries: 24,
        coldMs,
        oneEntryRefreshMs: performance.now() - refreshStarted,
      }),
    );
    names.mockRestore();
    values.mockRestore();
    bodies.mockRestore();
  });

  it("selects explicit value versions and deterministic latest records despite insertion order", async () => {
    const { db, protectedContent: content } = dependencies();
    const id = generateUuidV7();
    const property = generateUuidV7();
    const value = (decimal: string): EntryValues => ({
      format: "myownnotion.database-entry-values+json",
      formatVersion: 1,
      databaseId,
      entryId: id,
      values: { [property]: { kind: "number", decimal } },
      preserved: [],
    });
    for (const version of [3, 1, 2])
      await content.writeDatabaseEntryValues(db, {
        entryId: id,
        valueVersion: version,
        values: value(String(version)),
      });
    expect(
      await content.readDatabaseEntryValuesMany(db, [{ entryId: id, valueVersion: 1 }]),
    ).toEqual(new Map([[id, value("1")]]));
    expect(await content.readDatabaseEntryValues(db, id)).toEqual(value("3"));
    for (const version of [3, 1, 2])
      await content.writeItemPresentation(db, {
        itemId: id,
        recordVersion: version,
        name: `Name ${version}`,
        icon: null,
      });
    expect(await content.readItemNames(db, [id])).toEqual(new Map([[id, "Name 3"]]));
    expect(
      await content.readDatabaseEntryValuesMany(db, [{ entryId: id, valueVersion: 4 }]),
    ).toEqual(new Map());
  });

  it("refuses a missing required value version or corrupted protected name instead of publishing a complete projection", async () => {
    const input = dependencies();
    const id = entryIds[1] as Uuid;
    const versionScope = and(
      eq(schema.protectedEnvelopes.entityType, "database.entry-values"),
      eq(schema.protectedEnvelopes.entityId, id),
      eq(schema.protectedEnvelopes.recordVersion, 1),
    );
    const [stored] = await input.db.select().from(schema.protectedEnvelopes).where(versionScope);
    if (stored === undefined) throw new Error("Missing sealed values fixture");
    await input.db.delete(schema.protectedEnvelopes).where(versionScope);
    const missing = createDatabaseQueryService(input);
    await expect(missing.rebuild()).rejects.toThrow();
    expect(missing.status().state).toBe("degraded");
    await input.db.insert(schema.protectedEnvelopes).values(stored);
    const nameScope = and(
      eq(schema.protectedEnvelopes.entityType, "item.name"),
      eq(schema.protectedEnvelopes.entityId, id),
    );
    const [name] = await input.db.select().from(schema.protectedEnvelopes).where(nameScope);
    if (name === undefined) throw new Error("Missing sealed name fixture");
    await input.db
      .update(schema.protectedEnvelopes)
      .set({ tag: Buffer.from("tampered").toString("base64") })
      .where(nameScope);
    const corrupt = createDatabaseQueryService(input);
    await expect(corrupt.rebuild()).rejects.toThrow();
    expect(corrupt.status().state).toBe("degraded");
    await input.db.update(schema.protectedEnvelopes).set({ tag: name.tag }).where(nameScope);
    await corrupt.rebuild();
    expect(corrupt.query(databaseId, { viewId, limit: 1000 }).rows).toHaveLength(24);
  });

  it("removes a trashed entry from an incremental source without reloading unchanged names", async () => {
    const input = dependencies();
    const service = createDatabaseQueryService(input);
    await service.rebuild();
    const id = entryIds[2] as Uuid;
    const trashed = await owner({
      method: "POST",
      url: `/v1/items/${id}/trash`,
      headers: idempotencyHeaders(),
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    const names = vi.spyOn(input.protectedContent, "readItemNames");
    await service.applyCommittedChanges([id], 10_001);
    expect(names.mock.calls.flatMap((call) => call[1])).toEqual([]);
    names.mockRestore();
    const result = service.query(databaseId, { viewId, limit: 1000 });
    expect(result.rows).toHaveLength(23);
    expect(result.rows.some((row) => row.entryId === id)).toBe(false);
  });
});
