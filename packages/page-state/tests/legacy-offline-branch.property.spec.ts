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
  convertLegacyOfflineBranch,
  createLegacyOfflineBranch,
  LegacyOfflineBranchError,
  OperationalPageDocument,
  planPageAmbiguityResolution,
  verifyLegacyOfflineBranch,
} from "../src/index.ts";

function legacyParagraph(id: Uuid, text: string): BlockDocument {
  return { blocks: [{ type: "paragraph", id, content: [{ text }] }] };
}

describe("legacy offline branches", () => {
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
});
