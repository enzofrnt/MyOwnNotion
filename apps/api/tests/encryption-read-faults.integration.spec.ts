/**
 * What a corrupted envelope does to a request (T053, US4, FR-013, FR-014, FR-023).
 *
 * This suite could not be written before the encrypted-read cutover, and the
 * reason is the point of the cutover: until the routes read the sealed copy, a
 * corrupted envelope changed nothing they returned. The tests would have
 * passed against an application that never decrypted anything.
 *
 * Now they mean something. Each case takes a stored envelope apart one field
 * at a time and asserts two things:
 *
 *   - **the request fails rather than returning partial or substituted data.**
 *     A record that comes back with the wrong title is worse than one that
 *     comes back as an error, because nothing downstream can tell.
 *   - **every failure looks identical from outside.** A flipped tag, a
 *     substituted row, a revoked generation and a missing key all produce the
 *     same problem code. Distinguishing them would turn the route into an
 *     oracle that answers questions about the ciphertext.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { schema } from "@myownnotion/database";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const SECRET = "the combination is 19-04-77";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-read-faults-"));
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

/** Creates a page through the ordinary route, which seals its title. */
async function createPage(name: string): Promise<string> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/items",
    headers: { "idempotency-key": randomUUID() },
    payload: {
      id: randomUUID(),
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().item.id as string;
}

async function fetchItem(itemId: string) {
  return await harness.built.app.inject({ method: "GET", url: `/v1/items/${itemId}` });
}

describe("the cutover itself", () => {
  it("serves the sealed title rather than the plaintext column", async () => {
    // The property that makes every other test in this file meaningful. If the
    // route still read the column, corrupting the envelope would change
    // nothing and these assertions would pass against an application that
    // never decrypts.
    const itemId = await createPage(SECRET);

    await harness.built.database.db
      .update(schema.items)
      .set({ name: "a different value in the column" })
      .where(eq(schema.items.id, itemId));

    const response = await fetchItem(itemId);
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe(SECRET);
  });

  it("falls back to the column when no envelope exists", async () => {
    // An installation that has never been migrated still works. That is what
    // makes the migration safe to begin: nothing breaks before it finishes.
    const itemId = await createPage(SECRET);
    await harness.built.database.db
      .delete(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, itemId));
    await harness.built.database.db
      .update(schema.items)
      .set({ name: "the pre-migration title" })
      .where(eq(schema.items.id, itemId));

    const response = await fetchItem(itemId);
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe("the pre-migration title");
  });

  it("refuses when the column was scrubbed and the envelope is gone", async () => {
    // The one case where falling back would serve a placeholder as content.
    // A record that looks present and empty is worse than one that errors,
    // because nothing downstream can tell it apart from an empty title.
    const itemId = await createPage(SECRET);
    await harness.built.database.db
      .delete(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, itemId));
    await harness.built.database.db
      .update(schema.items)
      .set({ name: "�" })
      .where(eq(schema.items.id, itemId));

    const response = await fetchItem(itemId);
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("protected_read_failed");
  });
});

describe("a corrupted envelope", () => {
  async function corrupt(itemId: string, patch: Record<string, unknown>): Promise<void> {
    await harness.built.database.db
      .update(schema.protectedEnvelopes)
      .set(patch)
      .where(eq(schema.protectedEnvelopes.entityId, itemId));
  }

  it("fails rather than returning the plaintext column", async () => {
    const itemId = await createPage(SECRET);
    await harness.built.database.db
      .update(schema.items)
      .set({ name: "the column still holds this" })
      .where(eq(schema.items.id, itemId));
    await corrupt(itemId, { ciphertext: "AAAA" });

    const response = await fetchItem(itemId);
    // Silently serving the column would be the worst available behaviour: the
    // request succeeds, the caller gets a title, and nobody learns that the
    // protected copy is broken.
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain("the column still holds this");
  });

  it("fails on a flipped tag", async () => {
    const itemId = await createPage(SECRET);
    await corrupt(itemId, { tag: Buffer.alloc(16).toString("base64url") });
    expect((await fetchItem(itemId)).statusCode).not.toBe(200);
  });

  it("fails on a substituted nonce", async () => {
    const itemId = await createPage(SECRET);
    await corrupt(itemId, { nonce: Buffer.alloc(12, 7).toString("base64url") });
    expect((await fetchItem(itemId)).statusCode).not.toBe(200);
  });

  it("fails when one record's ciphertext is planted on another", async () => {
    // The AAD binds the entity, so a ciphertext moved between records must not
    // authenticate — otherwise an attacker with write access could swap two
    // titles and both requests would succeed with the wrong answers.
    //
    // Planting the *contents* of one envelope on another row, rather than
    // relabelling the row itself: relabelling makes the envelope invisible to
    // this item, which correctly falls back to the column and is a different
    // test.
    const victim = await createPage(SECRET);
    const other = await createPage("someone else's title");
    const donor = await harness.built.database.db
      .select()
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, other));
    const source = donor[0];
    expect(source).toBeDefined();

    await corrupt(victim, {
      nonce: source?.nonce ?? "",
      ciphertext: source?.ciphertext ?? "",
      tag: source?.tag ?? "",
      aadDigest: source?.aadDigest ?? "",
    });

    const response = await fetchItem(victim);
    expect(response.statusCode).not.toBe(200);
    // And emphatically not the other record's title.
    expect(response.body).not.toContain("someone else's title");
  });

  it("fails when the generation is changed", async () => {
    const itemId = await createPage(SECRET);
    await corrupt(itemId, { keyGeneration: 99 });
    expect((await fetchItem(itemId)).statusCode).not.toBe(200);
  });
});

describe("what the failures have in common", () => {
  it("report the same code whatever was wrong", async () => {
    const codes = new Set<string>();
    for (const patch of [
      { ciphertext: "AAAA" },
      { tag: Buffer.alloc(16).toString("base64url") },
      { keyGeneration: 99 },
    ]) {
      const itemId = await createPage(SECRET);
      await harness.built.database.db
        .update(schema.protectedEnvelopes)
        .set(patch)
        .where(eq(schema.protectedEnvelopes.entityId, itemId));
      const response = await fetchItem(itemId);
      codes.add(response.json().code ?? String(response.statusCode));
    }

    // One code for every fault. Distinguishing them would answer questions
    // about the ciphertext that nobody legitimate needs answered.
    expect(codes.size).toBe(1);
  });

  it("never quote the plaintext or the key back", async () => {
    const itemId = await createPage(SECRET);
    await harness.built.database.db
      .update(schema.protectedEnvelopes)
      .set({ ciphertext: "AAAA" })
      .where(eq(schema.protectedEnvelopes.entityId, itemId));

    const response = await fetchItem(itemId);
    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toMatch(/key|envelope|nonce|generation/i);
  });
});
