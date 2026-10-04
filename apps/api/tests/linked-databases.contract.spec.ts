import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { schema } from "@myownnotion/database";
import {
  type DatabaseDefinition,
  generateUuidV7,
  type Uuid,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearWorkspaceForRestore,
  createDatabaseRestoreTarget,
} from "../src/backup/database-restore-target.ts";
import { buildManifestInTransaction } from "../src/routes/export.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";
import { authenticatedContent } from "./helpers/content-owner.ts";

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing test fixture");
  return value;
}

let harness: ApiHarness;
let owner: Awaited<ReturnType<typeof authenticatedContent>>;
let keyDirectory: string;
const PRIVATE_NAME = "LINKED_SOURCE_PRIVATE_026_4183";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-linked-source-"));
  const key = path.join(keyDirectory, "deployment-key");
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
}, 180_000);
afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

async function host(name: string) {
  return createItemViaApi(harness, { kind: "page", name, headers: owner.headers });
}
interface SourceDto {
  databaseId: Uuid;
  definitionRevisionId: Uuid;
  name: string;
  definition: DatabaseDefinition;
}
async function readSource(id: Uuid): Promise<SourceDto> {
  const response = await owner({ method: "GET", url: `/v1/databases/${id}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as SourceDto;
}
describe("protected reusable database resources", () => {
  it("restores an owned source, its direct entry, and a linked presentation", async () => {
    const first = await host("Owner page");
    const second = await host("Linked page");
    const databaseId = generateUuidV7();
    const created = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: {
        id: databaseId,
        name: PRIVATE_NAME,
        placement: { id: generateUuidV7(), parentItemId: first.itemId, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const source = created.json().database as SourceDto & { sourceId: Uuid };
    const linkedId = generateUuidV7();
    const linked = await owner({
      method: "POST",
      url: "/v1/database-views",
      headers: idempotencyHeaders(),
      payload: {
        id: linkedId,
        name: "Linked table",
        sourceId: source.sourceId,
        placement: { id: generateUuidV7(), parentItemId: second.itemId, positionKey: "a" },
        initialViewId: generateUuidV7(),
      },
    });
    expect(linked.statusCode, linked.body).toBe(201);
    const entryId = generateUuidV7();
    const entry = await owner({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: { id: entryId, title: "Shared page", values: {}, relationTargets: {} },
    });
    expect(entry.statusCode, entry.body).toBe(201);
    const entryBefore = (
      await owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${entryId}` })
    ).json();
    expect((await owner({ method: "GET", url: `/v1/items/${entryId}` })).json().placements).toEqual(
      [expect.objectContaining({ parentItemId: databaseId })],
    );
    const context = harness.built.context;
    const manifest = await context.db.transaction((tx) => buildManifestInTransaction(context, tx));
    expect(validateCanonicalExport(manifest)).toEqual([]);
    expect(manifest.databases.find((row) => row.databaseId === databaseId)?.sourceId).toBe(
      source.sourceId,
    );
    expect(manifest.databasePresentations?.map((row) => row.containerItemId)).toEqual(
      expect.arrayContaining([databaseId, linkedId]),
    );
    await context.db.transaction(async (tx) => {
      await clearWorkspaceForRestore(tx, context.workspaceId);
      const target = createDatabaseRestoreTarget({
        tx,
        workspaceId: context.workspaceId,
        contentStore: context.contentStore,
        protectedContent: required(context.protectedContent),
      });
      for (const item of manifest.items) await target.writeItem(item);
      for (const revision of manifest.revisions) await target.writeRevision(revision);
      for (const database of manifest.databases) await required(target.writeDatabase)(database);
      for (const presentation of manifest.databasePresentations ?? [])
        await required(target.writeDatabasePresentation)(presentation);
      for (const value of manifest.databaseEntries)
        await required(target.writeDatabaseEntry)(value);
      for (const relation of manifest.relationships) await target.writeRelationship(relation);
      await target.finish?.();
    });
    expect(await readSource(databaseId)).toEqual(source);
    expect(
      (
        await owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${entryId}` })
      ).json(),
    ).toEqual(entryBefore);
    expect(await context.db.select().from(schema.databasePresentations)).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemId: linkedId })]),
    );
    const persisted = await context.db.execute(
      sql`SELECT jsonb_agg(to_jsonb(d)) AS content FROM databases d`,
    );
    expect(JSON.stringify(persisted.rows)).not.toContain(PRIVATE_NAME);
  });

  it("requires the owner, rejects non-page hosts atomically and refuses old-client display erasure", async () => {
    const denied = await harness.built.app.inject({ method: "GET", url: "/v1/databases" });
    expect(denied.statusCode).toBe(401);
    const folder = await createItemViaApi(harness, {
      kind: "folder",
      name: "Folder cannot embed",
      headers: owner.headers,
    });
    const id = generateUuidV7();
    const payload = {
      id,
      name: "Guarded source",
      hostPageId: folder.itemId,
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a0" },
      titlePropertyId: generateUuidV7(),
      initialViewId: generateUuidV7(),
      initialViewName: "Table",
    };
    const invalid = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload,
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      await harness.built.database.db
        .select()
        .from(schema.databases)
        .where(eq(schema.databases.itemId, id)),
    ).toEqual([]);
    const page = await host("Valid guarded display");
    const created = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: { ...payload, hostPageId: page.itemId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const source = await readSource(id);
    const { embeddings: _displays, ...legacyDefinition } = source.definition;
    const erased = await owner({
      method: "PUT",
      url: `/v1/databases/${id}/definition`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: source.definitionRevisionId, definition: legacyDefinition },
    });
    expect(erased.statusCode).toBeGreaterThanOrEqual(400);
    expect(await readSource(id)).toEqual(source);
  });

  it("marks an owned source unavailable after its owner is purged while retaining identity", async () => {
    const id = generateUuidV7();
    const created = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: {
        id,
        name: "Owned source",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const source = created.json().database as SourceDto;
    const trashed = await owner({
      method: "POST",
      url: `/v1/items/${id}/trash`,
      headers: idempotencyHeaders(),
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    await harness.built.database.db
      .update(schema.items)
      .set({ lifecycle: "purged", trashedAt: null, purgeAfter: null })
      .where(eq(schema.items.id, id));
    expect(await readSource(id)).toMatchObject({
      databaseId: id,
      definitionRevisionId: source.definitionRevisionId,
      lifecycle: "purged",
    });
    const revision = await owner({
      method: "GET",
      url: `/v1/revisions/${source.definitionRevisionId}`,
    });
    expect(revision.statusCode, revision.body).toBe(200);
    // Purge can remove editorial envelopes while preserving the source tombstone.
    await harness.built.database.db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, id),
          inArray(schema.protectedEnvelopes.entityType, ["item.name", "page.body"]),
        ),
      );
    expect(await readSource(id)).toMatchObject({ lifecycle: "purged" });
    const snapshot = await owner({ method: "GET", url: "/v1/snapshots/current" });
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json().databases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: id,
          definitionRevisionId: source.definitionRevisionId,
        }),
      ]),
    );
  });
});
