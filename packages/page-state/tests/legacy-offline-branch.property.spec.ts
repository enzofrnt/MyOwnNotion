import {
  type Block,
  type BlockDocument,
  canonicalDocumentJsonV3,
  generateUuidV7,
  migrateDocumentV2ToV3,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  appendLegacySemanticTransaction,
  convertLegacyOfflineBranch,
  createLegacyOfflineBranch,
  type LegacyOfflineBranch,
  LegacyOfflineBranchError,
  type LegacySemanticCommand,
  legacySemanticCommandsFromTransaction,
  OperationalPageDocument,
  planPageAmbiguityResolution,
  verifyLegacyOfflineBranch,
} from "../src/index.ts";
import type { PageCommand } from "../src/document.ts";

function legacyParagraph(id: Uuid, text: string): BlockDocument {
  return { blocks: [{ type: "paragraph", id, content: [{ text }] }] };
}

async function branchWith(input: {
  readonly pageId: Uuid;
  readonly baseDocument: BlockDocument;
  readonly commands: readonly LegacySemanticCommand[];
}): Promise<LegacyOfflineBranch> {
  const branch = await createLegacyOfflineBranch({
    branchId: generateUuidV7(),
    pageId: input.pageId,
    baseRevisionId: generateUuidV7(),
    baseDocument: input.baseDocument,
    createdAt: "2026-08-20T12:00:00.000Z",
  });
  return await appendLegacySemanticTransaction(branch, {
    transactionId: generateUuidV7(),
    sequence: 1,
    commands: input.commands,
  });
}

