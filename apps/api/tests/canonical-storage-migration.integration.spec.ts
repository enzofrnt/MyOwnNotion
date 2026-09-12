import { buildItemSnapshot, schema } from "@myownnotion/database";
import { generateUuidV7, PROTECTED_CONTENT_PLACEHOLDER } from "@myownnotion/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { PROTECTED_PAYLOAD } from "../src/security/canonical-payloads.ts";
import {
  canonicalMetadataDigest,
  protectCanonicalMetadata,
} from "../src/security/canonical-storage-migration.ts";
import { FileStorageMigration } from "../src/security/file-storage-migration.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";
import { createItemViaApi } from "./helpers/app.ts";
import { createProtectedFileHarness } from "./helpers/protected-files.ts";

it("migrates an authored legacy placeholder title and retained snapshot without confusing them with scrub state", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedContent: content, protectedFiles: files } = harness.built.context;
    if (content === undefined || files === undefined) throw new Error("Missing protected runtime");
    const page = await createItemViaApi(harness, {
      kind: "page",
      name: "temporary legacy title",
    });
    const snapshot = await content.readRevisionSnapshot<Record<string, unknown>>(
      db,
      page.revisionId,
    );
    if (snapshot === null) throw new Error("Missing retained snapshot");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.items)
        .set({ name: PROTECTED_CONTENT_PLACEHOLDER })
        .where(eq(schema.items.id, page.itemId));
      await tx
        .update(schema.revisions)
        .set({ snapshot: { ...snapshot, name: PROTECTED_CONTENT_PLACEHOLDER } })
        .where(eq(schema.revisions.id, page.revisionId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          inArray(schema.protectedEnvelopes.entityType, ["item.name", "revision.snapshot"]),
        );
    });

    const records = new ProtectedRecordService({
      db,
      keys: files.deps.keys,
      workspaceId: files.deps.workspaceId,
      installationId: files.deps.installationId,
      now: () => new Date(),
    });
    const migration = new FileStorageMigration({
      db,
      files,
      records,
      blobRoot: harness.blobRoot,
      verifySourceBackup: async () => {},
    });
    const transition = await migration.prepare(generateUuidV7());
    while (await migration.publishMetadataNext(transition.id)) {
      /* durable metadata batches */
    }
    await migration.finishVerification(transition.id);
    await migration.cutover(transition.id);
    while (await migration.retireNext(transition.id)) {
      /* authenticated source retirement */
    }

    const restored = await harness.owner({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().name).toBe(PROTECTED_CONTENT_PLACEHOLDER);
    expect(await content.readRevisionSnapshot<Record<string, unknown>>(db, page.revisionId)).toMatchObject(
      { name: PROTECTED_CONTENT_PLACEHOLDER },
    );
    expect(
      (await db.select().from(schema.revisions).where(eq(schema.revisions.id, page.revisionId)))[0]
        ?.snapshot,
    ).toBeNull();
  } finally {
    await harness.close();
  }
});

