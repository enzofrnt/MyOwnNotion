import {
  asUuid,
  type BlockDocumentV3,
  type CanonicalBlockV3,
  canonicalDocumentJsonV3,
  childrenOfV3,
  collectDocumentIdsV3,
  hasInlineContentV3,
  type MarkV3,
  mayHaveChildrenV3,
  type Uuid,
  validateDocumentV3,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  OperationalPageDocument,
  type PageCommand,
  versionVectorBytesEqual,
} from "../src/index.ts";

const CONVERGENCE_RUNS = 1_000;
const DEFAULT_CONVERGENCE_SEED = 170_191;

type ActionKind =
  | "delete-block"
  | "edit-text"
  | "insert-nested"
  | "insert-root"
  | "mark-text"
  | "move-block";

interface GeneratedAction {
  readonly kind: ActionKind;
  readonly selector: number;
  readonly secondarySelector: number;
  readonly text: string;
  readonly removeWidth: number;
  readonly mark: "bold" | "italic" | "strikethrough" | "underline";
  readonly enabled: boolean;
}

interface BlockEntry {
  readonly block: CanonicalBlockV3;
  readonly parentBlockId: Uuid | null;
  readonly ancestorIds: readonly Uuid[];
}

interface DeliveredUpdate {
  readonly bytes: Uint8Array;
  readonly source: "left" | "right";
  readonly sourceSequence: number;
}

const actionArbitrary: fc.Arbitrary<GeneratedAction> = fc.record({
  kind: fc.constantFrom<ActionKind>(
    "insert-root",
    "insert-nested",
    "edit-text",
    "mark-text",
    "move-block",
    "delete-block",
  ),
  selector: fc.nat(255),
  secondarySelector: fc.nat(255),
  text: fc
    .array(fc.constantFrom("a", "b", "c", "é", "ø"), { minLength: 1, maxLength: 3 })
    .map((characters) => characters.join("")),
  removeWidth: fc.nat(2),
  mark: fc.constantFrom("bold", "italic", "strikethrough", "underline"),
  enabled: fc.boolean(),
});

const scenarioArbitrary = fc.record({
  ids: fc.uniqueArray(fc.uuid({ version: 7 }), { minLength: 24, maxLength: 24 }),
  leftActions: fc.array(actionArbitrary, { minLength: 3, maxLength: 8 }),
  rightActions: fc.array(actionArbitrary, { minLength: 3, maxLength: 8 }),
  deliveryKeys: fc.array(fc.integer(), { minLength: 16, maxLength: 16 }),
});

function configuredSeed(): number {
  const configured = process.env["MYOWNNOTION_CONVERGENCE_SEED"];
  if (configured === undefined) return DEFAULT_CONVERGENCE_SEED;
  if (!/^-?\d+$/u.test(configured)) {
    throw new TypeError("MYOWNNOTION_CONVERGENCE_SEED must be an integer");
  }
  return Number.parseInt(configured, 10);
}

function paragraph(id: Uuid, text: string): CanonicalBlockV3 {
  return { type: "paragraph", id, content: [{ text }] };
}

function flattenDocument(document: BlockDocumentV3): BlockEntry[] {
  const entries: BlockEntry[] = [];
  const visit = (
    blocks: readonly CanonicalBlockV3[],
    parentBlockId: Uuid | null,
    ancestorIds: readonly Uuid[],
  ): void => {
    for (const block of blocks) {
      entries.push({ block, parentBlockId, ancestorIds });
      visit(childrenOfV3(block), block.id, [...ancestorIds, block.id]);
    }
  };
  visit(document.blocks, null, []);
  return entries;
}

function selected<T>(values: readonly T[], selector: number): T | undefined {
  if (values.length === 0) return undefined;
  return values[selector % values.length];
}

function siblingsFor(
  document: BlockDocumentV3,
  entries: readonly BlockEntry[],
  parentBlockId: Uuid | null,
): readonly CanonicalBlockV3[] {
  if (parentBlockId === null) return document.blocks;
  const parent = entries.find(({ block }) => block.id === parentBlockId)?.block;
  return parent === undefined ? [] : childrenOfV3(parent);
}

function insertionBlock(action: GeneratedAction, blockId: Uuid): CanonicalBlockV3 {
  if (action.secondarySelector % 4 === 0) {
    return {
      type: "toggle",
      id: blockId,
      content: [{ text: `toggle-${action.text}` }],
      children: [],
    };
  }
  return paragraph(blockId, `block-${action.text}`);
}