describe("legacy offline branches", () => {
  it("derives a replayable journal from one local operational transaction", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseDocument = legacyParagraph(blockId, "Alpha");
    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const page = OperationalPageDocument.create({ pageId, document: branch.baseDocument });
    const beforeDocument = page.snapshot();
    const transaction = page.transact([
      { type: "replace-text", blockId, from: 5, to: 5, text: " locale" },
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 5,
        mark: { type: "bold" },
        enabled: true,
      },
      { type: "set-block-type", blockId, blockType: "heading", properties: { level: 2 } },
    ]);
    const commands = legacySemanticCommandsFromTransaction({
      pageId,
      beforeDocument,
      transaction,
    });
    const edited = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands,
    });

    expect(commands.map(({ type }) => type)).toEqual([
      "replace-text",
      "set-mark",
      "set-type-or-property",
    ]);
    expect(edited.baseDocumentV2).toEqual(baseDocument);
    expect(canonicalDocumentJsonV3(edited.localDocument)).toBe(
      canonicalDocumentJsonV3(page.snapshot()),
    );
    await expect(verifyLegacyOfflineBranch(edited)).resolves.toMatchObject({
      digest: edited.localDocumentDigest,
    });
  });

  it("journals table structure created during the first offline editing session", async () => {
    const pageId = generateUuidV7();
    const paragraphId = generateUuidV7();
    const baseDocument = legacyParagraph(paragraphId, "Avant le tableau");
    let branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const page = OperationalPageDocument.create({ pageId, document: branch.baseDocument });
    const tableId = generateUuidV7();
    const firstColumnId = generateUuidV7();
    const firstRowId = generateUuidV7();
    const firstCellId = generateUuidV7();
    const beforeInsert = page.snapshot();
    const insertTable = page.transact([
      {
        type: "insert-block",
        block: {
          type: "table",
          id: tableId,
          columns: [{ id: firstColumnId, width: null }],
          rows: [
            {
              id: firstRowId,
              cells: [{ id: firstCellId, content: [{ text: "A1" }] }],
            },
          ],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    branch = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands: legacySemanticCommandsFromTransaction({
        pageId,
        beforeDocument: beforeInsert,
        transaction: insertTable,
      }),
    });

    const secondRowId = generateUuidV7();
    const secondRowFirstCellId = generateUuidV7();
    const secondColumnId = generateUuidV7();
    const firstRowSecondCellId = generateUuidV7();
    const secondRowSecondCellId = generateUuidV7();
    const beforeExpansion = page.snapshot();
    const expansion = page.transact([
      {
        type: "insert-table-row",
        tableId,
        row: {
          id: secondRowId,
          cells: [{ id: secondRowFirstCellId, content: [{ text: "A2" }] }],
        },
        beforeRowId: null,
      },
      {
        type: "insert-table-column",
        tableId,
        column: { id: secondColumnId, width: 180 },
        cells: [
          {
            rowId: firstRowId,
            cell: { id: firstRowSecondCellId, content: [{ text: "B1" }] },
          },
          {
            rowId: secondRowId,
            cell: { id: secondRowSecondCellId, content: [{ text: "B2" }] },
          },
        ],
        beforeColumnId: null,
      },
    ]);
    branch = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 2,
      commands: legacySemanticCommandsFromTransaction({
        pageId,
        beforeDocument: beforeExpansion,
        transaction: expansion,
      }),
    });

    const beforeReduction = page.snapshot();
    const reduction = page.transact([
      { type: "delete-table-column", tableId, columnId: firstColumnId },
      { type: "delete-table-row", tableId, rowId: firstRowId },
    ]);
    branch = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 3,
      commands: legacySemanticCommandsFromTransaction({
        pageId,
        beforeDocument: beforeReduction,
        transaction: reduction,
      }),
    });

    const activePage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    const conversion = await convertLegacyOfflineBranch({ branch, activePage });
    expect(conversion.ambiguities).toEqual([]);
    expect(conversion.commands.map(({ type }) => type)).toEqual([
      "insert-block",
      "insert-table-row",
      "insert-table-column",
      "delete-table-column",
      "delete-table-row",
    ]);
    expect(canonicalDocumentJsonV3(branch.localDocument)).toBe(
      canonicalDocumentJsonV3(page.snapshot()),
    );
    expect(canonicalDocumentJsonV3((await activePage.project()).document)).toBe(
      canonicalDocumentJsonV3(page.snapshot()),
    );
  });

  it("replays the semantic journal and rejects a local projection that is not its result", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument: legacyParagraph(blockId, "AB"),
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const edited = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands: [
        {
          type: "replace-text",
          blockId,
          baseFrom: 1,
          baseTo: 1,
          beforeContext: "A",
          afterContext: "B",
          text: " local",
        },
      ],
    });

    const replay = await verifyLegacyOfflineBranch(edited);
    expect(canonicalDocumentJsonV3(replay.document)).toContain("A localB");
    expect(edited).not.toHaveProperty("checkpointBytes");
    expect(edited).not.toHaveProperty("updateBytes");

    await expect(
      verifyLegacyOfflineBranch({
        ...edited,
        localDocument: migrateDocumentV2ToV3(legacyParagraph(blockId, "falsifié")),
      }),
    ).rejects.toBeInstanceOf(LegacyOfflineBranchError);
  });

  it("converts two independent legacy branches into granular operations on one active head", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseDocument = legacyParagraph(blockId, "AB");
    const common = {
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    } as const;
    const left = await appendLegacySemanticTransaction(
      await createLegacyOfflineBranch({ ...common, branchId: generateUuidV7() }),
      {
        transactionId: generateUuidV7(),
        sequence: 1,
        commands: [
          {
            type: "replace-text",
            blockId,
            baseFrom: 1,
            baseTo: 1,
            beforeContext: "A",
            afterContext: "B",
            text: "L",
          },
        ],
      },
    );
    const right = await appendLegacySemanticTransaction(
      await createLegacyOfflineBranch({ ...common, branchId: generateUuidV7() }),
      {
        transactionId: generateUuidV7(),
        sequence: 1,
        commands: [
          {
            type: "replace-text",
            blockId,
            baseFrom: 1,
            baseTo: 1,
            beforeContext: "A",
            afterContext: "B",
            text: "R",
          },
        ],
      },
    );
    const activePage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });

    const first = await convertLegacyOfflineBranch({ branch: left, activePage });
    const second = await convertLegacyOfflineBranch({ branch: right, activePage });
    expect(first.ambiguities).toEqual([]);
    expect(second.ambiguities).toEqual([]);
    expect(
      [...first.commands, ...second.commands].every(({ type }) => type === "replace-text"),
    ).toBe(true);
    const block = (await activePage.project()).document.blocks[0];
    expect(block?.type).toBe("paragraph");
    if (block?.type !== "paragraph") return;
    const text = block.content.map((run) => run.text).join("");
    expect(text).toContain("L");
    expect(text).toContain("R");
    expect(text.startsWith("A")).toBe(true);
    expect(text.endsWith("B")).toBe(true);
  });

  it("turns legacy delete/edit into a recoverable ambiguity instead of choosing a document", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseDocument = legacyParagraph(blockId, "Original");
    const common = {
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    } as const;
    const deleting = await appendLegacySemanticTransaction(
      await createLegacyOfflineBranch({ ...common, branchId: generateUuidV7() }),
      {
        transactionId: generateUuidV7(),
        sequence: 1,
        commands: [{ type: "delete-block", blockId }],
      },
    );
    const editing = await appendLegacySemanticTransaction(
      await createLegacyOfflineBranch({ ...common, branchId: generateUuidV7() }),
      {
        transactionId: generateUuidV7(),
        sequence: 1,
        commands: [
          {
            type: "replace-text",
            blockId,
            baseFrom: 8,
            baseTo: 8,
            beforeContext: "Original",
            afterContext: "",
            text: " modifié",
          },
        ],
      },
    );
    const activePage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    await convertLegacyOfflineBranch({ branch: deleting, activePage });
    const conversion = await convertLegacyOfflineBranch({ branch: editing, activePage });

    expect(conversion.ambiguities).toHaveLength(1);
    expect(conversion.ambiguities[0]?.kind).toBe("delete-edit");
    const ambiguity = conversion.ambiguities[0];
    if (ambiguity === undefined) return;
    const resolution = planPageAmbiguityResolution(ambiguity, {
      decision: "restore-change",
      parentBlockId: null,
      beforeBlockId: null,
    });
    activePage.transact(resolution.commands);
    expect(canonicalDocumentJsonV3((await activePage.project()).document)).toContain(
      "Original modifié",
    );
  });

  it("replays and converts every legacy semantic command without replacing the document", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const insertedId = generateUuidV7();
    const baseDocument: BlockDocument = {
      blocks: [
        { type: "paragraph", id: firstId, content: [{ text: "Alpha" }] },
        { type: "paragraph", id: secondId, content: [{ text: "Beta" }] },
      ],
    };
    const branch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        {
          type: "insert-block",
          block: { type: "paragraph", id: insertedId, content: [{ text: "Inséré" }] },
          parentBlockId: null,
          beforeBlockId: secondId,
        },
        {
          type: "move-block",
          blockId: secondId,
          parentBlockId: null,
          beforeBlockId: firstId,
        },
        {
          type: "set-mark",
          blockId: firstId,
          baseFrom: 0,
          baseTo: 5,
          mark: { type: "bold" },
          enabled: true,
        },
        {
          type: "replace-text",
          blockId: firstId,
          baseFrom: 1,
          baseTo: 4,
          beforeContext: "A",
          afterContext: "a",
          text: "LPH",
        },
        {
          type: "set-type-or-property",
          blockId: firstId,
          key: "type",
          before: "paragraph",
          after: "heading",
        },
        {
          type: "set-type-or-property",
          blockId: firstId,
          key: "level",
          before: 1,
          after: 3,
        },
        { type: "delete-block", blockId: secondId },
      ],
    });
    const activePage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });

    const conversion = await convertLegacyOfflineBranch({ branch, activePage });
    expect(conversion.ambiguities).toEqual([]);
    expect(conversion.commands.map(({ type }) => type)).toEqual([
      "insert-block",
      "move-block",
      "set-mark",
      "replace-text",
      "set-block-type",
      "set-block-property",
      "delete-block",
    ]);
    expect(conversion.transaction?.changed).toBe(true);
    expect(canonicalDocumentJsonV3((await activePage.project()).document)).toBe(
      canonicalDocumentJsonV3(branch.localDocument),
    );
  });

  it("validates branch metadata, sequence integrity and semantic proofs", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseDocument = legacyParagraph(blockId, "A🦜B");
    const fresh = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    await expect(
      createLegacyOfflineBranch({
        branchId: generateUuidV7(),
        pageId,
        baseRevisionId: generateUuidV7(),
        baseDocument,
        createdAt: "not-a-date",
      }),
    ).rejects.toThrow(/creation time/u);
    await expect(
      appendLegacySemanticTransaction(
        { ...fresh, status: "blocked" },
        {
          transactionId: generateUuidV7(),
          sequence: 1,
          commands: [],
        },
      ),
    ).rejects.toThrow(/cannot be edited/u);
    await expect(
      appendLegacySemanticTransaction(fresh, {
        transactionId: generateUuidV7(),
        sequence: 2,
        commands: [],
      }),
    ).rejects.toThrow(/next sequence/u);

    const transactionId = generateUuidV7();
    const one = await appendLegacySemanticTransaction(fresh, {
      transactionId,
      sequence: 1,
      commands: [],
    });
    await expect(
      appendLegacySemanticTransaction(one, { transactionId, sequence: 2, commands: [] }),
    ).rejects.toThrow(/duplicated/u);
    await expect(
      verifyLegacyOfflineBranch({
        ...fresh,
        mode: "unsupported" as "legacy-branch",
      }),
    ).rejects.toThrow(/unsupported legacy branch mode/u);
    await expect(
      verifyLegacyOfflineBranch({ ...fresh, baseCanonicalDigest: "tampered" }),
    ).rejects.toThrow(/base document digest/u);
    await expect(
      verifyLegacyOfflineBranch({
        ...fresh,
        baseDocumentV2: legacyParagraph(blockId, "autre base"),
      }),
    ).rejects.toThrow(/v2 base/u);
    expect(one.semanticTransactions).toHaveLength(1);
    const firstTransaction = one.semanticTransactions[0];
    if (firstTransaction === undefined) {
      throw new Error("Expected the first semantic transaction to exist");
    }
    await expect(
      verifyLegacyOfflineBranch({
        ...one,
        semanticTransactions: [{ ...firstTransaction, sequence: 2 }],
      }),
    ).rejects.toThrow(/contiguous/u);

    const invalidCommands: Array<readonly [LegacySemanticCommand, RegExp]> = [
      [
        {
          type: "replace-text",
          blockId: generateUuidV7(),
          baseFrom: 0,
          baseTo: 0,
          beforeContext: "",
          afterContext: "",
          text: "x",
        },
        /does not exist/u,
      ],
      [
        {
          type: "replace-text",
          blockId,
          baseFrom: 2,
          baseTo: 2,
          beforeContext: "",
          afterContext: "",
          text: "x",
        },
        /surrogate pair/u,
      ],
      [
        {
          type: "replace-text",
          blockId,
          baseFrom: -1,
          baseTo: 0,
          beforeContext: "",
          afterContext: "",
          text: "x",
        },
        /outside its block/u,
      ],
      [
        {
          type: "replace-text",
          blockId,
          baseFrom: 1,
          baseTo: 1,
          beforeContext: "wrong",
          afterContext: "🦜B",
          text: "x",
        },
        /before-context/u,
      ],
      [
        {
          type: "replace-text",
          blockId,
          baseFrom: 1,
          baseTo: 1,
          beforeContext: "A",
          afterContext: "wrong",
          text: "x",
        },
        /after-context/u,
      ],
      [
        {
          type: "replace-text",
          blockId,
          baseFrom: 1,
          baseTo: 1,
          beforeContext: "x".repeat(65),
          afterContext: "",
          text: "x",
        },
        /must not exceed/u,
      ],
      [
        {
          type: "set-mark",
          blockId: generateUuidV7(),
          baseFrom: 0,
          baseTo: 1,
          mark: { type: "bold" },
          enabled: true,
        },
        /does not exist/u,
      ],
      [
        {
          type: "set-type-or-property",
          blockId: generateUuidV7(),
          key: "type",
          before: "paragraph",
          after: "heading",
        },
        /does not exist/u,
      ],
      [
        {
          type: "set-type-or-property",
          blockId,
          key: "type",
          before: "heading",
          after: "paragraph",
        },
        /precondition/u,
      ],
      [
        {
          type: "set-type-or-property",
          blockId,
          key: "type",
          before: "paragraph",
          after: "image",
        },
        /unsupported/u,
      ],
    ];
    for (const [command, expected] of invalidCommands) {
      await expect(
        appendLegacySemanticTransaction(fresh, {
          transactionId: generateUuidV7(),
          sequence: 1,
          commands: [command],
        }),
      ).rejects.toThrow(expected);
    }
  });

  it("keeps idempotent inserts empty and reports a colliding insert as schema ambiguity", async () => {
    const pageId = generateUuidV7();
    const baseId = generateUuidV7();
    const insertedId = generateUuidV7();
    const baseDocument = legacyParagraph(baseId, "Base");
    const inserted = { type: "paragraph" as const, id: insertedId, content: [{ text: "Même" }] };
    const branch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        { type: "insert-block", block: inserted, parentBlockId: null, beforeBlockId: null },
      ],
    });
    const [baseBlock] = migrateDocumentV2ToV3(baseDocument).blocks;
    if (baseBlock === undefined) {
      throw new Error("Expected the migrated base block to exist");
    }
    const samePage = OperationalPageDocument.create({
      pageId,
      document: { blocks: [baseBlock, inserted] },
    });
    const same = await convertLegacyOfflineBranch({ branch, activePage: samePage });
    expect(same.commands).toEqual([]);
    expect(same.transaction).toBeUndefined();
    expect(same.ambiguities).toEqual([]);

    const collisionPage = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [baseBlock, { ...inserted, content: [{ text: "Concurrent" }] }],
      },
    });
    const collision = await convertLegacyOfflineBranch({
      branch,
      activePage: collisionPage,
    });
    expect(collision.commands).toEqual([]);
    expect(collision.ambiguities[0]?.kind).toBe("schema");
  });

  it("classifies concurrent moves, marks, types and properties without data loss", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const baseDocument: BlockDocument = {
      blocks: [
        { type: "paragraph", id: firstId, content: [{ text: "Alpha" }] },
        { type: "paragraph", id: secondId, content: [{ text: "Beta" }] },
      ],
    };

    const moveBranch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        { type: "move-block", blockId: secondId, parentBlockId: null, beforeBlockId: firstId },
      ],
    });
    const deletedPage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    deletedPage.transact([{ type: "delete-block", blockId: secondId }]);
    expect(
      (await convertLegacyOfflineBranch({ branch: moveBranch, activePage: deletedPage }))
        .ambiguities[0]?.kind,
    ).toBe("delete-move");

    const markBranch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        {
          type: "set-mark",
          blockId: firstId,
          baseFrom: 0,
          baseTo: 1,
          mark: { type: "bold" },
          enabled: true,
        },
      ],
    });
    const editedPage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    editedPage.transact([
      { type: "replace-text", blockId: firstId, from: 0, to: 5, text: "Autre" },
    ]);
    expect(
      (await convertLegacyOfflineBranch({ branch: markBranch, activePage: editedPage }))
        .ambiguities[0]?.kind,
    ).toBe("schema");

    const typeBranch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        {
          type: "set-type-or-property",
          blockId: firstId,
          key: "type",
          before: "paragraph",
          after: "heading",
        },
      ],
    });
    const transformedPage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    transformedPage.transact([{ type: "set-block-type", blockId: firstId, blockType: "checkbox" }]);
    expect(
      (await convertLegacyOfflineBranch({ branch: typeBranch, activePage: transformedPage }))
        .ambiguities[0]?.kind,
    ).toBe("type-transform");

    const propertyBranch = await branchWith({
      pageId,
      baseDocument,
      commands: [
        {
          type: "set-type-or-property",
          blockId: firstId,
          key: "future",
          before: null,
          after: { z: 2, a: [1, true] },
        },
      ],
    });
    const propertyPage = OperationalPageDocument.create({
      pageId,
      document: migrateDocumentV2ToV3(baseDocument),
    });
    propertyPage.transact([
      { type: "set-block-property", blockId: firstId, key: "future", value: { other: true } },
    ]);
    const propertyConflict = await convertLegacyOfflineBranch({
      branch: propertyBranch,
      activePage: propertyPage,
    });
    expect(propertyConflict.ambiguities[0]).toMatchObject({
      kind: "property-transform",
      propertyKey: "future",
    });
  });

  it("refuses conversion into a different page", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const baseDocument = legacyParagraph(blockId, "Base");
    const branch = await branchWith({ pageId, baseDocument, commands: [] });
    const activePage = OperationalPageDocument.create({
      pageId: generateUuidV7(),
      document: migrateDocumentV2ToV3(baseDocument),
    });

    await expect(convertLegacyOfflineBranch({ branch, activePage })).rejects.toThrow(
      /does not match/u,
    );
  });
});