it("resumes private historical metadata backfill without replacing authoritative envelopes with stale readable copies", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const page = await createItemViaApi(harness, {
      kind: "page",
      name: "historical title sentinel",
    });
    const authoritative = await createItemViaApi(harness, {
      kind: "page",
      name: "authoritative sealed title",
    });
    const relationshipId = generateUuidV7();
    const relation = await harness.owner({
      method: "POST",
      url: "/v1/relationships",
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: relationshipId,
        sourceItemId: page.itemId,
        targetItemId: authoritative.itemId,
        relationType: "link:references",
        metadata: { note: "historical relationship sentinel" },
      },
    });
    expect(relation.statusCode, relation.body).toBe(201);
    expect(
      (await harness.owner({ method: "GET", url: `/v1/relationships?itemId=${page.itemId}` })).body,
    ).toContain("historical relationship sentinel");
    const body = { note: "historical body sentinel" };
    await db.transaction(async (tx) => {
      await tx
        .update(schema.items)
        .set({ name: "historical title sentinel", icon: "⭐" })
        .where(eq(schema.items.id, page.itemId));
      await tx
        .update(schema.pageDocuments)
        .set({ body })
        .where(eq(schema.pageDocuments.pageId, page.itemId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          and(
            eq(schema.protectedEnvelopes.entityId, page.itemId),
            inArray(schema.protectedEnvelopes.entityType, ["item.name", "page.body"]),
          ),
        );
      const snapshot = await buildItemSnapshot(tx, page.itemId);
      await tx
        .update(schema.revisions)
        .set({ snapshot })
        .where(eq(schema.revisions.id, page.revisionId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(eq(schema.protectedEnvelopes.entityId, page.revisionId));
      await tx
        .update(schema.items)
        .set({ name: "stale readable title" })
        .where(eq(schema.items.id, authoritative.itemId));
      await tx
        .update(schema.relationships)
        .set({ metadata: { note: "historical relationship sentinel" } })
        .where(eq(schema.relationships.id, relationshipId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          and(
            eq(schema.protectedEnvelopes.entityId, relationshipId),
            eq(schema.protectedEnvelopes.entityType, "relationship.metadata"),
          ),
        );
    });
    const records = new ProtectedRecordService({
      db,
      keys: files.deps.keys,
      workspaceId: files.deps.workspaceId,
      installationId: files.deps.installationId,
      now: () => new Date(),
    });
    const migration = new FileStorageMigration({
      db,
      files,
      records,
      blobRoot: harness.blobRoot,
      verifySourceBackup: async () => {
        /* guard composition has separate real full-backup tests */
      },
    });
    const transition = await migration.prepare(generateUuidV7());
    expect(await migration.publishNext(transition.id)).toBe(false);
    vi.spyOn(files.deps.content, "writePageBody").mockRejectedValueOnce(
      new Error("interrupted canonical publication"),
    );
    await expect(migration.publishMetadataNext(transition.id)).rejects.toThrow("interrupted");
    expect(
      (await db.select().from(schema.fileStorageTransitionEntries)).every(
        (entry) => entry.phase === "inventoried",
      ),
    ).toBe(true);
    expect(
      (await db.select().from(schema.items).where(eq(schema.items.id, page.itemId)))[0]?.name,
    ).toBe("historical title sentinel");
    vi.restoreAllMocks();
    while (await migration.publishMetadataNext(transition.id)) {
      /* durable batches */
    }
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe(
      "metadata-protected",
    );
    await migration.finishVerification(transition.id);
    await migration.cutover(transition.id);
    const read = await harness.owner({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      name: "historical title sentinel",
      icon: "⭐",
      pageDocument: { body },
    });
    const preserved = await harness.owner({
      method: "GET",
      url: `/v1/items/${authoritative.itemId}`,
    });
    expect(preserved.json().name).toBe("authoritative sealed title");
    const history = await harness.owner({ method: "GET", url: `/v1/revisions/${page.revisionId}` });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.body).toContain("historical body sentinel");
    const relationships = await harness.owner({
      method: "GET",
      url: `/v1/relationships?itemId=${page.itemId}`,
    });
    expect(relationships.body).toContain("historical relationship sentinel");
    await db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, relationshipId),
          eq(schema.protectedEnvelopes.entityType, "relationship.metadata"),
        ),
      );
    expect(
      (await harness.owner({ method: "GET", url: `/v1/relationships?itemId=${page.itemId}` }))
        .statusCode,
    ).toBe(500);
    const raw = await db.execute(sql`
      SELECT to_jsonb(i)::text AS payload FROM items i
      UNION ALL SELECT to_jsonb(p)::text FROM page_documents p
      UNION ALL SELECT to_jsonb(r)::text FROM revisions r
      UNION ALL SELECT to_jsonb(r)::text FROM relationships r
    `);
    const stored = JSON.stringify(raw.rows);
    for (const sentinel of [
      "historical title sentinel",
      "historical body sentinel",
      "historical relationship sentinel",
      "stale readable title",
      "authoritative sealed title",
      "⭐",
    ])
      expect(stored).not.toContain(sentinel);
  } finally {
    vi.restoreAllMocks();
    await harness.close();
  }
});

