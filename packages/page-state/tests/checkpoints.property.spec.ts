import { generateUuidV7 } from "@myownnotion/domain";
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
