import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectPageAmbiguities,
  OperationalPageDocument,
  type PageAmbiguity,
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

  it("rejects one update identity reused for a different causal result", async () => {
    const replicas = await nestedReplicas();
    const left = replicas.left.transact([
      { type: "replace-text", blockId: replicas.childId, from: 6, to: 6, text: " gauche" },
    ]);
    const right = replicas.right.transact([
      { type: "replace-text", blockId: replicas.childId, from: 6, to: 6, text: " droite" },
    ]);
    const reusedUpdateId = generateUuidV7();

    expect(() =>
      detectPageAmbiguities([
        semanticUpdateFromTransaction(reusedUpdateId, left),
        semanticUpdateFromTransaction(reusedUpdateId, right),
      ]),
    ).toThrow(/identity.*reused/iu);
  });

  it("ignores equivalent transforms and a deletion unrelated to a concurrent edit", async () => {
    const pageId = generateUuidV7();
    const headingId = generateUuidV7();
    const neighbourId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          { type: "heading", id: headingId, level: 1, content: [{ text: "Titre" }] },
          paragraph(neighbourId, "Voisin"),
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const replica = () => OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });

    const [sameTypeLeft, sameTypeRight] = await Promise.all([replica(), replica()]);
    const sameTypeUpdates = [
      sameTypeLeft.transact([{ type: "set-block-type", blockId: headingId, blockType: "quote" }]),
      sameTypeRight.transact([{ type: "set-block-type", blockId: headingId, blockType: "quote" }]),
    ];
    expect(
      detectPageAmbiguities(
        sameTypeUpdates.map((result) => semanticUpdateFromTransaction(generateUuidV7(), result)),
      ),
    ).toEqual([]);

    const [samePropertyLeft, samePropertyRight] = await Promise.all([replica(), replica()]);
    const samePropertyUpdates = [
      samePropertyLeft.transact([
        { type: "set-block-property", blockId: headingId, key: "level", value: 2 },
      ]),
      samePropertyRight.transact([
        { type: "set-block-property", blockId: headingId, key: "level", value: 2 },
      ]),
    ];
    expect(
      detectPageAmbiguities(
        samePropertyUpdates.map((result) =>
          semanticUpdateFromTransaction(generateUuidV7(), result),
        ),
      ),
    ).toEqual([]);

    const [sameSchemaLeft, sameSchemaRight] = await Promise.all([replica(), replica()]);
    const sameSchemaRecords = [
      sameSchemaLeft.transact([
        { type: "replace-text", blockId: neighbourId, from: 6, to: 6, text: " A" },
      ]),
      sameSchemaRight.transact([
        { type: "replace-text", blockId: neighbourId, from: 6, to: 6, text: " B" },
      ]),
    ].map(
      (result): SemanticUpdateRecord => ({
        ...semanticUpdateFromTransaction(generateUuidV7(), result),
        semanticChanges: [
          {
            type: "schema-changed",
            blockId: neighbourId,
            beforeSchemaVersion: 1,
            afterSchemaVersion: 2,
            blockAfter: paragraph(neighbourId, "Voisin"),
          },
        ],
      }),
    );
    expect(detectPageAmbiguities(sameSchemaRecords)).toEqual([]);

    const [deleteReplica, editReplica] = await Promise.all([replica(), replica()]);
    const unrelated = detectPageAmbiguities([
      semanticUpdateFromTransaction(
        generateUuidV7(),
        deleteReplica.transact([{ type: "delete-block", blockId: headingId }]),
      ),
      semanticUpdateFromTransaction(
        generateUuidV7(),
        editReplica.transact([
          { type: "replace-text", blockId: neighbourId, from: 6, to: 6, text: " modifié" },
        ]),
      ),
    ]);
    expect(unrelated).toEqual([]);
  });

  it("recovers an insertion made inside a concurrently deleted parent", async () => {
    const replicas = await nestedReplicas();
    const insertedParentId = generateUuidV7();
    const insertedChildId = generateUuidV7();
    const deletion = replicas.left.transact([{ type: "delete-block", blockId: replicas.parentId }]);
    const insertion = replicas.right.transact([
      {
        type: "insert-block",
        block: {
          type: "toggle",
          id: insertedParentId,
          content: [{ text: "Ajout hors ligne" }],
          children: [],
        },
        parentBlockId: replicas.parentId,
        beforeBlockId: replicas.childId,
      },
      {
        type: "insert-block",
        block: paragraph(insertedChildId, "Enfant ajouté hors ligne"),
        parentBlockId: insertedParentId,
        beforeBlockId: null,
      },
    ]);
    const ids = [generateUuidV7(), generateUuidV7()].sort() as [Uuid, Uuid];
    const ambiguities = detectPageAmbiguities([
      semanticUpdateFromTransaction(ids[1], deletion),
      semanticUpdateFromTransaction(ids[0], insertion),
    ]);

    expect(ambiguities).toHaveLength(1);
    const recovered = ambiguities[0]?.recoverableSubtree;
    expect(recovered?.type).toBe("toggle");
    expect(
      recovered && "children" in recovered ? recovered.children?.map(({ id }) => id) : [],
    ).toEqual([insertedParentId, replicas.childId]);
    const nested =
      recovered && "children" in recovered
        ? recovered.children?.find(({ id }) => id === insertedParentId)
        : undefined;
    expect(nested && "children" in nested ? nested.children?.map(({ id }) => id) : []).toEqual([
      insertedChildId,
    ]);
  });

  it("rebuilds an edited descendant through table cells and guards resolution choices", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const emptyCellId = generateUuidV7();
    const insertedCellChildId = generateUuidV7();
    const childId = generateUuidV7();
    const origin = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          {
            type: "table",
            id: tableId,
            columns: [
              { id: generateUuidV7(), width: null },
              { id: generateUuidV7(), width: null },
            ],
            rows: [
              {
                id: generateUuidV7(),
                cells: [
                  { id: emptyCellId, content: [{ text: "Simple" }] },
                  {
                    id: generateUuidV7(),
                    content: [{ text: "Avec enfant" }],
                    children: [paragraph(childId, "Enfant")],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const checkpoint = await origin.checkpoint();
    const deleting = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const editing = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
    const ambiguity = detectPageAmbiguities([
      semanticUpdateFromTransaction(
        generateUuidV7(),
        deleting.transact([{ type: "delete-block", blockId: tableId }]),
      ),
      semanticUpdateFromTransaction(
        generateUuidV7(),
        editing.transact([
          {
            type: "insert-block",
            block: paragraph(insertedCellChildId, "Ajout cellule"),
            parentBlockId: emptyCellId,
            beforeBlockId: null,
          },
          { type: "replace-text", blockId: childId, from: 6, to: 6, text: " restauré" },
        ]),
      ),
    ])[0];
    expect(ambiguity?.recoverableSubtree?.type).toBe("table");
    expect(JSON.stringify(ambiguity?.recoverableSubtree)).toContain("Enfant restauré");
    expect(JSON.stringify(ambiguity?.recoverableSubtree)).toContain("Ajout cellule");

    const blockId = generateUuidV7();
    const sourceIds = [generateUuidV7(), generateUuidV7()].sort() as [Uuid, Uuid];
    const transform: PageAmbiguity = {
      logicalKey: "type-transform:test",
      kind: "type-transform",
      status: "open",
      blockIds: [blockId],
      sourceUpdateIds: sourceIds,
      recoverableSubtree: paragraph(blockId, "Alternative"),
    };
    expect(() => planPageAmbiguityResolution(transform, { decision: "confirm-delete" })).toThrow(
      /deletion ambiguity/iu,
    );
    expect(() =>
      planPageAmbiguityResolution(
        {
          logicalKey: transform.logicalKey,
          kind: transform.kind,
          status: transform.status,
          blockIds: transform.blockIds,
          sourceUpdateIds: transform.sourceUpdateIds,
        },
        { decision: "restore-change", parentBlockId: null, beforeBlockId: null },
      ),
    ).toThrow(/not recoverable/iu);
    expect(
      planPageAmbiguityResolution(transform, {
        decision: "custom",
        result: paragraph(blockId, "Choix"),
        parentBlockId: null,
        beforeBlockId: null,
      }).commands.map(({ type }) => type),
    ).toEqual(["delete-block", "insert-block"]);

    const deletion: PageAmbiguity = {
      logicalKey: "delete-move:test",
      kind: "delete-move",
      status: "open",
      blockIds: [blockId],
      sourceUpdateIds: sourceIds,
      deletedSubtree: paragraph(blockId, "Supprimé"),
      recoverableSubtree: paragraph(blockId, "Déplacé"),
    };
    expect(planPageAmbiguityResolution(deletion, { decision: "confirm-delete" }).commands).toEqual(
      [],
    );
    expect(
      planPageAmbiguityResolution(deletion, {
        decision: "custom",
        result: paragraph(blockId, "Restauré"),
        parentBlockId: null,
        beforeBlockId: null,
      }).commands.map(({ type }) => type),
    ).toEqual(["insert-block"]);
  });
});
