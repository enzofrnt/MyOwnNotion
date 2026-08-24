import { generateUuidV7 } from "@myownnotion/domain";
import { decodeImportBlobMeta } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  compareVersionVectorBytes,
  OperationalPageDocument,
  verifyIncrementalUpdateBase,
  versionVectorBytesEqual,
} from "../src/index.ts";

describe("updates, version vectors and checkpoints", () => {
  it("imports the same update idempotently", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const receiver = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const update = author.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "B" }]);

    const first = receiver.importUpdate(update.updateBytes);
    const afterFirst = receiver.versionVectorBytes();
    const repeated = receiver.importUpdate(update.updateBytes);

    expect(first.pending).toBe(false);
    expect(repeated.pending).toBe(false);
    expect(versionVectorBytesEqual(receiver.versionVectorBytes(), afterFirst)).toBe(true);
    expect((await receiver.project()).document).toEqual((await author.project()).document);
  });

  it("keeps a causally dependent update pending until its base arrives", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const receiver = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const first = author.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "B" }]);
    const second = author.transact([{ type: "replace-text", blockId, from: 2, to: 2, text: "C" }]);

    expect(receiver.importUpdate(second.updateBytes).pending).toBe(true);
    expect(receiver.importUpdate(first.updateBytes).pending).toBe(false);
    expect((await receiver.project()).document).toEqual((await author.project()).document);
  });

  it("imports a reversed causal batch atomically and resolves its pending dependencies", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const receiver = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const first = author.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "B" }]);
    const second = author.transact([{ type: "replace-text", blockId, from: 2, to: 2, text: "C" }]);

    const imported = receiver.importUpdates([second.updateBytes, first.updateBytes]);

    expect(imported).toMatchObject({ changed: true, pending: false });
    expect(receiver.snapshot()).toEqual(author.snapshot());
    expect(
      versionVectorBytesEqual(receiver.versionVectorBytes(), author.versionVectorBytes()),
    ).toBe(true);
    expect(receiver.importUpdates([])).toMatchObject({ changed: false, pending: false });
    expect(receiver.importUpdates([first.updateBytes, second.updateBytes])).toMatchObject({
      changed: false,
      pending: false,
    });
  });

  it("reports a causal batch as pending until its missing base is imported", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const receiver = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const first = author.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "B" }]);
    const second = author.transact([{ type: "replace-text", blockId, from: 2, to: 2, text: "C" }]);

    expect(receiver.importUpdates([second.updateBytes])).toMatchObject({
      changed: false,
      pending: true,
    });
    expect(receiver.importUpdates([first.updateBytes])).toMatchObject({
      changed: true,
      pending: false,
    });
    expect(receiver.snapshot()).toEqual(author.snapshot());
  });

  it("verifies the causal base declared around an incremental update", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const update = author.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "B" }]);

    expect(() =>
      verifyIncrementalUpdateBase(update.updateBytes, update.baseVersionVector),
    ).not.toThrow();
    expect(() => verifyIncrementalUpdateBase(update.updateBytes, new Uint8Array())).toThrow(
      /causal base/u,
    );
  });

  it("round-trips a verified checkpoint with a fresh peer id", async () => {
    const pageId = generateUuidV7();
    const page = OperationalPageDocument.create({ pageId, document: { blocks: [] } });
    const checkpoint = await page.checkpoint();
    const first = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const second = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

    expect(first.peerId).not.toBe(page.peerId);
    expect(second.peerId).not.toBe(first.peerId);
    expect(versionVectorBytesEqual(first.versionVectorBytes(), checkpoint.versionVector)).toBe(
      true,
    );
    expect(compareVersionVectorBytes(checkpoint.versionVector, first.versionVectorBytes())).toBe(
      "equal",
    );
  });

  it("opens a shallow checkpoint and accepts updates based on its retained frontier", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [{ type: "paragraph", id: blockId, content: [{ text: "Before" }] }],
      },
    });
    page.transact([{ type: "replace-text", blockId, from: 6, to: 6, text: " checkpoint" }]);

    const checkpoint = await page.compactedCheckpoint();
    expect(decodeImportBlobMeta(checkpoint.bytes, true).mode).toBe("shallow-snapshot");

    const restored = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    // The author intentionally keeps the original full-history document. A
    // shallow checkpoint is only useful if updates created after its frontier
    // remain importable without forcing every live client to reopen it first.
    const later = page.transact([
      { type: "replace-text", blockId, from: 17, to: 17, text: " works" },
    ]);

    expect(restored.importUpdate(later.updateBytes).pending).toBe(false);
    expect(restored.snapshot()).toEqual(page.snapshot());
    expect(versionVectorBytesEqual(restored.versionVectorBytes(), page.versionVectorBytes())).toBe(
      true,
    );
  });

  it("keeps a full replay checkpoint able to merge a branch authored before it", async () => {
    const pageId = generateUuidV7();
    const onlineBlockId = generateUuidV7();
    const offlineBlockId = generateUuidV7();
    const origin = OperationalPageDocument.create({ pageId, document: { blocks: [] } });
    const base = await origin.checkpoint();
    const online = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint: base });
    const offline = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint: base });
    const offlineUpdate = offline.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: offlineBlockId, content: [{ text: "offline" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    online.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: onlineBlockId, content: [{ text: "online" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);

    const [fullCheckpoint, shallowCheckpoint] = await Promise.all([
      online.checkpoint(),
      online.compactedCheckpoint(),
    ]);
    const fullReplay = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: fullCheckpoint,
    });
    const shallowReplay = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: shallowCheckpoint,
    });

    expect(fullReplay.importUpdate(offlineUpdate.updateBytes).pending).toBe(false);
    expect(new Set(fullReplay.snapshot().blocks.map(({ id }) => id))).toEqual(
      new Set([onlineBlockId, offlineBlockId]),
    );
    expect(() => shallowReplay.importUpdate(offlineUpdate.updateBytes)).toThrow(
      /shallow history/iu,
    );
  });

  it("rejects checkpoint identity and causal metadata drift", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "paragraph",
            id: blockId,
            content: [{ text: "Verified checkpoint" }],
          },
        ],
      },
    });
    const baseCheckpoint = await page.checkpoint();
    page.transact([{ type: "replace-text", blockId, from: 19, to: 19, text: " state" }]);
    const checkpoint = await page.checkpoint();

    await expect(
      OperationalPageDocument.fromCheckpoint({
        pageId: generateUuidV7(),
        checkpoint,
      }),
    ).rejects.toThrow(/metadata/u);

    await expect(
      OperationalPageDocument.fromCheckpoint({
        pageId,
        checkpoint: { ...checkpoint, versionVector: baseCheckpoint.versionVector },
      }),
    ).rejects.toThrow(/version vector/iu);

    await expect(
      OperationalPageDocument.fromCheckpoint({
        pageId,
        checkpoint: { ...checkpoint, frontiers: baseCheckpoint.frontiers },
      }),
    ).rejects.toThrow(/frontier/iu);
  });

  it("opens the transport fields returned by the synchronization API", async () => {
    const pageId = generateUuidV7();
    const page = OperationalPageDocument.create({ pageId, document: { blocks: [] } });
    const checkpoint = await page.checkpoint();

    const restored = await OperationalPageDocument.fromSnapshotTransport({
      pageId,
      snapshotBytes: checkpoint.bytes,
      snapshotDigest: checkpoint.digest,
      versionVector: checkpoint.versionVector,
    });

    expect(restored.snapshot()).toEqual(page.snapshot());
    expect(versionVectorBytesEqual(restored.versionVectorBytes(), checkpoint.versionVector)).toBe(
      true,
    );
  });

  it("refuses corrupted checkpoint bytes before opening the page", async () => {
    const pageId = generateUuidV7();
    const page = OperationalPageDocument.create({ pageId, document: { blocks: [] } });
    const checkpoint = await page.checkpoint();
    const corrupted = new Uint8Array(checkpoint.bytes);
    const corruptIndex = Math.floor(corrupted.length / 2);
    corrupted[corruptIndex] = (corrupted[corruptIndex] ?? 0) ^ 0xff;

    await expect(
      OperationalPageDocument.fromCheckpoint({
        pageId,
        checkpoint: { ...checkpoint, bytes: corrupted },
      }),
    ).rejects.toThrow(/digest/u);
  });

  it("orders version vectors without confusing concurrency with recency", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const base = checkpoint.versionVector;
    left.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "L" }]);
    right.transact([{ type: "replace-text", blockId, from: 1, to: 1, text: "R" }]);

    expect(compareVersionVectorBytes(base, left.versionVectorBytes())).toBe("before");
    expect(compareVersionVectorBytes(left.versionVectorBytes(), base)).toBe("after");
    expect(compareVersionVectorBytes(left.versionVectorBytes(), right.versionVectorBytes())).toBe(
      "concurrent",
    );
  });
});
