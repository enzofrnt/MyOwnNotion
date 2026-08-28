/**
 * Sealing feature-001 payloads through the real routes (T057, feature 002).
 *
 * Two questions, and they pull in opposite directions:
 *
 *   1. Does writing a page through the ordinary API leave a sealed envelope?
 *   2. Does feature-001 still behave exactly as it did?
 *
 * The second matters because this is a dual write bolted onto routes that
 * thirty-four journeys depend on. A change that encrypts everything and breaks
 * the workspace is not progress.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCRUBBED_PLACEHOLDER } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProtectedContent } from "../src/security/protected-content.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const SECRET_TITLE = "Codes for the safe";
const SECRET_BODY = "the third digit is seven";
const SECRET_RELATION_NOTE = "cited in the dismissal file";
/**
 * The body of a mutation that must be refused, and therefore never sealed.
 *
 * Long and distinctive on purpose: the assertion searches base64 ciphertext for
 * it, and a three-letter needle matches random base64 often enough to fail a
 * build for no reason.
 */
const STALE_BODY_MARKER = "rejected-stale-base-should-never-be-sealed";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-content-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  await harness.built.database.db.execute(
    sql`TRUNCATE protected_envelopes, placements, revision_parents, page_documents CASCADE`,
  );
  // Any generation a test revoked is restored, so one test cannot leave the
  // installation unable to seal for every test after it.
  await harness.built.database.db.execute(
    sql`UPDATE data_key_generations SET state = 'current' WHERE state = 'revoked'`,
  );
});

/** Creates a page through the ordinary route and returns its id. */
async function createPage(name: string): Promise<string> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/items",
    headers: { "idempotency-key": randomUUID() },
    payload: {
      id: generateUuidV7(),
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().item.id as string;
}