describe("journal coverage for move and property commands", () => {
  it("journals a move-block operation with its placement proof", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const baseDocument: BlockDocument = {
      blocks: [
        { type: "paragraph", id: firstId, content: [{ text: "premier" }] },
        { type: "paragraph", id: secondId, content: [{ text: "second" }] },
      ],
    };
    const branch = await createLegacyOfflineBranch({
      branchId: generateUuidV7(),
      pageId,
      baseRevisionId: generateUuidV7(),
      baseDocument,
      createdAt: "2026-08-20T12:00:00.000Z",
    });
    const page = OperationalPageDocument.create({ pageId, document: branch.baseDocument });
    const beforeDocument = page.snapshot();
    const transaction = page.transact([
      { type: "move-block", blockId: firstId, parentBlockId: null, beforeBlockId: null },
    ]);
    const commands = legacySemanticCommandsFromTransaction({
      pageId,
      beforeDocument,
      transaction,
    });
    expect(commands[0]?.type).toBe("move-block");

    const edited = await appendLegacySemanticTransaction(branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands,
    });
    await expect(verifyLegacyOfflineBranch(edited)).resolves.toMatchObject({
      digest: edited.localDocumentDigest,
    });
  });

  it("journals checkbox, code and heading property extraction for typed inversions", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const cases: Array<{ start: Block; command: PageCommand }> = [
      {
        start: { type: "heading" as const, id: blockId, content: [{ text: "t" }], level: 2 },
        command: { type: "set-block-type" as const, blockId, blockType: "paragraph" as const },
      },
      {
        start: {
          type: "checkbox" as const,
          id: blockId,
          content: [{ text: "t" }],
          checked: true,
        },
        command: { type: "set-block-type" as const, blockId, blockType: "paragraph" as const },
      },
      {
        start: { type: "code" as const, id: blockId, text: "x", language: "ts" },
        command: { type: "set-block-type" as const, blockId, blockType: "paragraph" as const },
      },
    ];

    for (const { start, command } of cases) {
      const baseDocument: BlockDocument = { blocks: [start] };
      const branch = await createLegacyOfflineBranch({
        branchId: generateUuidV7(),
        pageId,
        baseRevisionId: generateUuidV7(),
        baseDocument,
        createdAt: "2026-08-20T12:00:00.000Z",
      });
      const page = OperationalPageDocument.create({ pageId, document: branch.baseDocument });
      const beforeDocument = page.snapshot();
      const transaction = page.transact([command]);
      const commands = legacySemanticCommandsFromTransaction({
        pageId,
        beforeDocument,
        transaction,
      });
      expect(commands.length).toBeGreaterThan(0);

      const edited = await appendLegacySemanticTransaction(branch, {
        transactionId: generateUuidV7(),
        sequence: 1,
        commands,
      });
      await expect(verifyLegacyOfflineBranch(edited)).resolves.toMatchObject({
        digest: edited.localDocumentDigest,
      });
    }
  });
});
