import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument } from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

async function replicas(text = "XZ") {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const origin = OperationalPageDocument.create({
    pageId,
    document: { blocks: [paragraph(blockId, text)] },
  });
  const checkpoint = await origin.checkpoint();
  const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
  const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
  return { blockId, left, right };
}

describe("rich text convergence", () => {
  it("merges concurrent character insertions made while both devices are offline", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("A", "é", "🦜", "mot"),
        fc.constantFrom("B", "à", "🚀", "note"),
        async (leftText, rightText) => {
          const { blockId, left, right } = await replicas();
          const leftUpdate = left.transact([
            { type: "replace-text", blockId, from: 1, to: 1, text: leftText },
          ]);
          const rightUpdate = right.transact([
            { type: "replace-text", blockId, from: 1, to: 1, text: rightText },
          ]);

          left.importUpdate(rightUpdate.updateBytes);
          right.importUpdate(leftUpdate.updateBytes);
          const leftProjection = await left.project();
          const rightProjection = await right.project();

          expect(canonicalDocumentJsonV3(leftProjection.document)).toBe(
            canonicalDocumentJsonV3(rightProjection.document),
          );
          const block = leftProjection.document.blocks[0];
          expect(block?.type).toBe("paragraph");
          if (block?.type !== "paragraph") return;
          const text = block.content.map((run) => run.text).join("");
          expect(text).toContain(leftText);
          expect(text).toContain(rightText);
        },
      ),
    );
  });

  it("converges concurrent formatting on distinct ranges", async () => {
    const { blockId, left, right } = await replicas("abc");
    const leftUpdate = left.transact([
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 1,
        mark: { type: "bold" },
        enabled: true,
      },
    ]);
    const rightUpdate = right.transact([
      {
        type: "set-mark",
        blockId,
        from: 1,
        to: 2,
        mark: { type: "italic" },
        enabled: true,
      },
    ]);

    right.importUpdate(leftUpdate.updateBytes);
    left.importUpdate(rightUpdate.updateBytes);
    expect(canonicalDocumentJsonV3((await left.project()).document)).toBe(
      canonicalDocumentJsonV3((await right.project()).document),
    );
  });

  it("uses the documented mark expansion policy at the right boundary", async () => {
    const { blockId, left } = await replicas("ab");
    left.transact([
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 1,
        mark: { type: "bold" },
        enabled: true,
      },
      { type: "replace-text", blockId, from: 1, to: 1, text: "B" },
    ]);
    const boldBlock = (await left.project()).document.blocks[0];
    expect(boldBlock?.type).toBe("paragraph");
    if (boldBlock?.type !== "paragraph") return;
    expect(boldBlock.content[0]).toMatchObject({ text: "aB", marks: [{ type: "bold" }] });

    const linked = await replicas("ab");
    linked.left.transact([
      {
        type: "set-mark",
        blockId: linked.blockId,
        from: 0,
        to: 1,
        mark: { type: "link", href: "https://example.com" },
        enabled: true,
      },
      { type: "replace-text", blockId: linked.blockId, from: 1, to: 1, text: "B" },
    ]);
    const linkBlock = (await linked.left.project()).document.blocks[0];
    expect(linkBlock?.type).toBe("paragraph");
    if (linkBlock?.type !== "paragraph") return;
    expect(linkBlock.content).toEqual([
      { text: "a", marks: [{ type: "link", href: "https://example.com" }] },
      { text: "Bb" },
    ]);
  });

  it("uses UTF-16 offsets without splitting emoji surrogate pairs", async () => {
    const { blockId, left } = await replicas("A🦜B");
    left.transact([{ type: "replace-text", blockId, from: 1, to: 3, text: "🚀" }]);
    const block = (await left.project()).document.blocks[0];
    expect(
      block?.type === "paragraph" ? block.content.map(({ text }) => text).join("") : null,
    ).toBe("A🚀B");
    expect(() =>
      left.transact([{ type: "replace-text", blockId, from: 2, to: 2, text: "x" }]),
    ).toThrow(/UTF-16/u);
  });
});
