/**
 * The conversion route, and the refusal it cannot be talked out of (T033).
 *
 * The domain suite proves the rule decides correctly and the integration suite
 * proves the repository obeys it. This one asks the question that matters to
 * anyone outside the process: **can a caller get past it?**
 *
 * That is FR-014 stated as a test. A confirmation implemented in a screen
 * protects an owner on that screen; these cases go straight at the HTTP
 * surface, which is the path a script, a `curl`, or a client nobody has
 * written yet would take.
 */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

async function convert(
  itemId: Uuid,
  targetKind: "page" | "folder",
  body: Record<string, unknown> = {},
) {
  return await harness.built.app.inject({
    method: "POST",
    url: `/v1/items/${itemId}/convert`,
    headers: idempotencyHeaders(),
    payload: { targetKind, ...body },
  });
}

async function kindOf(itemId: Uuid): Promise<string> {
  const response = await harness.built.app.inject({ method: "GET", url: `/v1/items/${itemId}` });
  return response.json().kind as string;
}

async function writeDocument(itemId: Uuid, baseRevisionId: Uuid): Promise<void> {
  const response = await harness.built.app.inject({
    method: "PUT",
    url: `/v1/pages/${itemId}/document`,
    headers: idempotencyHeaders(),
    payload: {
      baseRevisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        // Real content: an empty `blocks` array is an empty document, which
        // is precisely the case that must *not* trigger the warning.
        body: {
          blocks: [
            {
              type: "paragraph",
              id: "01924f8e-7c1a-7000-8000-0000000000aa",
              content: [{ text: "something worth keeping" }],
            },
          ],
        },
      },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

describe("folder to page", () => {
  it("is accepted with no confirmation at all", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Container" });
    const response = await convert(folder.itemId, "page");
    expect(response.statusCode, response.body).toBe(200);
    expect(await kindOf(folder.itemId)).toBe("page");
  });
});

describe("page to folder", () => {
  it("is accepted when the page holds nothing", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Empty" });
    expect((await convert(page.itemId, "folder")).statusCode).toBe(200);
  });

  it("is refused when the page holds content and nothing was confirmed", async () => {
    // The case the whole design exists for. No screen is involved here.
    const page = await createItemViaApi(harness, { kind: "page", name: "Written" });
    await writeDocument(page.itemId, page.revisionId);

    const response = await convert(page.itemId, "folder");
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("conversion.confirmation-required");
    // And nothing changed.
    expect(await kindOf(page.itemId)).toBe("page");
  });

  it("is refused when confirmation is sent as false", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Written too" });
    await writeDocument(page.itemId, page.revisionId);

    const response = await convert(page.itemId, "folder", { confirmedDestruction: false });
    expect(response.statusCode).toBe(409);
    expect(await kindOf(page.itemId)).toBe("page");
  });

  it("is accepted once the owner confirms", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Agreed" });
    await writeDocument(page.itemId, page.revisionId);

    const response = await convert(page.itemId, "folder", { confirmedDestruction: true });
    expect(response.statusCode, response.body).toBe(200);
    expect(await kindOf(page.itemId)).toBe("folder");
  });
});

describe("what the route will not accept", () => {
  it("rejects a target kind that is not page or folder", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Typed" });
    const response = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${page.itemId}/convert`,
      headers: idempotencyHeaders(),
      payload: { targetKind: "file" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("does not accept a misspelled confirmation", async () => {
    // Fastify strips unknown fields rather than rejecting them, so a caller
    // sending `confirmed` and meaning `confirmedDestruction` gets the field
    // dropped. What matters is where that lands: the confirmation is absent,
    // so the destructive conversion is refused. Failing safe is the property
    // to pin here — a typo must never be read as agreement.
    const page = await createItemViaApi(harness, { kind: "page", name: "Extra" });
    await writeDocument(page.itemId, page.revisionId);

    const response = await convert(page.itemId, "folder", { confirmed: true });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("conversion.confirmation-required");
  });

  it("reports a missing item rather than converting nothing", async () => {
    const response = await convert(generateUuidV7(), "page");
    expect(response.statusCode).toBe(404);
  });
});