it("protects historical database definitions, views and entry values while retaining their current API representation", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const databaseId = generateUuidV7();
    const propertyId = generateUuidV7();
    const created = await harness.owner({
      method: "POST",
      url: "/v1/databases",
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: databaseId,
        name: "historical database sentinel",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "historical view sentinel",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const initial = created.json().database;
    const changed = await harness.owner({
      method: "PUT",
      url: `/v1/databases/${databaseId}/definition`,
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        baseRevisionId: initial.definitionRevisionId,
        definition: {
          ...initial.definition,
          properties: [
            ...initial.definition.properties,
            {
              id: propertyId,
              name: "historical property sentinel",
              type: "text",
              positionKey: "b",
              state: "active",
              config: {},
            },
          ],
        },
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const entryId = generateUuidV7();
    const entry = await harness.owner({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: entryId,
        title: "historical entry sentinel",
        placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "a" },
        values: { [propertyId]: { kind: "text", value: "historical cell sentinel" } },
        relationTargets: {},
      },
    });
    expect(entry.statusCode, entry.body).toBe(201);
    const expectedDatabase = (
      await harness.owner({ method: "GET", url: `/v1/databases/${databaseId}` })
    ).json();
    const expectedEntry = (
      await harness.owner({ method: "GET", url: `/v1/databases/${databaseId}/entries/${entryId}` })
    ).json();
    await db.transaction(async (tx) => {
      for (const revision of await tx.select().from(schema.revisions)) {
        const snapshot = await files.deps.content.readRevisionSnapshot<Record<string, unknown>>(
          tx,
          revision.id,
        );
        await tx
          .update(schema.revisions)
          .set({ snapshot })
          .where(eq(schema.revisions.id, revision.id));
      }
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          inArray(schema.protectedEnvelopes.entityType, [
            "revision.snapshot",
            "database.definition",
            "database.entry-values",
          ]),
        );
    });
    const records = new ProtectedRecordService({
      db,
      keys: files.deps.keys,
      workspaceId: files.deps.workspaceId,
      installationId: files.deps.installationId,
      now: () => new Date(),
    });
    const migration = new FileStorageMigration({
      db,
      files,
      records,
      blobRoot: harness.blobRoot,
      verifySourceBackup: async () => {},
    });
    const transition = await migration.prepare(generateUuidV7());
    while (await migration.publishMetadataNext(transition.id)) {
      /* durable metadata batches */
    }
    await migration.finishVerification(transition.id);
    await migration.cutover(transition.id);
    const restoredDatabase = await harness.owner({
      method: "GET",
      url: `/v1/databases/${databaseId}`,
    });
    const restoredEntry = await harness.owner({
      method: "GET",
      url: `/v1/databases/${databaseId}/entries/${entryId}`,
    });
    expect(restoredDatabase.statusCode, restoredDatabase.body).toBe(200);
    expect(restoredEntry.statusCode, restoredEntry.body).toBe(200);
    expect(restoredDatabase.json()).toEqual(expectedDatabase);
    expect(restoredEntry.json()).toEqual(expectedEntry);
    expect(JSON.stringify(await db.select().from(schema.revisions))).not.toContain("sentinel");
  } finally {
    await harness.close();
  }
});

