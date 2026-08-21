import {
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  generateUuidV7,
  type Uuid,
  validateDocumentV3,
} from "@myownnotion/domain";
import fc from "fast-check";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  BlockTreeOperationError,
  configureRichText,
  deleteOperationalBlock,
  findOperationalNode,
  getOperationalBlockTree,
  initialiseOperationalBlockTree,
  insertOperationalBlock,
  isTransformableBlockType,
  materialiseOperationalDocument,
  moveOperationalBlock,
  OperationalPageDocument,
  operationalBlockPlacement,
  operationalBlockProperty,
  operationalBlockSnapshot,
  operationalTextForBlock,
  PageCommandError,
  setOperationalBlockProperty,
  transformOperationalBlockType,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

function operational(document: BlockDocumentV3): LoroDoc {
  const doc = new LoroDoc();
  configureRichText(doc);
  initialiseOperationalBlockTree(doc, document);
  return doc;
}

describe("the movable operational block tree", () => {
  it("converges concurrent insertions at the same position with every identity intact", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("gauche", "left"),
        fc.constantFrom("droite", "right"),
        async (a, b) => {
          const pageId = generateUuidV7();
          const anchorId = generateUuidV7();
          const leftId = generateUuidV7();
          const rightId = generateUuidV7();
          const origin = OperationalPageDocument.create({
            pageId,
            document: { blocks: [paragraph(anchorId, "Ancre")] },
          });
          const checkpoint = await origin.checkpoint();
          const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
          const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

          const leftUpdate = left.transact([
            {
              type: "insert-block",
              block: paragraph(leftId, a),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          const rightUpdate = right.transact([
            {
              type: "insert-block",
              block: paragraph(rightId, b),
              parentBlockId: null,
              beforeBlockId: anchorId,
            },
          ]);
          left.importUpdate(rightUpdate.updateBytes);
          right.importUpdate(leftUpdate.updateBytes);

          const leftDocument = (await left.project()).document;
          const rightDocument = (await right.project()).document;
          expect(canonicalDocumentJsonV3(leftDocument)).toBe(
            canonicalDocumentJsonV3(rightDocument),
          );
          expect(new Set(leftDocument.blocks.map(({ id }) => id))).toEqual(
            new Set([anchorId, leftId, rightId]),
          );
        },
      ),
    );
  });

  it("converges independent concurrent moves", async () => {
    const pageId = generateUuidV7();
    const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: ids.map((id, index) => paragraph(id, String(index))) },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftUpdate = left.transact([
      { type: "move-block", blockId: ids[3], parentBlockId: null, beforeBlockId: ids[0] },
    ]);
    const rightUpdate = right.transact([
      { type: "move-block", blockId: ids[1], parentBlockId: null, beforeBlockId: null },
    ]);

    right.importUpdate(leftUpdate.updateBytes);
    left.importUpdate(rightUpdate.updateBytes);
    expect(canonicalDocumentJsonV3((await left.project()).document)).toBe(
      canonicalDocumentJsonV3((await right.project()).document),
    );
    expect(new Set((await left.project()).document.blocks.map(({ id }) => id))).toEqual(
      new Set(ids),
    );
  });

  it("rejects a cycle without changing the tree", async () => {
    const pageId = generateUuidV7();
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "toggle",
            id: parentId,
            content: [{ text: "Parent" }],
            children: [
              {
                type: "toggle",
                id: childId,
                content: [{ text: "Enfant" }],
              },
            ],
          },
        ],
      },
    });
    const before = canonicalDocumentJsonV3((await page.project()).document);

    expect(() =>
      page.transact([
        {
          type: "move-block",
          blockId: parentId,
          parentBlockId: childId,
          beforeBlockId: null,
        },
      ]),
    ).toThrow(PageCommandError);
    expect(canonicalDocumentJsonV3((await page.project()).document)).toBe(before);
  });

  it("round-trips every V1 block shape, opaque fields and an unknown block", async () => {
    const unknown = validateDocumentV3({
      blocks: [
        {
          type: "futureWidget",
          id: generateUuidV7(),
          payload: { nested: [true, 3, null] },
        },
      ],
    });
    if (!unknown.ok) throw new Error("unknown block fixture should be valid");
    const unknownBlock = unknown.document.blocks[0];
    if (unknownBlock === undefined) throw new Error("unknown block fixture is empty");
    const tableCellId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          ...paragraph(generateUuidV7(), "Paragraphe"),
          rawExtraProperties: { future: { enabled: true } },
        },
        { type: "heading", id: generateUuidV7(), level: 2, content: [{ text: "Titre" }] },
        {
          type: "bulletedListItem",
          id: generateUuidV7(),
          content: [{ text: "Puce" }],
          children: [paragraph(generateUuidV7(), "Enfant")],
        },
        {
          type: "numberedListItem",
          id: generateUuidV7(),
          content: [{ text: "Numéro" }],
        },
        {
          type: "checkbox",
          id: generateUuidV7(),
          checked: true,
          content: [{ text: "À faire" }],
        },
        { type: "quote", id: generateUuidV7(), content: [{ text: "Citation" }] },
        { type: "code", id: generateUuidV7(), text: "const x = 1;", language: "ts" },
        { type: "divider", id: generateUuidV7() },
        {
          type: "toggle",
          id: generateUuidV7(),
          content: [{ text: "Détails" }],
          children: [paragraph(generateUuidV7(), "Contenu")],
        },
        {
          type: "callout",
          id: generateUuidV7(),
          content: [{ text: "Conseil" }],
          icon: "💡",
          tone: "yellow",
          children: [paragraph(generateUuidV7(), "Suite")],
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: 240 }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [
                {
                  id: tableCellId,
                  content: [{ text: "Cellule" }],
                  children: [paragraph(generateUuidV7(), "Sous-bloc")],
                },
              ],
            },
          ],
        },
        {
          type: "image",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: "Vue",
          altText: "Aperçu",
          displayWidth: 640,
        },
        {
          type: "fileEmbed",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: null,
        },
        {
          type: "embed",
          id: generateUuidV7(),
          provider: "github",
          sourceUrl: "https://github.com/enzofrnt/MyOwnNotion",
          caption: "Dépôt",
        },
        unknownBlock,
      ],
    };
    const doc = operational(document);

    expect(canonicalDocumentJsonV3(materialiseOperationalDocument(doc))).toBe(
      canonicalDocumentJsonV3(document),
    );
    expect(operationalBlockSnapshot(doc, tableCellId).type).toBe("table");
  });

  it("supports properties, transformations and editable text capabilities", () => {
    const paragraphId = generateUuidV7();
    const containerId = generateUuidV7();
    const childId = generateUuidV7();
    const codeId = generateUuidV7();
    const dividerId = generateUuidV7();
    const imageId = generateUuidV7();
    const cellId = generateUuidV7();
    const doc = operational({
      blocks: [
        paragraph(paragraphId, "Texte"),
        {
          type: "toggle",
          id: containerId,
          content: [{ text: "Parent" }],
          children: [paragraph(childId, "Enfant")],
        },
        { type: "code", id: codeId, text: "code", language: null },
        { type: "divider", id: dividerId },
        {
          type: "image",
          id: imageId,
          fileItemId: generateUuidV7(),
          caption: null,
          altText: null,
          displayWidth: null,
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [{ id: cellId, content: [{ text: "cell" }] }],
            },
          ],
        },
      ],
    });

    expect(isTransformableBlockType("heading")).toBe(true);
    expect(isTransformableBlockType("image")).toBe(false);
    expect(isTransformableBlockType(3)).toBe(false);
    expect(operationalBlockProperty(doc, paragraphId, "future")).toBeUndefined();
    setOperationalBlockProperty(doc, paragraphId, "future", { nested: [1, true] });
    expect(operationalBlockProperty(doc, paragraphId, "future")).toEqual({ nested: [1, true] });
    expect(() => operationalBlockProperty(doc, paragraphId, "content")).toThrow(/structural/u);
    expect(() => setOperationalBlockProperty(doc, paragraphId, "id", "other")).toThrow(
      /structural/u,
    );

    transformOperationalBlockType(doc, paragraphId, "heading", { level: 3 });
    expect(operationalBlockSnapshot(doc, paragraphId)).toMatchObject({
      type: "heading",
      level: 3,
    });
    transformOperationalBlockType(doc, paragraphId, "checkbox", undefined);
    expect(operationalBlockSnapshot(doc, paragraphId)).toMatchObject({
      type: "checkbox",
      checked: false,
    });
    transformOperationalBlockType(doc, paragraphId, "code", undefined);
    expect(operationalTextForBlock(doc, paragraphId)).toMatchObject({
      allowsMarks: false,
      allowsCodeControls: true,
    });
    expect(operationalTextForBlock(doc, codeId).allowsCodeControls).toBe(true);
    expect(operationalTextForBlock(doc, cellId).allowsMarks).toBe(true);
    expect(() => operationalTextForBlock(doc, dividerId)).toThrow(/no editable text/u);
    expect(() => transformOperationalBlockType(doc, imageId, "paragraph", undefined)).toThrow(
      /cannot be transformed/u,
    );
    expect(() => transformOperationalBlockType(doc, containerId, "code", undefined)).toThrow(
      /cannot retain/u,
    );
  });

  it("validates placements and protects internal table identities", () => {
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const doc = operational({
      blocks: [
        paragraph(firstId, "A"),
        paragraph(secondId, "B"),
        {
          type: "toggle",
          id: parentId,
          content: [{ text: "Parent" }],
          children: [paragraph(childId, "Child")],
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [{ id: rowId, cells: [{ id: cellId, content: [] }] }],
        },
      ],
    });

    expect(operationalBlockPlacement(doc, firstId)).toEqual({
      parentBlockId: null,
      beforeBlockId: secondId,
    });
    expect(operationalBlockPlacement(doc, childId)).toEqual({
      parentBlockId: parentId,
      beforeBlockId: null,
    });
    expect(() =>
      insertOperationalBlock(doc, paragraph(generateUuidV7(), "bad"), parentId, secondId),
    ).toThrow(/not under/u);
    expect(() => insertOperationalBlock(doc, paragraph(firstId, "duplicate"), null, null)).toThrow(
      /already exists/u,
    );
    expect(() => moveOperationalBlock(doc, firstId, null, firstId)).toThrow(/before itself/u);
    expect(() => moveOperationalBlock(doc, firstId, secondId, null)).toThrow(/cannot contain/u);
    expect(() => operationalBlockPlacement(doc, rowId)).toThrow(/internal/u);
    expect(() => deleteOperationalBlock(doc, cellId)).toThrow(/internal/u);
    expect(() => findOperationalNode(getOperationalBlockTree(doc), generateUuidV7())).toThrow(
      BlockTreeOperationError,
    );
    deleteOperationalBlock(doc, secondId);
    expect(() => findOperationalNode(getOperationalBlockTree(doc), secondId)).toThrow(
      /does not exist/u,
    );
  });
});
