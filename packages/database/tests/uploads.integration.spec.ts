/**
 * The upload lifecycle against a real database (T046, FR-006).
 *
 * The interesting cases are the ones where a wrong answer produces a file that
 * *completes successfully and is corrupt*, which is far worse than a transfer
 * that fails loudly:
 *
 * - a client writing from an offset the server does not hold;
 * - two requests for one upload racing each other;
 * - an upload claiming more bytes than it declared.
 *
 * Each is refused rather than accommodated.
 */

import {
  advanceUpload,
  createUpload,
  deleteUpload,
  expireUploads,
  getUpload,
  isComplete,
  pendingUploadBytes,
  schema,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

async function newUpload(declaredLength: number, now?: Date) {
  return createUpload(context.handle.db, {
    workspaceId: context.workspaceId,
    declaredLength,
    mediaType: "text/plain",
    originalName: "transfer.txt",
    ...(now === undefined ? {} : { now }),
  });
}

describe("an upload in progress", () => {
  it("starts at offset zero and knows how big it will be", async () => {
    const upload = await newUpload(1000);
    const read = await getUpload(context.handle.db, upload.id);
    expect(read?.receivedLength).toBe(0);
    expect(read?.declaredLength).toBe(1000);
    expect(isComplete(read as NonNullable<typeof read>)).toBe(false);
    await deleteUpload(context.handle.db, upload.id);
  });

  it("advances by exactly what arrived", async () => {
    const upload = await newUpload(300);
    expect(
      await advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 100 }),
    ).toEqual({ ok: true, receivedLength: 100 });
    expect(
      await advanceUpload(context.handle.db, { id: upload.id, atOffset: 100, chunkLength: 200 }),
    ).toEqual({ ok: true, receivedLength: 300 });

    const read = await getUpload(context.handle.db, upload.id);
    expect(isComplete(read as NonNullable<typeof read>)).toBe(true);
    await deleteUpload(context.handle.db, upload.id);
  });

  it("refuses a write from an offset the server does not hold", async () => {
    const upload = await newUpload(500);
    await advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 100 });

    // The client thinks it is at 200; the server holds 100. Accepting this at
    // the server's offset would silently duplicate or skip bytes inside a file
    // that then completes and verifies as though nothing had happened.
    const outcome = await advanceUpload(context.handle.db, {
      id: upload.id,
      atOffset: 200,
      chunkLength: 50,
    });
    expect(outcome).toEqual({ ok: false, reason: "offset-mismatch", expected: 100 });

    // And the upload is untouched, so the client can resume from HEAD.
    expect((await getUpload(context.handle.db, upload.id))?.receivedLength).toBe(100);
    await deleteUpload(context.handle.db, upload.id);
  });

  it("refuses more bytes than were declared", async () => {
    const upload = await newUpload(100);
    const outcome = await advanceUpload(context.handle.db, {
      id: upload.id,
      atOffset: 0,
      chunkLength: 101,
    });
    expect(outcome).toEqual({ ok: false, reason: "overflow" });
    await deleteUpload(context.handle.db, upload.id);
  });

  it("lets only one of two racing writes win", async () => {
    const upload = await newUpload(1000);
    // Both start from the same offset, as two retries of one chunk would.
    const [first, second] = await Promise.all([
      advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 100 }),
      advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 100 }),
    ]);
    const wins = [first, second].filter((outcome) => outcome.ok);
    expect(wins).toHaveLength(1);
    // Exactly one advance, not two: the conditional update is what stops the
    // loser from writing over the winner while reporting success.
    expect((await getUpload(context.handle.db, upload.id))?.receivedLength).toBe(100);
    await deleteUpload(context.handle.db, upload.id);
  });

  it("reports a missing upload rather than inventing one", async () => {
    expect(
      await advanceUpload(context.handle.db, {
        id: generateUuidV7(),
        atOffset: 0,
        chunkLength: 10,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("uploads nobody finished", () => {
  it("are reclaimed once they expire", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const abandoned = await newUpload(2000, old);
    await advanceUpload(context.handle.db, { id: abandoned.id, atOffset: 0, chunkLength: 500 });

    const reclaimed = await expireUploads(context.handle.db);
    expect(reclaimed.map((row) => row.id)).toContain(abandoned.id);
    // Gone, so the bytes can be released. Kept forever, a 2 GB abandonment is
    // the size of the largest file the product allows, occupying storage no
    // screen accounts for.
    expect(await getUpload(context.handle.db, abandoned.id)).toBeNull();
  });

  it("leaves live uploads alone", async () => {
    const live = await newUpload(400);
    await expireUploads(context.handle.db);
    expect(await getUpload(context.handle.db, live.id)).not.toBeNull();
    await deleteUpload(context.handle.db, live.id);
  });

  it("can report how much space they hold", async () => {
    const upload = await newUpload(900);
    await advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 300 });
    expect(await pendingUploadBytes(context.handle.db)).toBeGreaterThanOrEqual(300);
    await deleteUpload(context.handle.db, upload.id);
  });

  it("never becomes an item before it completes", async () => {
    const upload = await newUpload(50);
    await advanceUpload(context.handle.db, { id: upload.id, atOffset: 0, chunkLength: 25 });

    // The property the whole shape exists for: half a file is not a file.
    const items = await context.handle.db.select().from(schema.items);
    expect(items.some((item) => item.name === "transfer.txt")).toBe(false);
    await deleteUpload(context.handle.db, upload.id);
  });
});
