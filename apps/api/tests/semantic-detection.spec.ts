/** Unit coverage for projection-diff semantic records and ambiguity edges. */

import { type CanonicalBlockV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { semanticRecordFromProjectionDiff } from "../src/page-state/semantic-detection.ts";

const PAGE = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f23a1" as Uuid;

function paragraph(id: Uuid, text: string): CanonicalBlockV3 {
  return { type: "paragraph", id, content: [{ text }] };
}

function callout(id: Uuid, text: string, tone: string): CanonicalBlockV3 {
  return {
    type: "callout",
    id,
    content: [{ text }],
    icon: "💡",
    tone: tone as "default",
  };
}

describe("semantic records from projection diffs", () => {
  it("records a bounded text replacement", () => {
    const id = generateUuidV7();
    const record = semanticRecordFromProjectionDiff({
      updateId: id,
      baseVersionVector: new Uint8Array([1]),
      resultVersionVector: new Uint8Array([2]),
      beforeBlocks: [paragraph(id, "hello world")],
      afterBlocks: [paragraph(id, "hello brave world")],
    });
    expect(record.semanticChanges).toHaveLength(1);
    const change = record.semanticChanges[0];
    expect(change?.type).toBe("text-replaced");
    if (change?.type !== "text-replaced") return;
    // « world » survives as the common suffix; the insertion sits between
    // the shared prefix and that suffix.
    expect(change.from).toBe(6);
    expect(change.to).toBe(6);
    expect(change.removedText).toBe("");
    expect(change.insertedLength).toBe(6);
    expect(change.blockAfter).toEqual(paragraph(id, "hello brave world"));
  });

  it("records an identical-text rewrite as no change", () => {
    const id = generateUuidV7();
    const record = semanticRecordFromProjectionDiff({
      updateId: id,
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [paragraph(id, "same")],
      afterBlocks: [paragraph(id, "same")],
    });
    expect(record.semanticChanges).toHaveLength(0);
  });

  it("records a type change with both alternatives", () => {
    const id = generateUuidV7();
    const record = semanticRecordFromProjectionDiff({
      updateId: id,
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [paragraph(id, "texte")],
      afterBlocks: [callout(id, "texte", "yellow")],
    });
    const change = record.semanticChanges[0];
    expect(change?.type).toBe("block-type-set");
    if (change?.type !== "block-type-set") return;
    expect(change.beforeType).toBe("paragraph");
    expect(change.afterType).toBe("callout");
    expect(change.blockAfter.type).toBe("callout");
  });

  it("records each changed callout property separately", () => {
    const id = generateUuidV7();
    const record = semanticRecordFromProjectionDiff({
      updateId: id,
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [callout(id, "t", "yellow")],
      afterBlocks: [callout(id, "t", "gray")],
    });
    expect(record.semanticChanges).toHaveLength(1);
    const change = record.semanticChanges[0];
    expect(change?.type).toBe("block-property-set");
    if (change?.type !== "block-property-set") return;
    expect(change.key).toBe("tone");
    expect(change.before).toBe("yellow");
    expect(change.after).toBe("gray");
  });

  it("records deletions with the full subtree and placement", () => {
    const kept = generateUuidV7();
    const removed = generateUuidV7();
    const record = semanticRecordFromProjectionDiff({
      updateId: generateUuidV7(),
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [paragraph(removed, "à supprimer"), paragraph(kept, "reste")],
      afterBlocks: [paragraph(kept, "reste")],
    });
    const change = record.semanticChanges[0];
    expect(change?.type).toBe("block-deleted");
    if (change?.type !== "block-deleted") return;
    expect(change.blockBefore.id).toBe(removed);
    expect(change.placementBefore.beforeBlockId).toBe(kept);
  });

  it("records image and embed property changes by their own keys", () => {
    const id = generateUuidV7();
    const before: CanonicalBlockV3 = {
      type: "image",
      id,
      fileItemId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f23b1" as Uuid,
      caption: "avant",
      altText: null,
      displayWidth: null,
    };
    const after: CanonicalBlockV3 = {
      type: "image",
      id,
      fileItemId: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f23b1" as Uuid,
      caption: "après",
      altText: "une image",
      displayWidth: 320,
    };
    const record = semanticRecordFromProjectionDiff({
      updateId: generateUuidV7(),
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [before],
      afterBlocks: [after],
    });
    const keys = new Set(
      record.semanticChanges
        .filter((change) => change.type === "block-property-set")
        .map((change) => (change.type === "block-property-set" ? change.key : "")),
    );
    expect(keys).toEqual(new Set(["caption", "altText", "displayWidth"]));
  });

  it("keeps surrogate pairs intact when trimming the shared suffix", () => {
    const id = generateUuidV7();
    // The emoji is a surrogate pair; the diff must not split it.
    const record = semanticRecordFromProjectionDiff({
      updateId: generateUuidV7(),
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [paragraph(id, "👋 a")],
      afterBlocks: [paragraph(id, "👋 b")],
    });
    const change = record.semanticChanges[0];
    expect(change?.type).toBe("text-replaced");
    if (change?.type !== "text-replaced") return;
    expect(change.from).toBe(3);
    expect(change.to).toBe(4);
    expect(change.removedText).toBe("a");
  });

  it("treats an unknown block type as carrying no comparable properties", () => {
    const id = generateUuidV7();
    const unknown = (text: string): CanonicalBlockV3 =>
      ({
        type: "unknown",
        id,
        declaredType: "futureWidget",
        raw: { text },
        syntheticId: false,
      }) as CanonicalBlockV3;
    const record = semanticRecordFromProjectionDiff({
      updateId: generateUuidV7(),
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [unknown("a")],
      afterBlocks: [unknown("b")],
    });
    // Opaque payloads stay out of property-level and text-level conflict
    // detection entirely: nothing comparable leaked.
    expect(record.semanticChanges).toHaveLength(0);
  });

  it("carries the page identity through the record envelope", () => {
    const record = semanticRecordFromProjectionDiff({
      updateId: PAGE,
      baseVersionVector: new Uint8Array(),
      resultVersionVector: new Uint8Array(),
      beforeBlocks: [],
      afterBlocks: [],
    });
    expect(record.updateId).toBe(PAGE);
    expect(record.semanticChanges).toHaveLength(0);
  });
});
