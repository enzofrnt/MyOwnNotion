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
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const SECRET_TITLE = "Codes for the safe";
const SECRET_BODY = "the third digit is seven";
const SECRET_RELATION_NOTE = "cited in the dismissal file";

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

/** Every envelope row, as one haystack. */
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
    expect(raw).not.toContain("seven");
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
    expect(raw).not.toContain("dismissal");
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
        document: { format: "myownnotion.document+json", formatVersion: 1, body: { text: "two" } },
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    // The refused body was never sealed.
    expect(await envelopeText()).not.toContain("two");
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
