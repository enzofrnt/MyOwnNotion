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

const v0SourceBackup = (backupId: string) => ({
  backupId,
  source: {
    installationId: null,
    applicationVersion: null,
    commit: null,
    image: null,
    postgresVersion: 180004,
    appliedMigrations: ["0001_initial"],
  },
});

it("migrates authored legacy placeholder names without confusing them with scrub state", async () => {
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
    const fileId = generateUuidV7();
    const boundary = `legacy-marker-${generateUuidV7()}`;
    const imported = await harness.owner({
      method: "POST",
      url: "/v1/files",
      headers: {
        "idempotency-key": generateUuidV7(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        [
          `--${boundary}\r\nContent-Disposition: form-data; name="itemId"\r\n\r\n${fileId}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="placement"\r\n\r\n${JSON.stringify({ kind: "hierarchy", parentItemId: null, positionKey: "V-file" })}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="temporary.txt"\r\nContent-Type: text/plain\r\n\r\nlegacy bytes\r\n`,
          `--${boundary}--\r\n`,
        ].join(""),
      ),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    const fileRevisionId = (imported.json() as { revisionIds: string[] }).revisionIds[0];
    if (fileRevisionId === undefined) throw new Error("Missing file revision");
    const fileSnapshot = await content.readRevisionSnapshot<Record<string, unknown>>(
      db,
      fileRevisionId,
    );
    const filePayload = fileSnapshot?.["file"];
    if (fileSnapshot === null || typeof filePayload !== "object" || filePayload === null)
      throw new Error("Missing retained file snapshot");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.items)
        .set({ name: PROTECTED_CONTENT_PLACEHOLDER })
        .where(inArray(schema.items.id, [page.itemId, fileId]));
      await tx
        .update(schema.logicalFiles)
        .set({ originalName: PROTECTED_CONTENT_PLACEHOLDER })
        .where(eq(schema.logicalFiles.itemId, fileId));
      await tx
        .update(schema.revisions)
        .set({ snapshot: { ...snapshot, name: PROTECTED_CONTENT_PLACEHOLDER } })
        .where(eq(schema.revisions.id, page.revisionId));
      await tx
        .update(schema.revisions)
        .set({
          snapshot: {
            ...fileSnapshot,
            name: PROTECTED_CONTENT_PLACEHOLDER,
            file: { ...filePayload, originalName: PROTECTED_CONTENT_PLACEHOLDER },
          },
        })
        .where(eq(schema.revisions.id, fileRevisionId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          and(
            inArray(schema.protectedEnvelopes.entityId, [
              page.itemId,
              page.revisionId,
              fileId,
              fileRevisionId,
            ]),
            inArray(schema.protectedEnvelopes.entityType, [
              "item.name",
              "file.metadata",
              "revision.snapshot",
            ]),
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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
    });
    const transition = await migration.prepare(generateUuidV7());
    while (await migration.publishMetadataNext(transition.id)) {
      /* durable metadata batches */
    }
    const [presentationEnvelope] = await db
      .select()
      .from(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, page.itemId),
          eq(schema.protectedEnvelopes.entityType, "item.name"),
        ),
      );
    if (presentationEnvelope === undefined) throw new Error("Missing protected presentation");
    await db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, page.itemId),
          eq(schema.protectedEnvelopes.entityType, "item.name"),
        ),
      );
    await expect(migration.finishVerification(transition.id)).rejects.toThrow(/unavailable/);
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe(
      "metadata-protected",
    );
    await db.insert(schema.protectedEnvelopes).values(presentationEnvelope);
    await migration.finishVerification(transition.id);
    await db
      .delete(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, page.itemId),
          eq(schema.protectedEnvelopes.entityType, "item.name"),
        ),
      );
    await expect(migration.cutover(transition.id)).rejects.toThrow(/unavailable/);
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe("verified");
    await db.insert(schema.protectedEnvelopes).values(presentationEnvelope);
    await migration.cutover(transition.id);
    while (await migration.retireNext(transition.id)) {
      /* authenticated source retirement */
    }

    const restored = await harness.owner({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().name).toBe(PROTECTED_CONTENT_PLACEHOLDER);
    const restoredFile = await harness.owner({ method: "GET", url: `/v1/items/${fileId}` });
    expect(restoredFile.statusCode, restoredFile.body).toBe(200);
    expect(restoredFile.json()).toMatchObject({
      name: PROTECTED_CONTENT_PLACEHOLDER,
      file: { originalName: PROTECTED_CONTENT_PLACEHOLDER },
    });
    expect(
      await content.readRevisionSnapshot<Record<string, unknown>>(db, page.revisionId),
    ).toMatchObject({ name: PROTECTED_CONTENT_PLACEHOLDER });
    expect(
      await content.readRevisionSnapshot<Record<string, unknown>>(db, fileRevisionId),
    ).toMatchObject({
      name: PROTECTED_CONTENT_PLACEHOLDER,
      file: { originalName: PROTECTED_CONTENT_PLACEHOLDER },
    });
    expect(
      (
        await db
          .select({ snapshot: schema.revisions.snapshot })
          .from(schema.revisions)
          .where(inArray(schema.revisions.id, [page.revisionId, fileRevisionId]))
      ).every((revision) => revision.snapshot === null),
    ).toBe(true);
  } finally {
    await harness.close();
  }
});

