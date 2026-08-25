import {
  asUuid,
  canonicalDocumentJsonV3,
  collectDocumentIdsV3,
  type Uuid,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectPageAmbiguities,
  OperationalPageDocument,
  planPageAmbiguityResolution,
  semanticUpdateFromTransaction,
  versionVectorBytesEqual,
} from "../src/index.ts";

const RUNS = 100;
const SEED = 180_027;

const scenarioArbitrary = fc.record({
  ids: fc.uniqueArray(fc.uuid({ version: 7 }), { minLength: 7, maxLength: 7 }),
  prefix: fc
    .array(fc.constantFrom("a", "b", "é", "ø", " "), { minLength: 1, maxLength: 6 })
    .map((characters) => characters.join("")),
});

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: [{ text }] };
}

async function replicas(rawIds: readonly string[]) {
  const ids = rawIds.map(asUuid);
  const [pageId, firstId, targetId, thirdId, fourthId, leftUpdateId, rightUpdateId] = ids;
  if (
    pageId === undefined ||
    firstId === undefined ||
    targetId === undefined ||
    thirdId === undefined ||
    fourthId === undefined ||
    leftUpdateId === undefined ||
    rightUpdateId === undefined
  ) {
    throw new Error("generated realtime convergence identities are incomplete");
  }
  const origin = OperationalPageDocument.create({
    pageId,
    document: {
      blocks: [
        paragraph(firstId, "premier"),
        paragraph(targetId, "partagé"),
        paragraph(thirdId, "troisième"),
        paragraph(fourthId, "dernier"),
      ],
    },
  });
  const checkpoint = await origin.checkpoint();
  const [left, right] = await Promise.all([
    OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
    OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
  ]);
  return {
    pageId,
    firstId,
    targetId,
    thirdId,
    fourthId,
    leftUpdateId,
    rightUpdateId,
    left,
    right,
  };
}

async function expectConverged(
  left: OperationalPageDocument,
  right: OperationalPageDocument,
): Promise<void> {
  const [leftProjection, rightProjection] = await Promise.all([left.project(), right.project()]);
  expect(canonicalDocumentJsonV3(rightProjection.document)).toBe(
    canonicalDocumentJsonV3(leftProjection.document),
  );
  expect(rightProjection.canonicalDigest).toBe(leftProjection.canonicalDigest);
  expect(versionVectorBytesEqual(left.versionVectorBytes(), right.versionVectorBytes())).toBe(true);
  const ids = collectDocumentIdsV3(leftProjection.document);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("focused realtime block convergence", () => {
  it("converges 100 concurrent move-and-edit pairs without losing either intention", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async ({ ids, prefix }) => {
        const state = await replicas(ids);
        const move = state.left.transact([
          {
            type: "move-block",
            blockId: state.targetId,
            parentBlockId: null,
            beforeBlockId: state.fourthId,
          },
        ]);
        const edit = state.right.transact([
          {
            type: "replace-text",
            blockId: state.targetId,
            from: 0,
            to: 0,
            text: prefix,
          },
        ]);

        state.left.importUpdate(edit.updateBytes);
        state.left.importUpdate(edit.updateBytes);
        state.right.importUpdate(move.updateBytes);
        state.right.importUpdate(move.updateBytes);
        await expectConverged(state.left, state.right);

        const projection = await state.left.project();
        expect(projection.document.blocks.map(({ id }) => id)).toEqual([
          state.firstId,
          state.thirdId,
          state.targetId,
          state.fourthId,
        ]);
        expect(canonicalDocumentJsonV3(projection.document)).toContain(`${prefix}partagé`);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  it("converges 100 conflicting moves to one deterministic, duplicate-free placement", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async ({ ids }) => {
        const state = await replicas(ids);
        const moveToStart = state.left.transact([
          {
            type: "move-block",
            blockId: state.targetId,
            parentBlockId: null,
            beforeBlockId: state.firstId,
          },
        ]);
        const moveToEnd = state.right.transact([
          {
            type: "move-block",
            blockId: state.targetId,
            parentBlockId: null,
            beforeBlockId: null,
          },
        ]);

        state.right.importUpdate(moveToStart.updateBytes);
        state.left.importUpdate(moveToEnd.updateBytes);
        await expectConverged(state.left, state.right);

        const idsAfter = (await state.left.project()).document.blocks.map(({ id }) => id);
        expect(idsAfter.filter((id) => id === state.targetId)).toHaveLength(1);
        expect(idsAfter).toHaveLength(4);
      }),
      { numRuns: RUNS, seed: SEED + 1 },
    );
  });

  it("keeps 100 delete-and-edit races recoverable, then converges their resolution", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async ({ ids, prefix }) => {
        const state = await replicas(ids);
        const deletion = state.left.transact([{ type: "delete-block", blockId: state.targetId }]);
        const edit = state.right.transact([
          {
            type: "replace-text",
            blockId: state.targetId,
            from: 0,
            to: 0,
            text: prefix,
          },
        ]);
        const ambiguity = detectPageAmbiguities([
          semanticUpdateFromTransaction(state.leftUpdateId, deletion),
          semanticUpdateFromTransaction(state.rightUpdateId, edit),
        ])[0];
        expect(ambiguity).toMatchObject({ kind: "delete-edit", status: "open" });
        expect(JSON.stringify(ambiguity?.recoverableSubtree)).toContain(`${prefix}partagé`);

        state.left.importUpdate(edit.updateBytes);
        state.right.importUpdate(deletion.updateBytes);
        await expectConverged(state.left, state.right);
        if (ambiguity === undefined) throw new Error("delete/edit ambiguity was not retained");

        const resolution = state.left.transact(
          planPageAmbiguityResolution(ambiguity, {
            decision: "restore-change",
            parentBlockId: null,
            beforeBlockId: state.thirdId,
          }).commands,
        );
        state.right.importUpdate(resolution.updateBytes);
        await expectConverged(state.left, state.right);
        expect(canonicalDocumentJsonV3((await state.left.project()).document)).toContain(
          `${prefix}partagé`,
        );
      }),
      { numRuns: RUNS, seed: SEED + 2 },
    );
  });
});