async function replaceBody(pageId: string, body: unknown): Promise<void> {
  const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${pageId}` });
  const baseRevisionId = item.json().currentRevisionId as string;
  const response = await harness.built.app.inject({
    method: "PUT",
    url: `/v1/pages/${pageId}/document`,
    headers: { "idempotency-key": randomUUID() },
    payload: {
      baseRevisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 1,
        body: body as Record<string, unknown>,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

/**
 * Every envelope row, as one haystack.
 *
 * Searched for plaintext that must not be there. The needle has to be long and
 * distinctive: envelopes are base64 ciphertext, and a short word like "two"
 * occurs in random base64 often enough to fail a build for no reason — which it
 * did, on CI, on a change that touched no server code at all.
 */
async function envelopeText(): Promise<string> {
  const rows = await harness.built.database.db.execute(sql`SELECT * FROM protected_envelopes`);
  return JSON.stringify((rows as unknown as { rows: unknown[] }).rows);
}

async function envelopeTypes(): Promise<string[]> {
  const rows = await harness.built.database.db.execute(
    sql`SELECT entity_type FROM protected_envelopes ORDER BY entity_type`,
  );
  return (rows as unknown as { rows: { entity_type: string }[] }).rows.map(
    (row) => row.entity_type,
  );
}

describe("writing content through the ordinary routes", () => {
  it("seals the title", async () => {
    await createPage(SECRET_TITLE);
    expect(await envelopeTypes()).toContain("item.name");
    // And the sealed copy really is sealed.
    expect(await envelopeText()).not.toContain(SECRET_TITLE);
  });

  it("seals the page body", async () => {
    const pageId = await createPage("Notes");
    await replaceBody(pageId, { text: SECRET_BODY });
    expect(await envelopeTypes()).toContain("page.body");
    const raw = await envelopeText();
    expect(raw).not.toContain(SECRET_BODY);
    // A fragment of the secret, long enough not to occur in base64 by chance.
    expect(raw).not.toContain("digit is seven");
  });

  it("binds the title and the body separately", async () => {
    // Both belong to the same entity id. Separate entity types are what stop a
    // body being opened as a title, and the AAD is what enforces it.
    const pageId = await createPage(SECRET_TITLE);
    await replaceBody(pageId, { text: SECRET_BODY });
    const rows = await harness.built.database.db.execute(
      sql`SELECT entity_type, entity_id FROM protected_envelopes WHERE entity_id = ${pageId}::uuid`,
    );
    const types = (rows as unknown as { rows: { entity_type: string }[] }).rows.map(
      (row) => row.entity_type,
    );
    expect(new Set(types)).toEqual(new Set(["item.name", "page.body"]));
  });

  it("seals a relationship's metadata but not the edge itself", async () => {
    // FR-011 names "sensitive properties and relationships". The note saying
    // *why* two items are related is often more revealing than either title —
    // and it was reaching PostgreSQL in the clear with no envelope at all.
    const source = await createPage("Source");
    const target = await createPage("Target");
    const relationshipId = generateUuidV7();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: relationshipId,
        sourceItemId: source,
        targetItemId: target,
        relationType: "note:mentions",
        metadata: { note: SECRET_RELATION_NOTE },
      },
    });
    expect(response.statusCode, response.body).toBe(201);

    expect(await envelopeTypes()).toContain("relationship.metadata");
    const raw = await envelopeText();
    expect(raw).not.toContain(SECRET_RELATION_NOTE);
    expect(raw).not.toContain("the dismissal file");
    // The graph stays traversable without a key: both endpoints and the
    // relation type remain readable, exactly as the hierarchy does.
    const stored = await harness.built.database.db.execute(
      sql`SELECT source_item_id, target_item_id, relation_type FROM relationships WHERE id = ${relationshipId}::uuid`,
    );
    const row = (
      stored as unknown as {
        rows: { source_item_id: string; target_item_id: string; relation_type: string }[];
      }
    ).rows[0];
    expect(row?.source_item_id).toBe(source);
    expect(row?.target_item_id).toBe(target);
    expect(row?.relation_type).toBe("note:mentions");
  });

  it("keeps the identifier readable", async () => {
    // The boundary: the workspace must stay navigable without a key.
    const pageId = await createPage(SECRET_TITLE);
    expect(await envelopeText()).toContain(pageId);
  });

  it("reseals on rename rather than leaving the old title", async () => {
    const pageId = await createPage(SECRET_TITLE);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${pageId}` });
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${pageId}`,
      headers: { "idempotency-key": randomUUID() },
      payload: { name: "Shopping list", baseRevisionId: item.json().currentRevisionId },
    });
    expect(response.statusCode, response.body).toBe(200);
    // One envelope for the title, holding the new one.
    const rows = await harness.built.database.db.execute(
      sql`SELECT count(*)::int AS n FROM protected_envelopes WHERE entity_type = 'item.name'`,
    );
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
    expect(await envelopeText()).not.toContain(SECRET_TITLE);
  });

  it("seals the item emoji with its title and preserves explicit removal", async () => {
    const pageId = generateUuidV7();
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: pageId,
        kind: "page",
        name: "Private identity",
        icon: "🕵️",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "Vicon" },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const content = harness.built.context.protectedContent;
    expect(await content?.readItemPresentation(harness.built.database.db, pageId)).toEqual({
      name: "Private identity",
      icon: "🕵️",
    });
    expect(await envelopeText()).not.toContain("🕵️");

    const removed = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${pageId}`,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        baseRevisionId: (created.json() as { item: { currentRevisionId: string } }).item
          .currentRevisionId,
        icon: null,
      },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await content?.readItemPresentation(harness.built.database.db, pageId)).toEqual({
      name: "Private identity",
      icon: null,
    });
  });

  it("keeps the sealed title when an icon changes after plaintext cutover", async () => {
    const pageId = await createPage("Title kept only in its envelope");
    const before = await harness.built.app.inject({ method: "GET", url: `/v1/items/${pageId}` });
    await harness.built.database.db.execute(
      sql`UPDATE items SET name = ${SCRUBBED_PLACEHOLDER} WHERE id = ${pageId}::uuid`,
    );

    const changed = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${pageId}`,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        baseRevisionId: (before.json() as { currentRevisionId: string }).currentRevisionId,
        icon: "🔐",
      },
    });

    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().item).toMatchObject({
      name: "Title kept only in its envelope",
      icon: "🔐",
    });
    expect(
      await harness.built.context.protectedContent?.readItemPresentation(
        harness.built.database.db,
        pageId,
      ),
    ).toEqual({ name: "Title kept only in its envelope", icon: "🔐" });
  });
});

describe("protected item presentation compatibility", () => {
  it("opens legacy title envelopes and preserves an icon across title-only writes", async () => {
    const encoded = (value: unknown) => new Uint8Array(Buffer.from(JSON.stringify(value), "utf8"));
    let current: Uint8Array | null = encoded("Legacy title");
    let many = new Map<string, Uint8Array>([
      ["legacy", encoded("Legacy title")],
      ["modern", encoded({ name: "Modern title", icon: "🧭" })],
    ]);
    const records = {
      read: async () => current,
      readMany: async () => many,
      write: async (_executor: unknown, input: { payload: Uint8Array }) => {
        current = input.payload;
      },
    };
    const content = new ProtectedContent({ records: records as never });
    const executor = {} as never;

    await expect(content.readItemPresentation(executor, "legacy")).resolves.toEqual({
      name: "Legacy title",
      icon: null,
    });
    await expect(content.readItemNames(executor, ["legacy", "modern"])).resolves.toEqual(
      new Map([
        ["legacy", "Legacy title"],
        ["modern", "Modern title"],
      ]),
    );

    current = encoded({ name: "Current title", icon: "📌" });
    await content.writeItemName(executor, {
      itemId: "item",
      recordVersion: 1,
      name: "Renamed title",
    });
    expect(JSON.parse(Buffer.from(current ?? []).toString("utf8"))).toEqual({
      name: "Renamed title",
      icon: "📌",
    });

    current = null;
    await content.writeItemName(executor, {
      itemId: "fresh",
      recordVersion: 1,
      name: "Fresh title",
    });
    expect(JSON.parse(Buffer.from(current ?? []).toString("utf8"))).toEqual({
      name: "Fresh title",
      icon: null,
    });

    current = null;
    await expect(content.readItemName(executor, "missing")).resolves.toBeNull();
    many = new Map();
    await expect(content.readItemNames(executor, [])).resolves.toEqual(new Map());
    await content.writeItemName(executor, {
      itemId: "explicit",
      recordVersion: 1,
      name: "Explicit icon",
      icon: "🗺️",
    });
    expect(JSON.parse(Buffer.from(current ?? []).toString("utf8"))).toEqual({
      name: "Explicit icon",
      icon: "🗺️",
    });
  });
});

describe("structured database envelopes", () => {
  it("binds definitions and entry values to distinct protected entity types", async () => {
    const protectedContent = harness.built.context.protectedContent;
    if (protectedContent === undefined) throw new Error("security harness is not configured");
    const databaseId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const viewId = generateUuidV7();
    const entryId = generateUuidV7();
    const definition = {
      format: "myownnotion.database-definition+json" as const,
      formatVersion: 1 as const,
      databaseId,
      properties: [
        {
          id: titlePropertyId,
          name: "Portefeuille secret",
          type: "title" as const,
          positionKey: "a",
          state: "active" as const,
          config: {},
        },
      ],
      views: [
        {
          id: viewId,
          name: "Projection privée",
          type: "table" as const,
          positionKey: "a",
          state: "active" as const,
          properties: [],
          filter: { mode: "all" as const, criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable" as const, freezeTitle: true },
        },
      ],
      taskRoles: null,
    };
    const values = {
      format: "myownnotion.database-entry-values+json" as const,
      formatVersion: 1 as const,
      databaseId,
      entryId,
      values: {},
      preserved: [],
    };

    await protectedContent.writeDatabaseDefinition(harness.built.database.db, {
      databaseId,
      definitionVersion: 2,
      definition,
    });
    await protectedContent.writeDatabaseEntryValues(harness.built.database.db, {
      entryId,
      valueVersion: 4,
      values,
    });

    expect(await envelopeTypes()).toEqual(
      expect.arrayContaining(["database.definition", "database.entry-values"]),
    );
    expect(await envelopeText()).not.toContain("Portefeuille secret");
    expect(await envelopeText()).not.toContain("Projection privée");
    expect(
      await protectedContent.readDatabaseDefinition(harness.built.database.db, databaseId, 2),
    ).toEqual(definition);
    expect(
      await protectedContent.readDatabaseEntryValues(harness.built.database.db, entryId, 4),
    ).toEqual(values);
  });

  it("seals database routes, entry values and property metadata in their commit", async () => {
    const databaseId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const viewId = generateUuidV7();
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/databases",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: databaseId,
        name: "Protected projects",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
        titlePropertyId,
        initialViewId: viewId,
        initialViewName: "Protected table",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const current = created.json().database as {
      definitionRevisionId: string;
      definition: Record<string, unknown>;
    };
    const definition = {
      ...current.definition,
      properties: [
        ...((current.definition["properties"] as unknown[]) ?? []),
        {
          id: textPropertyId,
          name: "Highly confidential property label",
          type: "text",
          positionKey: "b",
          state: "active",
          config: {},
        },
        {
          id: relationPropertyId,
          name: "Private dependency",
          type: "relation",
          positionKey: "c",
          state: "active",
          config: { cardinality: "many" },
        },
      ],
      views: (current.definition["views"] as Array<Record<string, unknown>>).map((view) => ({
        ...view,
        properties: [
          ...((view["properties"] as unknown[]) ?? []),
          { propertyId: textPropertyId, visible: true, positionKey: "b" },
          { propertyId: relationPropertyId, visible: true, positionKey: "c" },
        ],
      })),
    };
    const replaced = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${databaseId}/definition`,
      headers: { "idempotency-key": randomUUID() },
      payload: { baseRevisionId: current.definitionRevisionId, definition },
    });
    expect(replaced.statusCode, replaced.body).toBe(200);

    const target = await createPage("Protected target");
    const entryId = generateUuidV7();
    const privateValue = "structured-secret-sentinel-736198";
    const entry = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: entryId,
        title: "Protected entry",
        placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "a" },
        values: { [textPropertyId]: { kind: "text", value: privateValue } },
        relationTargets: { [relationPropertyId]: [target] },
      },
    });
    expect(entry.statusCode, entry.body).toBe(201);

    const types = await envelopeTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        "database.definition",
        "database.entry-values",
        "relationship.metadata",
        "revision.snapshot",
      ]),
    );
    const envelopes = await envelopeText();
    expect(envelopes).not.toContain(privateValue);
    expect(envelopes).not.toContain("Highly confidential property label");
    const read = await harness.built.app.inject({
      method: "GET",
      url: `/v1/databases/${databaseId}/entries/${entryId}`,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().values[textPropertyId]).toEqual({ kind: "text", value: privateValue });
    expect(read.json().relationTargets[relationPropertyId]).toEqual([target]);
  });
});

