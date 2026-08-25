import {
  type BlockDocument,
  canonicalDocumentJsonV3,
  generateUuidV7,
  migrateDocumentV2ToV3,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  appendLegacySemanticTransaction,
  createLegacyOfflineBranch,
  diffLegacyDocuments,
  LegacyDocumentDiffError,
  OperationalPageDocument,
  verifyLegacyOfflineBranch,
} from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

async function proveExactReplay(seed: number): Promise<void> {
  const pageId = generateUuidV7();
  const ids = [generateUuidV7(), generateUuidV7(), generateUuidV7()] as const;
  const base: BlockDocument = {
    blocks: [paragraph(ids[0], "alpha"), paragraph(ids[1], "beta"), paragraph(ids[2], "gamma")],
  };
  const baseV3 = migrateDocumentV2ToV3(base);
  const target = OperationalPageDocument.create({ pageId, document: baseV3 });
  target.transact([{ type: "replace-text", blockId: ids[0], from: 5, to: 5, text: `-${seed}` }]);
  if (seed % 2 === 0) {
    target.transact([
      { type: "set-mark", blockId: ids[0], from: 0, to: 5, mark: { type: "bold" }, enabled: true },
    ]);
  }
  if (seed % 3 === 0) {
    target.transact([
      { type: "move-block", blockId: ids[2], parentBlockId: null, beforeBlockId: ids[0] },
    ]);
  }
  if (seed % 4 === 0) {
    target.transact([
      { type: "set-block-type", blockId: ids[1], blockType: "heading", properties: { level: 2 } },
    ]);
  }
  if (seed % 5 === 0) {
    target.transact([
      {
        type: "insert-block",
        block: paragraph(generateUuidV7(), `inserted-${seed}`),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
  }
  if (seed % 7 === 0) {
    target.transact([{ type: "set-block-type", blockId: ids[0], blockType: "toggle" }]);
    target.transact([
      { type: "move-block", blockId: ids[1], parentBlockId: ids[0], beforeBlockId: null },
    ]);
  }
  if (seed % 6 === 0) {
    target.transact([{ type: "delete-block", blockId: ids[2] }]);
  }
  const local = target.snapshot();
  const diff = await diffLegacyDocuments({ pageId, base: baseV3, local });
  let branch = await createLegacyOfflineBranch({
    branchId: generateUuidV7(),
    pageId,
    baseRevisionId: generateUuidV7(),
    baseDocument: base,
    createdAt: "2026-08-25T10:00:00.000Z",
  });
  branch = await appendLegacySemanticTransaction(branch, {
    transactionId: generateUuidV7(),
    sequence: 1,
    commands: diff.commands,
  });
  const replayed = await verifyLegacyOfflineBranch(branch);

  expect(replayed.digest).toBe(diff.digest);
  expect(canonicalDocumentJsonV3(replayed.document)).toBe(canonicalDocumentJsonV3(local));
}

describe("historical document diff", () => {
  it("replays 100 combinations of text, marks, insertions, moves, nesting and deletion exactly", async () => {
    for (let seed = 1; seed <= 100; seed += 1) await proveExactReplay(seed);
  }, 30_000);

  it("fails closed when an existing table would require an unproved cell rewrite", async () => {
    const pageId = generateUuidV7();
    const tableId = generateUuidV7();
    const columnId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const base = {
      blocks: [
        {
          type: "table" as const,
          id: tableId,
          columns: [{ id: columnId, width: null }],
          rows: [{ id: rowId, cells: [{ id: cellId, content: [{ text: "before" }] }] }],
        },
      ],
    };
    const local = structuredClone(base);
    const table = local.blocks[0];
    const row = table?.rows[0];
    const cell = row?.cells[0];
    if (cell === undefined) throw new Error("the fixture needs one table cell");
    cell.content = [{ text: "after" }];

    await expect(diffLegacyDocuments({ pageId, base, local })).rejects.toMatchObject({
      name: LegacyDocumentDiffError.name,
      code: "legacy-recovery.complex-block",
    });
  });
});
