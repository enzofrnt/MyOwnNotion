import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { schema } from "@myownnotion/database";
import {
  type DatabaseDefinition,
  databaseEmbeddings,
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
async function replace(source: SourceDto, definition: DatabaseDefinition): Promise<SourceDto> {
  const response = await owner({
    method: "PUT",
    url: `/v1/databases/${source.databaseId}/definition`,
    headers: idempotencyHeaders(),
    payload: { baseRevisionId: source.definitionRevisionId, definition },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().database as SourceDto;
}

describe("protected reusable database resources", () => {
  it("keeps a source and canonical entries after deleting and purging every display host, then restores them", async () => {
    const first = await host("First display");
    const second = await host("Second display");
    const databaseId = generateUuidV7();
    const create = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: {
        id: databaseId,
        name: PRIVATE_NAME,
        hostPageId: first.itemId,
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "First table",
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    let source = create.json().database as SourceDto;
    const original = required(databaseEmbeddings(source.definition)[0]);
    const secondView = generateUuidV7();
    source = await replace(source, {
      ...source.definition,
      embeddings: [
        ...databaseEmbeddings(source.definition),
        {
          id: generateUuidV7(),
          hostPageId: second.itemId,
          state: "active",
          views: original.views.map((view) => ({
            ...view,
            id: secondView,
            name: "Second list",
            type: "list",
            options: { density: "compact", secondaryPropertyIds: [] },
          })),
        },
      ],
    });
    const entryId = generateUuidV7();
    const entry = await owner({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: entryId,
        title: "Shared page",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "b" },
        document: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { text: "Preserved editorial body" },
        },
        values: {},
        relationTargets: {},
      },
    });
    expect(entry.statusCode, entry.body).toBe(201);
    const entryBefore = (
      await owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${entryId}` })
    ).json();
    for (const page of [first, second]) {
      const trashed = await owner({
        method: "POST",
        url: `/v1/items/${page.itemId}/trash`,
        headers: idempotencyHeaders(),
      });
      expect(trashed.statusCode, trashed.body).toBe(200);
      // Canonical purge state; the current product retains tombstone/journal IDs.
      await harness.built.database.db
        .update(schema.items)
        .set({ lifecycle: "purged", trashedAt: null, purgeAfter: null })
        .where(eq(schema.items.id, page.itemId));
    }
    const unchanged = await readSource(databaseId);
    expect(unchanged).toEqual(source);
    expect(
      (
        await owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${entryId}` })
      ).json(),
    ).toEqual(entryBefore);
    source = await replace(unchanged, { ...unchanged.definition, embeddings: [] });
    const catalog = await owner({ method: "GET", url: "/v1/databases" });
    expect(catalog.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ databaseId, name: PRIVATE_NAME })]),
    );
    const third = await host("Display again");
    source = await replace(source, {
      ...source.definition,
      embeddings: [{ ...original, hostPageId: third.itemId }],
    });
    const query = await owner({
      method: "POST",
      url: `/v1/databases/${databaseId}/query`,
      payload: { viewId: required(original.views[0]).id },
    });
    expect(query.statusCode, query.body).toBe(200);
    expect(query.json().rows.map((row: { entryId: string }) => row.entryId)).toEqual([entryId]);

    const context = harness.built.context;
    const manifest = await context.db.transaction((tx) => buildManifestInTransaction(context, tx));
    expect(validateCanonicalExport(manifest)).toEqual([]);
    for (const purgedHost of [first, second]) {
      expect(manifest.items.find((item) => item.id === purgedHost.itemId)).toMatchObject({
        lifecycle: "purged",
        name: "Élément supprimé",
        placements: [],
        pageDocument: null,
      });
    }
    expect(JSON.stringify(manifest)).not.toContain("First display");
    expect(JSON.stringify(manifest)).not.toContain("Second display");
    const exportedSource = manifest.databases.find((row) => row.databaseId === databaseId);
    expect(exportedSource?.definitionRevisionId).toBe(source.definitionRevisionId);
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
    const persisted = await context.db.execute(
      sql`SELECT jsonb_agg(to_jsonb(d)) AS content FROM databases d`,
    );
    expect(JSON.stringify(persisted.rows)).not.toContain(PRIVATE_NAME);
    const snapshots = await context.db
      .select({ snapshot: schema.revisions.snapshot })
      .from(schema.revisions);
    expect(snapshots.every((row) => row.snapshot === null)).toBe(true);
  });

  it("preserves the old database identity and definition revision after its original host is purged", async () => {
    const id = generateUuidV7();
    const created = await owner({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: {
        id,
        name: "Legacy host source",
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
    expect(await readSource(id)).toEqual(source);
    const revision = await owner({
      method: "GET",
      url: `/v1/revisions/${source.definitionRevisionId}`,
    });
    expect(revision.statusCode, revision.body).toBe(200);
    // Purge may remove the old host's private records. Source reads, edits and
    // sync must use the live source envelope and never reopen those records.
    await harness.built.database.db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, id),
          inArray(schema.protectedEnvelopes.entityType, ["item.name", "page.body"]),
        ),
      );
    expect(await readSource(id)).toEqual(source);
    const another = await host("Recovered source display");
    const displayed = await replace(source, {
      ...source.definition,
      embeddings: [
        { ...required(databaseEmbeddings(source.definition)[0]), hostPageId: another.itemId },
      ],
    });
    expect(displayed.databaseId).toBe(id);
    const sourceSnapshot = await required(
      harness.built.context.protectedContent,
    ).readRevisionSnapshot(harness.built.context.db, displayed.definitionRevisionId);
    expect(sourceSnapshot).not.toHaveProperty("name");
    expect(sourceSnapshot).not.toHaveProperty("pageDocument");
    const snapshot = await owner({ method: "GET", url: "/v1/snapshots/current" });
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.json().databases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: id,
          definitionRevisionId: displayed.definitionRevisionId,
        }),
      ]),
    );
  });
});
