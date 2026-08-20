import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  OperationalPageDocument,
  PageCommandError,
  versionVectorBytesEqual,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

describe("operational page transactions", () => {
  it("applies a command batch atomically and emits one incremental update", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "Premier")] },
    });

    const result = page.transact([
      {
        type: "insert-block",
        block: paragraph(secondId, "Second"),
        parentBlockId: null,
        beforeBlockId: null,
      },
      { type: "replace-text", blockId: secondId, from: 0, to: 6, text: "Deuxième" },
    ]);

    expect(result.changed).toBe(true);
    expect(result.updateBytes.byteLength).toBeGreaterThan(0);
    expect(result.semanticChanges).toHaveLength(2);
    expect(versionVectorBytesEqual(result.baseVersionVector, result.resultVersionVector)).toBe(
      false,
    );
    await expect(page.project()).resolves.toMatchObject({
      pageId,
      document: {
        blocks: [paragraph(firstId, "Premier"), paragraph(secondId, "Deuxième")],
      },
    });
  });

  it("leaves no partial edit when a later command in the batch is invalid", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const insertedId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "Stable")] },
    });
    const before = page.versionVectorBytes();

    expect(() =>
      page.transact([
        {
          type: "insert-block",
          block: paragraph(insertedId, "Ne doit pas survivre"),
          parentBlockId: null,
          beforeBlockId: null,
        },
        {
          type: "move-block",
          blockId: generateUuidV7(),
          parentBlockId: null,
          beforeBlockId: firstId,
        },
      ]),
    ).toThrow(PageCommandError);

    expect(versionVectorBytesEqual(page.versionVectorBytes(), before)).toBe(true);
    expect((await page.project()).document).toEqual({ blocks: [paragraph(firstId, "Stable")] });
  });

  it("keeps canonical identity through moves and rejects duplicate live identities", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "A"), paragraph(secondId, "B")] },
    });

    page.transact([
      {
        type: "move-block",
        blockId: secondId,
        parentBlockId: null,
        beforeBlockId: firstId,
      },
    ]);
    expect((await page.project()).document.blocks.map(({ id }) => id)).toEqual([secondId, firstId]);

    expect(() =>
      page.transact([
        {
          type: "insert-block",
          block: paragraph(firstId, "Collision"),
          parentBlockId: null,
          beforeBlockId: null,
        },
      ]),
    ).toThrow(/identity/u);
  });

  it("deletes a subtree without changing neighbouring block identities", async () => {
    const pageId = generateUuidV7();
    const containerId = generateUuidV7();
    const childId = generateUuidV7();
    const neighbourId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "toggle",
            id: containerId,
            content: [{ text: "Détails" }],
            children: [paragraph(childId, "Enfant")],
          },
          paragraph(neighbourId, "Voisin"),
        ],
      },
    });

    page.transact([{ type: "delete-block", blockId: containerId }]);
    expect((await page.project()).document).toEqual({
      blocks: [paragraph(neighbourId, "Voisin")],
    });
  });
});
