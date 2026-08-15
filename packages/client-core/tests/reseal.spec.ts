/**
 * Upgrading a projection that predates the device key (T121, FR-012, FR-024).
 *
 * An owner who has been running an earlier client has a local database full of
 * readable titles. This is what converts it, and the properties that matter are
 * the ones that decide whether an interrupted upgrade is recoverable.
 *
 * The pass deliberately runs outside any transaction, because Dexie's own
 * upgrade hook cannot do this work: upgrades run inside a version-change
 * transaction, and sealing is WebCrypto, which ends that transaction the moment
 * it is awaited. A migration written the obvious way would appear to succeed
 * and reseal nothing.
 */

import type { LocalRecordCodec } from "@myownnotion/client-core";
import {
  type LocalDatabase,
  type LocalItemRow,
  openLocalDatabase,
  resealPlaintextProjection,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`test-${generateUuidV7()}`);
});

afterEach(async () => {
  await db.delete();
});

function plaintextRow(name: string): LocalItemRow {
  return {
    id: generateUuidV7() as Uuid,
    kind: "page",
    name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7() as Uuid,
    trashedAt: null,
    purgeAfter: null,
    pageDocument: { format: "myownnotion.document+json", formatVersion: 1, body: { text: name } },
    file: null,
  };
}

/** Writes a row in the shape an older client would have left behind. */
async function seedPlaintext(name: string): Promise<Uuid> {
  const row = plaintextRow(name);
  await db.items.add(row as never);
  return row.id;
}

describe("upgrading a plaintext projection", () => {
  it("seals every readable row", async () => {
    await seedPlaintext("The quarterly figures");
    await seedPlaintext("Notes from the appointment");

    const outcome = await resealPlaintextProjection(db, codec);

    expect(outcome.resealed).toBe(2);
    // The property an owner is relying on: what is on disk afterwards carries
    // no prose.
    const stored = JSON.stringify(await db.items.toArray());
    expect(stored).not.toContain("quarterly");
    expect(stored).not.toContain("appointment");
  });

  it("keeps the content readable through the codec", async () => {
    const id = await seedPlaintext("The quarterly figures");
    await resealPlaintextProjection(db, codec);

    const row = await db.items.get(id);
    expect(row).toBeDefined();
    // Sealed is not lost. An upgrade that protected the data by making it
    // unreadable would be a data loss with a security-shaped explanation.
    expect((await codec.openItem(row as never)).name).toBe("The quarterly figures");
  });

  it("preserves every identity the projection reconciles on", async () => {
    const id = await seedPlaintext("Anything");
    const before = await db.items.get(id);

    await resealPlaintextProjection(db, codec);

    const after = await db.items.get(id);
    // The identifiers are how the outbox and the change cursor find their
    // rows again. Changing one during an upgrade would orphan queued work
    // that has not reconciled yet.
    expect(after?.id).toBe(before?.id);
    expect(after?.currentRevisionId).toBe(before?.currentRevisionId);
    expect(after?.kind).toBe(before?.kind);
    expect(after?.lifecycle).toBe(before?.lifecycle);
  });

  it("is idempotent", async () => {
    await seedPlaintext("Once");
    await resealPlaintextProjection(db, codec);

    const second = await resealPlaintextProjection(db, codec);

    // A second pass finds nothing to do. Double-sealing would produce a row
    // that opens to ciphertext — readable by nothing, and indistinguishable
    // from corruption.
    expect(second.resealed).toBe(0);
    expect(second.alreadySealed).toBe(1);
  });

  it("finishes the job after an interrupted pass", async () => {
    await seedPlaintext("First");
    await seedPlaintext("Second");
    // As an interruption would leave it: one row converted, one not.
    const rows = await db.items.toArray();
    const first = rows[0] as unknown as LocalItemRow;
    await db.items.put(await codec.sealItem(first));

    const outcome = await resealPlaintextProjection(db, codec);

    expect(outcome.alreadySealed).toBe(1);
    expect(outcome.resealed).toBe(1);
  });

  it("leaves a row it cannot classify exactly as it found it", async () => {
    // Neither shape. Deleting it would be destroying content to make the
    // migration's report look clean.
    await db.items.add({ id: generateUuidV7(), kind: "page" } as never);

    const outcome = await resealPlaintextProjection(db, codec);

    expect(outcome.skipped).toBe(1);
    expect(await db.items.count()).toBe(1);
  });

  it("does nothing to an empty projection", async () => {
    const outcome = await resealPlaintextProjection(db, codec);
    expect(outcome).toEqual({ resealed: 0, alreadySealed: 0, skipped: 0 });
  });
});