it("revalidates retired canonical metadata before completing the transition", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedFiles: files } = harness.built.context;
    if (files === undefined) throw new Error("Missing protected runtime");
    const page = await createItemViaApi(harness, { kind: "page", name: "Completion guard" });
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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
    });
    const transition = await migration.prepare(generateUuidV7());
    while (await migration.publishMetadataNext(transition.id)) {
      /* durable metadata batches */
    }
    await migration.finishVerification(transition.id);
    await migration.cutover(transition.id);

    const entries = await db
      .select()
      .from(schema.fileStorageTransitionEntries)
      .where(eq(schema.fileStorageTransitionEntries.transitionId, transition.id));
    let itemEntryId: string | null = null;
    for (const entry of entries) {
      if (entry.kind !== "metadata") continue;
      const payload = await records.read(db, {
        entityType: "file.transition-source",
        entityId: entry.id,
        recordVersion: 1,
      });
      if (payload === null) throw new Error("Missing transition source");
      try {
        const source = JSON.parse(new TextDecoder().decode(payload)) as {
          category?: string;
          entityId?: string;
        };
        if (source.category === "item" && source.entityId === page.itemId) itemEntryId = entry.id;
      } finally {
        payload.fill(0);
      }
    }
    if (itemEntryId === null) throw new Error("Missing item transition checkpoint");
    while (
      (
        await db
          .select({ phase: schema.fileStorageTransitionEntries.phase })
          .from(schema.fileStorageTransitionEntries)
          .where(eq(schema.fileStorageTransitionEntries.id, itemEntryId))
      )[0]?.phase !== "retired"
    ) {
      expect(await migration.retireNext(transition.id)).toBe(true);
    }

    const [presentationEnvelope] = await db
      .select()
      .from(schema.protectedEnvelopes)
      .where(
        and(
          eq(schema.protectedEnvelopes.entityId, page.itemId),
          eq(schema.protectedEnvelopes.entityType, "item.name"),
        ),
      );
    if (presentationEnvelope === undefined) throw new Error("Missing protected presentation");
    await db
      .delete(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.id, presentationEnvelope.id));
    while (
      (
        await db
          .select({ phase: schema.fileStorageTransitionEntries.phase })
          .from(schema.fileStorageTransitionEntries)
          .where(eq(schema.fileStorageTransitionEntries.transitionId, transition.id))
      ).some((entry) => entry.phase === "verified")
    ) {
      expect(await migration.retireNext(transition.id)).toBe(true);
    }
    await expect(migration.retireNext(transition.id)).rejects.toThrow(/unavailable/);
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe(
      "retiring-sources",
    );
    await db.insert(schema.protectedEnvelopes).values(presentationEnvelope);
    expect(await migration.retireNext(transition.id)).toBe(false);
    expect((await db.select().from(schema.fileStorageTransitions))[0]?.phase).toBe("complete");
  } finally {
    await harness.close();
  }
});

