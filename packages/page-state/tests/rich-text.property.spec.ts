import {
  canonicalDocumentJsonV3,
  generateUuidV7,
  type InlineV3,
  type Uuid,
} from "@myownnotion/domain";
import fc from "fast-check";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  configureRichText,
  createRelativeTextPosition,
  initialiseRichText,
  OperationalPageDocument,
  projectRichText,
  RichTextOperationError,
  replaceRichText,
  resolveRelativeTextPosition,
  setRichTextMark,
} from "../src/index.ts";

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

function richText(content: readonly InlineV3[]) {
  const doc = new LoroDoc();
  configureRichText(doc);
  const text = doc.getText("content");
  initialiseRichText(text, content);
  doc.commit();
  return { doc, text };
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

  it("does not reattach a deleted page link to replacement typing", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const targetItemId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "paragraph",
            id: blockId,
            content: [
              { text: "ancienne " },
              { text: "référence", marks: [{ type: "pageLink", targetItemId }] },
            ],
          },
        ],
      },
    });

    page.transact([
      {
        type: "set-mark",
        blockId,
        from: "ancienne ".length,
        to: "ancienne référence".length,
        mark: { type: "pageLink", targetItemId },
        enabled: false,
      },
      {
        type: "replace-text",
        blockId,
        from: 0,
        to: "ancienne référence".length,
        text: "t",
      },
    ]);
    page.transact([
      {
        type: "replace-text",
        blockId,
        from: 1,
        to: 1,
        text: "exte entièrement neuf",
      },
    ]);

    const block = (await page.project()).document.blocks[0];
    expect(block?.type).toBe("paragraph");
    if (block?.type !== "paragraph") return;
    expect(block.content).toEqual([{ text: "texte entièrement neuf" }]);
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

  it("round-trips every canonical mark, including opaque future marks", () => {
    const targetItemId = generateUuidV7();
    const content: InlineV3[] = [
      {
        text: "style",
        marks: [
          { type: "bold" },
          { type: "italic" },
          { type: "underline" },
          { type: "strikethrough" },
          { type: "link", href: "https://example.com" },
          { type: "pageLink", targetItemId },
          { type: "textColor", color: "blue" },
          { type: "backgroundColor", color: "yellow" },
          {
            type: "unknown",
            declaredType: "futureMark",
            raw: { type: "futureMark", options: { level: 2 }, flags: [true, null] },
          },
        ],
      },
      { text: "code", marks: [{ type: "code" }] },
      { text: "plain" },
    ];
    const { text } = richText(content);

    expect(projectRichText(text)).toEqual(content);
  });

  it("applies and removes marks while keeping code mutually exclusive", () => {
    const { text } = richText([{ text: "abc", marks: [{ type: "bold" }] }]);
    setRichTextMark(text, 0, 2, { type: "code" }, true);
    expect(projectRichText(text)).toEqual([
      { text: "ab", marks: [{ type: "code" }] },
      { text: "c", marks: [{ type: "bold" }] },
    ]);

    setRichTextMark(text, 0, 2, { type: "italic" }, true);
    setRichTextMark(text, 0, 2, { type: "italic" }, false);
    expect(projectRichText(text)).toEqual([
      { text: "ab" },
      { text: "c", marks: [{ type: "bold" }] },
    ]);
    expect(() => setRichTextMark(text, 1, 1, { type: "bold" }, true)).toThrow(/must not be empty/u);
  });

  it("adds, deduplicates and removes opaque marks by canonical value", () => {
    const opaque = {
      type: "unknown" as const,
      declaredType: "future",
      raw: { type: "future", z: 2, a: [1, { nested: true }] },
    };
    const { text } = richText([{ text: "abc" }]);
    setRichTextMark(text, 0, 3, opaque, true);
    setRichTextMark(text, 0, 3, opaque, true);
    expect(projectRichText(text)[0]?.marks).toEqual([opaque]);
    setRichTextMark(text, 0, 3, opaque, false);
    expect(projectRichText(text)).toEqual([{ text: "abc" }]);
  });

  it("rejects invalid text, control characters and ranges before mutating", () => {
    const { text } = richText([{ text: "A🦜B" }]);
    const before = text.toString();

    expect(() => replaceRichText(text, 3, 2, "x", false)).toThrow(/UTF-16/u);
    expect(() => replaceRichText(text, 2, 2, "x", false)).toThrow(/UTF-16/u);
    expect(() => replaceRichText(text, 0, 0, String.fromCharCode(0xd800), false)).toThrow(
      /Unicode/u,
    );
    expect(() => replaceRichText(text, 0, 0, String.fromCharCode(0xdc00), false)).toThrow(
      /Unicode/u,
    );
    expect(() => replaceRichText(text, 0, 0, "\u0001", false)).toThrow(/control/u);
    expect(() => replaceRichText(text, 0, 0, "\t", false)).toThrow(/control/u);
    expect(() => replaceRichText(text, 0, 0, "\t\n", true)).not.toThrow();
    expect(text.toString()).toBe(`\t\n${before}`);
    expect(() => replaceRichText(text, 0, 0, "", false)).not.toThrow();
  });

  it("encodes relative cursor positions and rejects split surrogate positions", () => {
    const { doc, text } = richText([{ text: "A🦜B" }]);
    const cursor = createRelativeTextPosition(text, 3, 1);
    expect(resolveRelativeTextPosition(doc, cursor)).toEqual({ offset: 3, side: 1 });
    expect(() => createRelativeTextPosition(text, 2)).toThrow(RichTextOperationError);
    const other = richText([{ text: "other" }]);
    expect(resolveRelativeTextPosition(other.doc, cursor)).toBeUndefined();
    expect(() => resolveRelativeTextPosition(doc, new Uint8Array([0]))).toThrow();
  });

  it.each([
    ["bold", false, /bold must be true/u],
    ["link", "bad", /link must be an object/u],
    ["link", {}, /link.href must be a string/u],
    ["pageLink", { itemId: "not-a-uuid" }, /must be a UUID/u],
    ["textColor", 3, /must be a string/u],
    ["backgroundColor", "cyan", /canonical color token/u],
    ["unknownMarks", "bad", /must be an array/u],
    ["unknownMarks", ["bad"], /must be an object/u],
    ["unknownMarks", [{ value: 1 }], /must declare a type/u],
  ] as const)("refuses malformed %s attributes", (key, value, expected) => {
    const { text } = richText([{ text: "x" }]);
    text.mark({ start: 0, end: 1 }, key, value);
    expect(() => projectRichText(text)).toThrow(expected);
  });

  it("preserves an unrecognised Loro attribute as an opaque mark", () => {
    const { doc, text } = richText([{ text: "x" }]);
    doc.configTextStyle({ futureAttribute: { expand: "none" } });
    text.mark({ start: 0, end: 1 }, "futureAttribute", { nested: [1, true] });
    expect(projectRichText(text)).toEqual([
      {
        text: "x",
        marks: [
          {
            type: "unknown",
            declaredType: "loroAttribute",
            raw: {
              type: "loroAttribute",
              key: "futureAttribute",
              value: { nested: [1, true] },
            },
          },
        ],
      },
    ]);
  });
});
