import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectPageAmbiguities,
  OperationalPageDocument,
  planPageAmbiguityResolution,
  type SemanticUpdateRecord,
  semanticUpdateFromTransaction,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

async function nestedReplicas() {
  const pageId = generateUuidV7();
  const parentId = generateUuidV7();
  const childId = generateUuidV7();
  const neighbourId = generateUuidV7();
  const origin = OperationalPageDocument.create({
    pageId,
    document: {
      blocks: [
        {
          type: "toggle",
          id: parentId,
          content: [{ text: "Parent" }],
          children: [paragraph(childId, "Enfant")],
        },
        paragraph(neighbourId, "Voisin"),
      ],
    },
  });
  const checkpoint = await origin.checkpoint();
  return {
    childId,
    neighbourId,
    pageId,
    parentId,
    left: await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
    right: await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
  };
}

describe("semantic ambiguities", () => {
  it("preserves a concurrently edited deleted subtree and resolves it with a new operation", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(" local", " hors ligne", " 🦜"), async (suffix) => {
        const replicas = await nestedReplicas();
        const deletion = replicas.left.transact([
          { type: "delete-block", blockId: replicas.parentId },
        ]);
        const edit = replicas.right.transact([
          {
            type: "replace-text",
            blockId: replicas.childId,
            from: 6,
            to: 6,
            text: suffix,
          },
        ]);
        const deletedUpdateId = generateUuidV7();
        const editedUpdateId = generateUuidV7();
        const updates = [
          semanticUpdateFromTransaction(deletedUpdateId, deletion),
          semanticUpdateFromTransaction(editedUpdateId, edit),
        ];

        const ambiguities = detectPageAmbiguities(updates);
        expect(ambiguities).toHaveLength(1);
        const ambiguity = ambiguities[0];
        expect(ambiguity).toMatchObject({
          kind: "delete-edit",
          status: "open",
          blockIds: expect.arrayContaining([replicas.parentId, replicas.childId]),
        });
        if (ambiguity === undefined) return;
        expect(detectPageAmbiguities(updates.toReversed())[0]?.logicalKey).toBe(
          ambiguity.logicalKey,
        );

        replicas.left.importUpdate(edit.updateBytes);
        const plan = planPageAmbiguityResolution(ambiguity, {
          decision: "restore-change",
          parentBlockId: null,
          beforeBlockId: replicas.neighbourId,
        });
        expect(plan.commands).toHaveLength(1);
        replicas.left.transact(plan.commands);
        const restored = await replicas.left.project();
        expect(canonicalDocumentJsonV3(restored.document)).toContain(`Enfant${suffix}`);
        expect(plan.sourceUpdateIds).toEqual(ambiguity.sourceUpdateIds);
      }),
    );
  });

  it("distinguishes a concurrent move from an edit when the same block is deleted", async () => {
    const replicas = await nestedReplicas();
    const deletion = replicas.left.transact([{ type: "delete-block", blockId: replicas.childId }]);
    const move = replicas.right.transact([
      {
        type: "move-block",
        blockId: replicas.childId,
        parentBlockId: null,
        beforeBlockId: replicas.neighbourId,
      },
    ]);

    const ambiguities = detectPageAmbiguities([
      semanticUpdateFromTransaction(generateUuidV7(), deletion),
      semanticUpdateFromTransaction(generateUuidV7(), move),
    ]);
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]).toMatchObject({
      kind: "delete-move",
      recoverablePlacement: {
        parentBlockId: null,
        beforeBlockId: replicas.neighbourId,
      },
    });
  });

  it("detects incompatible concurrent type and property transformations", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "heading",
            id: blockId,
            level: 1,
            content: [{ text: "Titre" }],
          },
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftType = left.transact([{ type: "set-block-type", blockId, blockType: "quote" }]);
    const rightType = right.transact([{ type: "set-block-type", blockId, blockType: "callout" }]);
    expect(
      detectPageAmbiguities([
        semanticUpdateFromTransaction(generateUuidV7(), leftType),
        semanticUpdateFromTransaction(generateUuidV7(), rightType),
      ]),
    ).toHaveLength(1);
    expect(
      detectPageAmbiguities([
        semanticUpdateFromTransaction(generateUuidV7(), leftType),
        semanticUpdateFromTransaction(generateUuidV7(), rightType),
      ])[0]?.kind,
    ).toBe("type-transform");

    const propertyLeft = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const propertyRight = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const levelTwo = propertyLeft.transact([
      { type: "set-block-property", blockId, key: "level", value: 2 },
    ]);
    const levelThree = propertyRight.transact([
      { type: "set-block-property", blockId, key: "level", value: 3 },
    ]);
    const propertyAmbiguities = detectPageAmbiguities([
      semanticUpdateFromTransaction(generateUuidV7(), levelTwo),
      semanticUpdateFromTransaction(generateUuidV7(), levelThree),
    ]);
    expect(propertyAmbiguities).toHaveLength(1);
    expect(propertyAmbiguities[0]).toMatchObject({
      kind: "property-transform",
      propertyKey: "level",
    });
  });

  it("deduplicates repeated detection and identifies incompatible schema transforms", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "Schéma")] },
    });
    const checkpoint = await origin.checkpoint();
    const left = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const right = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const leftResult = left.transact([
      { type: "replace-text", blockId, from: 6, to: 6, text: " A" },
    ]);
    const rightResult = right.transact([
      { type: "replace-text", blockId, from: 6, to: 6, text: " B" },
    ]);
    const leftRecord: SemanticUpdateRecord = {
      ...semanticUpdateFromTransaction(generateUuidV7(), leftResult),
      semanticChanges: [
        {
          type: "schema-changed",
          blockId,
          beforeSchemaVersion: 1,
          afterSchemaVersion: 2,
          blockAfter: paragraph(blockId, "Schéma A"),
        },
      ],
    };
    const rightRecord: SemanticUpdateRecord = {
      ...semanticUpdateFromTransaction(generateUuidV7(), rightResult),
      semanticChanges: [
        {
          type: "schema-changed",
          blockId,
          beforeSchemaVersion: 1,
          afterSchemaVersion: 3,
          blockAfter: paragraph(blockId, "Schéma B"),
        },
      ],
    };

    const ambiguities = detectPageAmbiguities([leftRecord, rightRecord, leftRecord, rightRecord]);
    expect(ambiguities).toHaveLength(1);
    expect(ambiguities[0]?.kind).toBe("schema");
  });
});
