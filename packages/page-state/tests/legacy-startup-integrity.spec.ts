import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type { PageSemanticChange } from "../src/document.ts";
import {
  appendLegacySemanticTransaction,
  convertLegacyOfflineBranch,
  createLegacyOfflineBranch,
  legacySemanticCommandsFromTransaction,
  OperationalPageDocument,
  verifyLegacyOfflineBranch,
} from "../src/index.ts";

async function fixture() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const branch = await createLegacyOfflineBranch({
    branchId: generateUuidV7(),
    pageId,
    baseRevisionId: generateUuidV7(),
    baseDocument: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "ABC" }] }] },
    createdAt: "2026-10-07T10:00:00Z",
  });
  const page = OperationalPageDocument.create({ pageId, document: branch.baseDocument });
  const transaction = page.transact([{ type: "replace-text", blockId, from: 1, to: 2, text: "X" }]);
  const proof = (change: PageSemanticChange) =>
    legacySemanticCommandsFromTransaction({
      pageId,
      beforeDocument: branch.baseDocument,
      transaction: { ...transaction, semanticChanges: [change] },
    });
  const textChange = transaction.semanticChanges[0];
  if (textChange?.type !== "text-replaced") throw new Error("Expected real text transaction");
  return { pageId, blockId, branch, page, transaction, proof, textChange };
}

describe("legacy startup rejects unverifiable local intent proofs", () => {
  it.each([
    ["heading", { level: 2 }],
    ["checkbox", { checked: true }],
    ["code", { language: "typescript" }],
  ] as const)("retains %s settings in a replayable transform", async (blockType, properties) => {
    const f = await fixture();
    const page = OperationalPageDocument.create({
      pageId: f.pageId,
      document: f.branch.baseDocument,
    });
    const transaction = page.transact([
      { type: "set-block-type", blockId: f.blockId, blockType, properties },
    ]);
    const commands = legacySemanticCommandsFromTransaction({
      pageId: f.pageId,
      beforeDocument: f.branch.baseDocument,
      transaction,
    });
    const edited = await appendLegacySemanticTransaction(f.branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands,
    });
    expect((await verifyLegacyOfflineBranch(edited)).document).toEqual(page.snapshot());
  });

  it("keeps a text edit recoverable when all its contextual anchors disappeared", async () => {
    const f = await fixture();
    const commands = legacySemanticCommandsFromTransaction({
      pageId: f.pageId,
      beforeDocument: f.branch.baseDocument,
      transaction: f.transaction,
    });
    const branch = await appendLegacySemanticTransaction(f.branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands,
    });
    const activePage = OperationalPageDocument.create({
      pageId: f.pageId,
      document: { blocks: [{ type: "paragraph", id: f.blockId, content: [{ text: "ZZZ" }] }] },
    });
    const before = activePage.snapshot();
    const result = await convertLegacyOfflineBranch({ branch, activePage });
    expect(result.commands).toEqual([]);
    expect(result.ambiguities).toMatchObject([
      { kind: "schema", recoverableSubtree: f.textChange.blockAfter },
    ]);
    expect(activePage.snapshot()).toEqual(before);
  });

  it.each([
    ["missing source", "missing", /not representable/u],
    ["removed text", "removed", /proof does not match/u],
    ["result text", "result", /result does not match/u],
  ] as const)("refuses a transaction with mismatched %s", async (_label, mode, message) => {
    const f = await fixture();
    const before = f.page.snapshot();
    const change =
      mode === "missing"
        ? { ...f.textChange, blockId: generateUuidV7() }
        : mode === "removed"
          ? { ...f.textChange, removedText: "wrong" }
          : {
              ...f.textChange,
              blockAfter: { type: "paragraph" as const, id: f.blockId, content: [{ text: "AXQ" }] },
            };
    expect(() => f.proof(change)).toThrow(message);
    expect(f.page.snapshot()).toEqual(before);
    expect(f.branch.semanticTransactions).toEqual([]);
  });

  it("refuses schema migration as an editor intent", async () => {
    const f = await fixture();
    expect(() =>
      f.proof({
        type: "schema-changed",
        blockId: f.blockId,
        beforeSchemaVersion: 1,
        afterSchemaVersion: 2,
        blockAfter: f.textChange.blockAfter,
      }),
    ).toThrow(/schema migrations/u);
  });

  it("refuses a mark proof whose final block differs from the replay", async () => {
    const f = await fixture();
    expect(() =>
      f.proof({
        type: "mark-set",
        blockId: f.blockId,
        from: 0,
        to: 1,
        mark: { type: "bold" },
        enabled: true,
        blockAfter: f.textChange.blockAfter,
      }),
    ).toThrow(/proof diverges/u);
  });

  it("ignores an unchanged operational transaction", async () => {
    const f = await fixture();
    expect(
      legacySemanticCommandsFromTransaction({
        pageId: f.pageId,
        beforeDocument: f.branch.baseDocument,
        transaction: { ...f.transaction, changed: false },
      }),
    ).toEqual([]);
  });

  it("detects duplicate transaction identities in a persisted branch", async () => {
    const f = await fixture();
    const transaction = {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands: legacySemanticCommandsFromTransaction({
        pageId: f.pageId,
        beforeDocument: f.branch.baseDocument,
        transaction: f.transaction,
      }),
    };
    const edited = await appendLegacySemanticTransaction(f.branch, transaction);
    await expect(
      verifyLegacyOfflineBranch({
        ...edited,
        semanticTransactions: [transaction, { ...transaction, sequence: 2 }],
      }),
    ).rejects.toThrow(/duplicated/u);
  });

  it("retains callout settings and opaque metadata in a replayable typed transform", async () => {
    const f = await fixture();
    const page = OperationalPageDocument.create({
      pageId: f.pageId,
      document: f.branch.baseDocument,
    });
    const transaction = page.transact([
      {
        type: "set-block-type",
        blockId: f.blockId,
        blockType: "callout",
        properties: { icon: "💡", tone: "blue", metadata: { nested: [true, null, 2] } },
      },
    ]);
    const commands = legacySemanticCommandsFromTransaction({
      pageId: f.pageId,
      beforeDocument: f.branch.baseDocument,
      transaction,
    });
    expect(commands).toMatchObject([
      {
        type: "set-type-or-property",
        properties: { icon: "💡", tone: "blue", metadata: { nested: [true, null, 2] } },
      },
    ]);
    const edited = await appendLegacySemanticTransaction(f.branch, {
      transactionId: generateUuidV7(),
      sequence: 1,
      commands,
    });
    expect((await verifyLegacyOfflineBranch(edited)).document).toEqual(page.snapshot());
  });
});