it("refuses unavailable canonical identities and damaged retained snapshots before sealing anything", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedContent: content } = harness.built.context;
    if (content === undefined) throw new Error("Missing protected content");
    for (const category of ["item", "revision", "relationship", "export"] as const) {
      await expect(
        db.transaction((tx) =>
          canonicalMetadataDigest(tx, content, {
            category,
            entityId: generateUuidV7(),
          }),
        ),
      ).rejects.toThrow("unavailable");
    }
    await expect(
      db.transaction((tx) =>
        canonicalMetadataDigest(tx, content, {
          category: "unknown" as never,
          entityId: generateUuidV7(),
        }),
      ),
    ).rejects.toThrow("Unsupported");
    const page = await createItemViaApi(harness, { kind: "page", name: "snapshot safety" });
    await db
      .delete(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, page.revisionId));
    for (const invalid of [
      "invalid",
      42,
      [],
      { name: "�" },
      { pageDocument: { body: PROTECTED_PAYLOAD } },
      { file: { originalName: "�" } },
    ]) {
      await db
        .update(schema.revisions)
        .set({ snapshot: invalid })
        .where(eq(schema.revisions.id, page.revisionId));
      await expect(
        db.transaction((tx) =>
          canonicalMetadataDigest(tx, content, {
            category: "revision",
            entityId: page.revisionId,
          }),
        ),
      ).rejects.toThrow(/invalid|marker/);
      expect(await content.readRevisionSnapshot(db, page.revisionId)).toBeNull();
    }
    await db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, page.itemId),
          eq(schema.protectedEnvelopes.entityType, "page.body"),
        ),
      );
    await expect(
      db.transaction((tx) =>
        canonicalMetadataDigest(tx, content, {
          category: "item",
          entityId: page.itemId,
        }),
      ),
    ).rejects.toThrow(/unavailable/);
  } finally {
    await harness.close();
  }
});

it("protects export descriptors only if both their captured and replacement values agree", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedContent: content, workspaceId } = harness.built.context;
    if (content === undefined) throw new Error("Missing protected content");
    const entityId = generateUuidV7();
    const manifest = { filename: "private exported descriptor", files: [] };
    await db.insert(schema.exports).values({ id: entityId, workspaceId, manifest });
    const source = {
      kind: "metadata" as const,
      category: "export" as const,
      objectId: generateUuidV7(),
      entityId,
      digest: await db.transaction((tx) =>
        canonicalMetadataDigest(tx, content, { category: "export", entityId }),
      ),
    };
    await db
      .update(schema.exports)
      .set({ manifest: { filename: "modified" } })
      .where(eq(schema.exports.id, entityId));
    await expect(
      db.transaction((tx) => protectCanonicalMetadata(tx, content, source)),
    ).rejects.toThrow("changed after inventory");
    expect(await content.readExportManifest(db, entityId)).toBeNull();
    await db.update(schema.exports).set({ manifest }).where(eq(schema.exports.id, entityId));
    vi.spyOn(content, "writeExportManifest").mockResolvedValueOnce(undefined);
    await expect(
      db.transaction((tx) => protectCanonicalMetadata(tx, content, source)),
    ).rejects.toThrow("does not match");
    expect(
      (await db.select().from(schema.exports).where(eq(schema.exports.id, entityId)))[0]?.manifest,
    ).toEqual(manifest);
    vi.restoreAllMocks();
    await db.transaction((tx) => protectCanonicalMetadata(tx, content, source));
    expect(
      (await db.select().from(schema.exports).where(eq(schema.exports.id, entityId)))[0]?.manifest,
    ).toBeNull();
    expect(await content.readExportManifest(db, entityId)).toEqual(manifest);
    expect(await db.transaction((tx) => canonicalMetadataDigest(tx, content, source))).toBe(
      source.digest,
    );
    // A pending export legitimately has no completed descriptor yet.
    const pendingId = generateUuidV7();
    await db.insert(schema.exports).values({ id: pendingId, workspaceId });
    const pending = {
      ...source,
      entityId: pendingId,
      objectId: generateUuidV7(),
      digest: await db.transaction((tx) =>
        canonicalMetadataDigest(tx, content, { category: "export", entityId: pendingId }),
      ),
    };
    await db.transaction((tx) => protectCanonicalMetadata(tx, content, pending));
    expect(await content.readExportManifest(db, pendingId)).toBeNull();
  } finally {
    vi.restoreAllMocks();
    await harness.close();
  }
});