function markFrom(action: GeneratedAction): MarkV3 {
  return { type: action.mark };
}

function commandForAction(input: {
  readonly document: BlockDocumentV3;
  readonly action: GeneratedAction;
  readonly insertedBlockId: Uuid;
  readonly permanentAnchorId: Uuid;
}): PageCommand | undefined {
  const { action, document } = input;
  const entries = flattenDocument(document);

  if (action.kind === "insert-root" || action.kind === "insert-nested") {
    const containers = entries.filter(
      ({ block }) => block.type !== "unknown" && mayHaveChildrenV3(block.type),
    );
    const selectedParent =
      action.kind === "insert-nested"
        ? (selected(containers, action.selector)?.block.id ?? null)
        : null;
    const siblings = siblingsFor(document, entries, selectedParent);
    const beforeBlockId =
      action.secondarySelector % (siblings.length + 1) === siblings.length
        ? null
        : (selected(siblings, action.secondarySelector)?.id ?? null);
    return {
      type: "insert-block",
      block: insertionBlock(action, input.insertedBlockId),
      parentBlockId: selectedParent,
      beforeBlockId,
    };
  }

  if (action.kind === "edit-text") {
    const target = selected(
      entries.filter(({ block }) => hasInlineContentV3(block)),
      action.selector,
    )?.block;
    if (target === undefined || !hasInlineContentV3(target)) return undefined;
    const textLength = target.content.reduce((length, run) => length + run.text.length, 0);
    const from = action.secondarySelector % (textLength + 1);
    const to = Math.min(textLength, from + action.removeWidth);
    return { type: "replace-text", blockId: target.id, from, to, text: action.text };
  }

  if (action.kind === "mark-text") {
    const target = selected(
      entries.filter(({ block }) => hasInlineContentV3(block)),
      action.selector,
    )?.block;
    if (target === undefined || !hasInlineContentV3(target)) return undefined;
    const textLength = target.content.reduce((length, run) => length + run.text.length, 0);
    if (textLength === 0) return undefined;
    const from = action.secondarySelector % textLength;
    const to = Math.min(textLength, from + 1 + (action.removeWidth % 2));
    return {
      type: "set-mark",
      blockId: target.id,
      from,
      to,
      mark: markFrom(action),
      enabled: action.enabled,
    };
  }

  if (action.kind === "delete-block") {
    const target = selected(
      entries.filter(({ block }) => block.id !== input.permanentAnchorId),
      action.selector,
    );
    return target === undefined ? undefined : { type: "delete-block", blockId: target.block.id };
  }

  const target = selected(entries, action.selector);
  if (target === undefined) return undefined;
  const possibleParents: Array<Uuid | null> = [
    null,
    ...entries
      .filter(
        ({ block, ancestorIds }) =>
          block.id !== target.block.id &&
          block.type !== "unknown" &&
          mayHaveChildrenV3(block.type) &&
          !ancestorIds.includes(target.block.id),
      )
      .map(({ block }) => block.id),
  ];
  const parentBlockId = selected(possibleParents, action.secondarySelector) ?? null;
  const siblings = siblingsFor(document, entries, parentBlockId).filter(
    ({ id }) => id !== target.block.id,
  );
  const beforeBlockId =
    action.selector % (siblings.length + 1) === siblings.length
      ? null
      : (selected(siblings, action.selector)?.id ?? null);
  return {
    type: "move-block",
    blockId: target.block.id,
    parentBlockId,
    beforeBlockId,
  };
}

function applyOfflineScript(input: {
  readonly replica: OperationalPageDocument;
  readonly actions: readonly GeneratedAction[];
  readonly insertedIds: readonly Uuid[];
  readonly permanentAnchorId: Uuid;
}): Uint8Array[] {
  const updates: Uint8Array[] = [];
  for (const [index, action] of input.actions.entries()) {
    const insertedBlockId = input.insertedIds[index];
    if (insertedBlockId === undefined) throw new Error("generated block identity is missing");
    const command = commandForAction({
      document: input.replica.snapshot(),
      action,
      insertedBlockId,
      permanentAnchorId: input.permanentAnchorId,
    });
    if (command === undefined) continue;
    const transaction = input.replica.transact([command]);
    if (transaction.changed) updates.push(transaction.updateBytes);
  }
  return updates;
}

