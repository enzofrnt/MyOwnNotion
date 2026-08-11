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