describe("feature 001 is unchanged", () => {
  it("still returns the item it created", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        id: generateUuidV7(),
        kind: "page",
        name: "Ordinary page",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().item.name).toBe("Ordinary page");
    expect(response.json().item.kind).toBe("page");
  });

  it("still reads the document back", async () => {
    // Through the item route, which is where feature 001 exposes the document
    // — there is no separate read endpoint for it.
    const pageId = await createPage("Readable");
    await replaceBody(pageId, { text: "still here" });
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${pageId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pageDocument?.body).toEqual({ text: "still here" });
  });

  it("still refuses a stale base revision", async () => {
    // The conflict behaviour feature 001 guarantees must survive the dual
    // write: sealing happens after acceptance, so a rejected mutation seals
    // nothing and changes nothing.
    const pageId = await createPage("Conflict");
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${pageId}` });
    const stale = item.json().currentRevisionId as string;
    await replaceBody(pageId, { text: "first" });

    const response = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/pages/${pageId}/document`,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        baseRevisionId: stale,
        document: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { text: STALE_BODY_MARKER },
        },
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    // The refused body was never sealed.
    expect(await envelopeText()).not.toContain(STALE_BODY_MARKER);
  });

  it("replays an idempotent retry without a second envelope", async () => {
    const pageId = await createPage("Idempotent");
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${pageId}` });
    const key = randomUUID();
    const payload = {
      baseRevisionId: item.json().currentRevisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 1,
        body: { text: "once" },
      },
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await harness.built.app.inject({
        method: "PUT",
        url: `/v1/pages/${pageId}/document`,
        headers: { "idempotency-key": key },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    const rows = await harness.built.database.db.execute(
      sql`SELECT count(*)::int AS n FROM protected_envelopes WHERE entity_type = 'page.body'`,
    );
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
  });
});

describe("content and its envelope commit together", () => {
  it("rolls the whole mutation back when sealing fails", async () => {
    // The property this design exists for. Sealing runs inside the mutation's
    // transaction, so a failure there must take the content with it — a page
    // stored with no envelope would be plaintext that the migration's scrub
    // would later delete, losing it outright.
    //
    // The failure is induced the way a real one would arrive: the key
    // generation is revoked, so no data key can be produced.
    await harness.built.database.db.execute(sql`UPDATE data_key_generations SET state = 'revoked'`);
    const id = generateUuidV7();
    const mutationId = randomUUID();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": mutationId },
      payload: {
        id,
        kind: "page",
        name: "Should not survive",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    // Neither the item nor an envelope for it exists.
    const items = await harness.built.database.db.execute(
      sql`SELECT id FROM items WHERE id = ${id}::uuid`,
    );
    expect((items as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    expect(await envelopeText()).not.toContain("Should not survive");

    // And the mutation is not recorded as accepted, so a retry is a fresh
    // attempt rather than an idempotent replay of something that never
    // happened.
    const accepted = await harness.built.database.db.execute(
      sql`SELECT status FROM mutations WHERE id = ${mutationId}::uuid`,
    );
    expect((accepted as unknown as { rows: unknown[] }).rows).toHaveLength(0);

    await harness.built.database.db.execute(sql`UPDATE data_key_generations SET state = 'current'`);
  });
});

describe("history is sealed too", () => {
  it("seals the snapshot of every revision a mutation produces", async () => {
    // A snapshot is the whole record as it stood. Sealing only the current
    // title and body would leave every previous state of every page readable
    // in the clear, and a scrub of the current rows would then remove nothing
    // that mattered.
    const pageId = await createPage("Historique");
    await replaceBody(pageId, { text: SECRET_BODY });

    const revisions = await harness.built.database.db.execute(
      sql`SELECT count(*)::int AS n FROM revisions WHERE item_id = ${pageId}::uuid`,
    );
    const revisionCount = (revisions as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    expect(revisionCount).toBeGreaterThanOrEqual(2);

    const sealed = await harness.built.database.db.execute(
      sql`SELECT count(*)::int AS n FROM protected_envelopes
          WHERE entity_type = 'revision.snapshot'`,
    );
    expect((sealed as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(revisionCount);
  });

  it("leaves no plaintext body in any envelope, including the historical ones", async () => {
    const pageId = await createPage("Notes");
    await replaceBody(pageId, { text: SECRET_BODY });
    await replaceBody(pageId, { text: "a later draft" });
    const raw = await envelopeText();
    expect(raw).not.toContain(SECRET_BODY);
    expect(raw).not.toContain("a later draft");
  });

  it("seals each revision once and never rewrites it", async () => {
    // A revision is immutable. Two envelopes for one, or a rewritten one,
    // would mean history had been edited.
    const pageId = await createPage("Immutable");
    await replaceBody(pageId, { text: "first" });
    await replaceBody(pageId, { text: "second" });

    const versions = await harness.built.database.db.execute(
      sql`SELECT record_version FROM protected_envelopes WHERE entity_type = 'revision.snapshot'`,
    );
    expect(
      (versions as unknown as { rows: { record_version: number }[] }).rows.every(
        (row) => row.record_version === 1,
      ),
    ).toBe(true);

    const distinct = await harness.built.database.db.execute(
      sql`SELECT count(DISTINCT entity_id)::int AS distinct_ids, count(*)::int AS total
          FROM protected_envelopes WHERE entity_type = 'revision.snapshot'`,
    );
    const row = (distinct as unknown as { rows: { distinct_ids: number; total: number }[] })
      .rows[0];
    expect(row?.distinct_ids).toBe(row?.total);
  });
});

describe("a refused envelope leaves a trace", () => {
  it("records the rejection instead of only refusing the read", async () => {
    // An integrity failure is answered with an opaque refusal, on purpose:
    // saying which check failed is a decryption oracle. That leaves the
    // operator with nothing once the request is over — which is exactly the
    // event they most need. The refusal is now audited.
    const pageId = await createPage(SECRET_TITLE);
    // Substitution, induced the way a real one would arrive: the stored AAD
    // digest no longer describes the record the envelope sits on. Moving the
    // row to another entity id would instead read as "never written", which is
    // a different answer and not the one under test.
    await harness.built.database.db.execute(
      sql`UPDATE protected_envelopes SET aad_digest = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
          WHERE entity_id = ${pageId}::uuid AND entity_type = 'item.name'`,
    );

    // Read through the protected path directly. The ordinary route still
    // serves the plaintext column — switching reads over is the cutover step
    // of the encryption migration, not this task — so going through it would
    // succeed and prove nothing.
    const protectedContent = harness.built.context.protectedContent;
    expect(protectedContent).toBeDefined();
    await expect(
      protectedContent?.readItemName(harness.built.database.db, pageId),
    ).rejects.toThrow();

    const events = await harness.built.database.db.execute(
      sql`SELECT event_type, outcome, metadata FROM security_audit_events
          WHERE event_type = 'integrity.envelope-rejected'`,
    );
    const rows = (
      events as unknown as {
        rows: { event_type: string; outcome: string; metadata: Record<string, unknown> }[];
      }
    ).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.outcome).toBe("failure");

    // The trail must stay safe to read: a reason and the generation, never
    // ciphertext, key material, or anything that was opened.
    const trail = JSON.stringify(rows);
    expect(trail).not.toContain(SECRET_TITLE);
    expect(trail).toContain("binding-mismatch");
  });
});