function deliveryOrder(
  left: readonly Uint8Array[],
  right: readonly Uint8Array[],
  keys: readonly number[],
): DeliveredUpdate[] {
  const tagged: DeliveredUpdate[] = [
    ...left.map((bytes, sourceSequence) => ({ bytes, source: "left" as const, sourceSequence })),
    ...right.map((bytes, sourceSequence) => ({ bytes, source: "right" as const, sourceSequence })),
  ];
  return tagged.toSorted((first, second) => {
    const firstKey =
      keys[
        (first.source === "left" ? first.sourceSequence : 8 + first.sourceSequence) % keys.length
      ];
    const secondKey =
      keys[
        (second.source === "left" ? second.sourceSequence : 8 + second.sourceSequence) % keys.length
      ];
    if (firstKey !== secondKey) return (firstKey ?? 0) - (secondKey ?? 0);
    if (first.source !== second.source) return first.source.localeCompare(second.source);
    return first.sourceSequence - second.sourceSequence;
  });
}

function importDeliveries(
  replica: OperationalPageDocument,
  deliveries: readonly DeliveredUpdate[],
): void {
  for (const [index, delivery] of deliveries.entries()) {
    replica.importUpdate(delivery.bytes);
    if (index % 3 === 0) replica.importUpdate(delivery.bytes);
  }
}

function assertValidConvergedDocument(document: BlockDocumentV3): void {
  const validation = validateDocumentV3(document);
  expect(validation.ok, validation.ok ? undefined : JSON.stringify(validation.problems)).toBe(true);
  const identities = collectDocumentIdsV3(document);
  expect(new Set(identities).size).toBe(identities.length);
}

describe("generated multi-device convergence", () => {
  it("converges 1,000 offline suites under different, duplicated and out-of-order deliveries", async () => {
    const replayPath = process.env["MYOWNNOTION_CONVERGENCE_PATH"];
    await fc.assert(
      fc.asyncProperty(
        scenarioArbitrary,
        async ({ ids: rawIds, leftActions, rightActions, deliveryKeys }) => {
          const ids = rawIds.map(asUuid);
          const pageId = ids[0];
          const permanentAnchorId = ids[1];
          const toggleId = ids[2];
          const nestedId = ids[3];
          if (
            pageId === undefined ||
            permanentAnchorId === undefined ||
            toggleId === undefined ||
            nestedId === undefined
          ) {
            throw new Error("generated convergence identities are incomplete");
          }
          const origin = OperationalPageDocument.create({
            pageId,
            document: {
              blocks: [
                paragraph(permanentAnchorId, "anchor"),
                {
                  type: "toggle",
                  id: toggleId,
                  content: [{ text: "container" }],
                  children: [paragraph(nestedId, "nested")],
                },
              ],
            },
          });
          const checkpoint = await origin.checkpoint();
          const [left, right, reference, firstReceiver, secondReceiver] = await Promise.all([
            OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
            OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
            OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
            OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
            OperationalPageDocument.fromCheckpoint({ pageId, checkpoint }),
          ]);
          const leftUpdates = applyOfflineScript({
            replica: left,
            actions: leftActions,
            insertedIds: ids.slice(4, 12),
            permanentAnchorId,
          });
          const rightUpdates = applyOfflineScript({
            replica: right,
            actions: rightActions,
            insertedIds: ids.slice(12, 20),
            permanentAnchorId,
          });

          for (const update of leftUpdates) reference.importUpdate(update);
          for (const update of rightUpdates) reference.importUpdate(update);
          for (const update of rightUpdates.toReversed()) left.importUpdate(update);
          for (const update of leftUpdates.toReversed()) right.importUpdate(update);

          const deliveries = deliveryOrder(leftUpdates, rightUpdates, deliveryKeys);
          importDeliveries(firstReceiver, deliveries);
          importDeliveries(secondReceiver, deliveries.toReversed());

          const expected = await reference.project();
          const replicas = [left, right, firstReceiver, secondReceiver];
          for (const replica of replicas) {
            const projection = await replica.project();
            expect(canonicalDocumentJsonV3(projection.document)).toBe(
              canonicalDocumentJsonV3(expected.document),
            );
            expect(projection.canonicalDigest).toBe(expected.canonicalDigest);
            expect(
              versionVectorBytesEqual(replica.versionVectorBytes(), reference.versionVectorBytes()),
            ).toBe(true);
            assertValidConvergedDocument(projection.document);
          }
        },
      ),
      {
        numRuns: CONVERGENCE_RUNS,
        seed: configuredSeed(),
        endOnFailure: true,
        ...(replayPath === undefined ? {} : { path: replayPath }),
      },
    );
  }, 180_000);
});