it("migrates an authored legacy protected payload in a page and retained snapshot", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedContent: content, protectedFiles: files } = harness.built.context;
    if (content === undefined || files === undefined) throw new Error("Missing protected runtime");
    const page = await createItemViaApi(harness, { kind: "page", name: "Legacy payload page" });
    const snapshot = await content.readRevisionSnapshot<Record<string, unknown>>(
      db,
      page.revisionId,
    );
    const pageDocument = snapshot?.["pageDocument"];
    if (snapshot === null || typeof pageDocument !== "object" || pageDocument === null)
      throw new Error("Missing retained page snapshot");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.pageDocuments)
        .set({ body: PROTECTED_PAYLOAD })
        .where(eq(schema.pageDocuments.pageId, page.itemId));
      await tx
        .update(schema.revisions)
        .set({
          snapshot: { ...snapshot, pageDocument: { ...pageDocument, body: PROTECTED_PAYLOAD } },
        })
        .where(eq(schema.revisions.id, page.revisionId));
      await tx
        .delete(schema.protectedEnvelopes)
        .where(
          and(
            inArray(schema.protectedEnvelopes.entityId, [page.itemId, page.revisionId]),
            inArray(schema.protectedEnvelopes.entityType, ["page.body", "revision.snapshot"]),
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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
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

    expect(await content.readPageBody(db, page.itemId)).toEqual(PROTECTED_PAYLOAD);
    expect(
      await content.readRevisionSnapshot<Record<string, unknown>>(db, page.revisionId),
    ).toMatchObject({ pageDocument: { body: PROTECTED_PAYLOAD } });
    const restored = await harness.owner({ method: "GET", url: `/v1/items/${page.itemId}` });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ pageDocument: { body: PROTECTED_PAYLOAD } });
  } finally {
    await harness.close();
  }
});

it("migrates authored legacy protected relationship metadata", async () => {
  const harness = await createProtectedFileHarness();
  try {
    const { db, protectedContent: content, protectedFiles: files } = harness.built.context;
    if (content === undefined || files === undefined) throw new Error("Missing protected runtime");
    const source = await createItemViaApi(harness, { kind: "page", name: "Legacy source" });
    const target = await createItemViaApi(harness, { kind: "page", name: "Legacy target" });
    const relationshipId = generateUuidV7();
    const created = await harness.owner({
      method: "POST",
      url: "/v1/relationships",
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: relationshipId,
        sourceItemId: source.itemId,
        targetItemId: target.itemId,
        relationType: "link:references",
        metadata: { note: "temporary metadata" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.relationships)
        .set({ metadata: PROTECTED_PAYLOAD })
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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
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

    expect(await content.readRelationshipMetadata(db, relationshipId)).toEqual(PROTECTED_PAYLOAD);
    const listing = await harness.owner({
      method: "GET",
      url: `/v1/relationships?itemId=${source.itemId}`,
    });
    expect(listing.statusCode, listing.body).toBe(200);
    expect(listing.json()).toMatchObject({
      relationships: [{ id: relationshipId, metadata: PROTECTED_PAYLOAD }],
    });
  } finally {
    await harness.close();
  }
});

it.each(["missing", "modern"] as const)(
  "refuses a reserved plaintext payload before inventory when V0 provenance is %s",
  async (provenance) => {
    const harness = await createProtectedFileHarness();
    try {
      const { db, protectedContent: content, protectedFiles: files } = harness.built.context;
      if (content === undefined || files === undefined)
        throw new Error("Missing protected runtime");
      const page = await createItemViaApi(harness, { kind: "page", name: "Provenance guard" });
      await db.transaction(async (tx) => {
        await tx
          .update(schema.pageDocuments)
          .set({ body: PROTECTED_PAYLOAD })
          .where(eq(schema.pageDocuments.pageId, page.itemId));
        await tx
          .delete(schema.protectedEnvelopes)
          .where(
            and(
              eq(schema.protectedEnvelopes.entityId, page.itemId),
              eq(schema.protectedEnvelopes.entityType, "page.body"),
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
        verifySourceBackup: async (backupId) => ({
          backupId,
          source: {
            installationId: files.deps.installationId,
            applicationVersion: provenance === "missing" ? null : "0.1.0",
            commit: null,
            image: null,
            postgresVersion: 180004,
            appliedMigrations: ["0001_initial", "0006_installation_application_version"],
          },
        }),
      });

      await expect(migration.prepare(generateUuidV7())).rejects.toThrow(/unavailable|reserved/);
      expect(await db.select().from(schema.fileStorageTransitions)).toHaveLength(0);
      expect(await db.select().from(schema.fileStorageTransitionEntries)).toHaveLength(0);
    } finally {
      await harness.close();
    }
  },
);

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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
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
      verifySourceBackup: async (backupId) => v0SourceBackup(backupId),
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
