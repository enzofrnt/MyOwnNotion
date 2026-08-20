import {
  type BlockDocument,
  type BlockDocumentV3,
  type CanonicalBlockV3,
  canonicalDocumentJsonV3,
  childrenOfV3,
  documentDigestV3,
  hasInlineContentV3,
  type JsonValue,
  type MarkV3,
  migrateDocumentV2ToV3,
  normaliseDocumentV3,
  type Uuid,
} from "@myownnotion/domain";
import { isTransformableBlockType } from "./block-tree.ts";
import {
  OperationalPageDocument,
  type PageCommand,
  type PageTransactionResult,
} from "./document.ts";
import type { PageAmbiguity, PageAmbiguityKind } from "./semantic-conflicts.ts";

const MAX_CONTEXT_LENGTH = 64;

export type LegacySemanticCommand =
  | {
      readonly type: "insert-block";
      readonly block: CanonicalBlockV3;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | {
      readonly type: "move-block";
      readonly blockId: Uuid;
      readonly parentBlockId: Uuid | null;
      readonly beforeBlockId: Uuid | null;
    }
  | { readonly type: "delete-block"; readonly blockId: Uuid }
  | {
      readonly type: "replace-text";
      readonly blockId: Uuid;
      readonly baseFrom: number;
      readonly baseTo: number;
      readonly beforeContext: string;
      readonly afterContext: string;
      readonly text: string;
    }
  | {
      readonly type: "set-mark";
      readonly blockId: Uuid;
      readonly baseFrom: number;
      readonly baseTo: number;
      readonly mark: MarkV3;
      readonly enabled: boolean;
    }
  | {
      readonly type: "set-type-or-property";
      readonly blockId: Uuid;
      readonly key: string;
      readonly before: JsonValue;
      readonly after: JsonValue;
    };

export interface LegacySemanticTransaction {
  readonly transactionId: Uuid;
  readonly sequence: number;
  readonly commands: readonly LegacySemanticCommand[];
}

export interface LegacyOfflineBranch {
  readonly mode: "legacy-branch";
  readonly branchId: Uuid;
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseCanonicalDigest: string;
  readonly baseDocument: BlockDocumentV3;
  readonly localDocument: BlockDocumentV3;
  readonly localDocumentDigest: string;
  readonly semanticTransactions: readonly LegacySemanticTransaction[];
  readonly createdAt: string;
  readonly status: "editing" | "sending" | "blocked" | "converted";
}

export interface LegacyBranchReplayResult {
  readonly document: BlockDocumentV3;
  readonly digest: string;
}

export interface LegacyBranchConversionResult {
  readonly convertedBranchId: Uuid;
  readonly localDocumentDigest: string;
  readonly commands: readonly PageCommand[];
  readonly transaction: PageTransactionResult | undefined;
  readonly ambiguities: readonly PageAmbiguity[];
}

export class LegacyOfflineBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyOfflineBranchError";
  }
}

interface IndexedNode {
  readonly id: Uuid;
  readonly block: CanonicalBlockV3 | undefined;
  readonly text: string | undefined;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
}

function inlineText(block: CanonicalBlockV3): string | undefined {
  if (block.type === "unknown") return undefined;
  if (hasInlineContentV3(block)) return block.content.map(({ text }) => text).join("");
  if (block.type === "code") return block.text;
  return undefined;
}

function indexDocument(document: BlockDocumentV3): Map<Uuid, IndexedNode> {
  const result = new Map<Uuid, IndexedNode>();
  const visit = (blocks: readonly CanonicalBlockV3[], parentBlockId: Uuid | null): void => {
    for (const [index, block] of blocks.entries()) {
      result.set(block.id, {
        id: block.id,
        block,
        text: inlineText(block),
        parentBlockId,
        beforeBlockId: blocks[index + 1]?.id ?? null,
      });
      if (block.type === "unknown") continue;
      if (block.type === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            result.set(cell.id, {
              id: cell.id,
              block: undefined,
              text: cell.content.map(({ text }) => text).join(""),
              parentBlockId: block.id,
              beforeBlockId: null,
            });
            visit(cell.children ?? [], cell.id);
          }
        }
      } else {
        visit(childrenOfV3(block), block.id);
      }
    }
  };
  visit(document.blocks, null);
  return result;
}

function canonicalValue(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key];
        if (child === undefined) throw new LegacyOfflineBranchError(`JSON key ${key} is undefined`);
        return `${JSON.stringify(key)}:${canonicalValue(child)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalValue(left) === canonicalValue(right);
}

function blockProperty(block: CanonicalBlockV3, key: string): JsonValue | undefined {
  if (key === "type") return block.type;
  if (block.type === "unknown") return block.raw[key];
  const direct = (block as unknown as Record<string, unknown>)[key];
  if (
    direct === null ||
    typeof direct === "string" ||
    typeof direct === "number" ||
    typeof direct === "boolean" ||
    Array.isArray(direct)
  ) {
    return direct as JsonValue;
  }
  if (direct !== undefined && typeof direct === "object") return direct as JsonValue;
  return block.rawExtraProperties?.[key];
}

function assertTextRange(text: string, from: number, to: number): void {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from > to ||
    to > text.length
  ) {
    throw new LegacyOfflineBranchError("legacy text range is outside its block");
  }
  for (const offset of [from, to]) {
    if (offset <= 0 || offset >= text.length) continue;
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
      throw new LegacyOfflineBranchError("legacy text range splits a UTF-16 surrogate pair");
    }
  }
}

function assertContexts(
  text: string,
  from: number,
  to: number,
  beforeContext: string,
  afterContext: string,
): void {
  if (beforeContext.length > MAX_CONTEXT_LENGTH || afterContext.length > MAX_CONTEXT_LENGTH) {
    throw new LegacyOfflineBranchError(
      `legacy text contexts must not exceed ${MAX_CONTEXT_LENGTH}`,
    );
  }
  if (text.slice(Math.max(0, from - beforeContext.length), from) !== beforeContext) {
    throw new LegacyOfflineBranchError("legacy before-context does not match its source text");
  }
  if (text.slice(to, to + afterContext.length) !== afterContext) {
    throw new LegacyOfflineBranchError("legacy after-context does not match its source text");
  }
}

function proofCommand(command: LegacySemanticCommand, document: BlockDocumentV3): PageCommand {
  const nodes = indexDocument(document);
  switch (command.type) {
    case "insert-block":
    case "move-block":
    case "delete-block":
      return command;
    case "replace-text": {
      const text = nodes.get(command.blockId)?.text;
      if (text === undefined) {
        throw new LegacyOfflineBranchError(`legacy text block ${command.blockId} does not exist`);
      }
      assertTextRange(text, command.baseFrom, command.baseTo);
      assertContexts(
        text,
        command.baseFrom,
        command.baseTo,
        command.beforeContext,
        command.afterContext,
      );
      return {
        type: "replace-text",
        blockId: command.blockId,
        from: command.baseFrom,
        to: command.baseTo,
        text: command.text,
      };
    }
    case "set-mark": {
      const text = nodes.get(command.blockId)?.text;
      if (text === undefined) {
        throw new LegacyOfflineBranchError(`legacy text block ${command.blockId} does not exist`);
      }
      assertTextRange(text, command.baseFrom, command.baseTo);
      return {
        type: "set-mark",
        blockId: command.blockId,
        from: command.baseFrom,
        to: command.baseTo,
        mark: command.mark,
        enabled: command.enabled,
      };
    }
    case "set-type-or-property": {
      const block = nodes.get(command.blockId)?.block;
      if (block === undefined) {
        throw new LegacyOfflineBranchError(`legacy block ${command.blockId} does not exist`);
      }
      const current = blockProperty(block, command.key) ?? null;
      if (!valuesEqual(current, command.before)) {
        throw new LegacyOfflineBranchError(
          `legacy ${command.key} precondition does not match block ${command.blockId}`,
        );
      }
      if (command.key === "type") {
        if (!isTransformableBlockType(command.after)) {
          throw new LegacyOfflineBranchError(
            `legacy target type ${String(command.after)} is unsupported`,
          );
        }
        return { type: "set-block-type", blockId: command.blockId, blockType: command.after };
      }
      return {
        type: "set-block-property",
        blockId: command.blockId,
        key: command.key,
        value: command.after,
      };
    }
  }
}

async function replay(
  pageId: Uuid,
  baseDocument: BlockDocumentV3,
  transactions: readonly LegacySemanticTransaction[],
): Promise<LegacyBranchReplayResult> {
  const page = OperationalPageDocument.create({
    pageId,
    document: baseDocument,
  });
  const seenTransactions = new Set<Uuid>();
  for (const [index, transaction] of transactions.entries()) {
    if (transaction.sequence !== index + 1) {
      throw new LegacyOfflineBranchError(
        "legacy transaction sequences must be contiguous from one",
      );
    }
    if (seenTransactions.has(transaction.transactionId)) {
      throw new LegacyOfflineBranchError(
        `legacy transaction ${transaction.transactionId} is duplicated`,
      );
    }
    seenTransactions.add(transaction.transactionId);
    for (const command of transaction.commands) {
      const projection = await page.project();
      page.transact([proofCommand(command, projection.document)]);
    }
  }
  const document = (await page.project()).document;
  return { document, digest: await documentDigestV3(document) };
}

export async function createLegacyOfflineBranch(input: {
  readonly branchId: Uuid;
  readonly pageId: Uuid;
  readonly baseRevisionId: Uuid;
  readonly baseDocument: BlockDocument;
  readonly createdAt: string;
}): Promise<LegacyOfflineBranch> {
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new LegacyOfflineBranchError("legacy branch creation time must be RFC 3339 compatible");
  }
  const baseDocument = normaliseDocumentV3(migrateDocumentV2ToV3(input.baseDocument));
  const baseCanonicalDigest = await documentDigestV3(baseDocument);
  return {
    mode: "legacy-branch",
    branchId: input.branchId,
    pageId: input.pageId,
    baseRevisionId: input.baseRevisionId,
    baseCanonicalDigest,
    baseDocument,
    localDocument: baseDocument,
    localDocumentDigest: baseCanonicalDigest,
    semanticTransactions: [],
    createdAt: input.createdAt,
    status: "editing",
  };
}

export async function appendLegacySemanticTransaction(
  branch: LegacyOfflineBranch,
  transaction: LegacySemanticTransaction,
): Promise<LegacyOfflineBranch> {
  if (branch.status !== "editing") {
    throw new LegacyOfflineBranchError(`legacy branch in ${branch.status} state cannot be edited`);
  }
  if (transaction.sequence !== branch.semanticTransactions.length + 1) {
    throw new LegacyOfflineBranchError("legacy transaction sequence is not the next sequence");
  }
  if (
    branch.semanticTransactions.some(
      ({ transactionId }) => transactionId === transaction.transactionId,
    )
  ) {
    throw new LegacyOfflineBranchError(
      `legacy transaction ${transaction.transactionId} is duplicated`,
    );
  }
  const semanticTransactions = [...branch.semanticTransactions, transaction];
  const replayed = await replay(branch.pageId, branch.baseDocument, semanticTransactions);
  return {
    ...branch,
    semanticTransactions,
    localDocument: replayed.document,
    localDocumentDigest: replayed.digest,
  };
}

export async function verifyLegacyOfflineBranch(
  branch: LegacyOfflineBranch,
): Promise<LegacyBranchReplayResult> {
  if (branch.mode !== "legacy-branch") {
    throw new LegacyOfflineBranchError("unsupported legacy branch mode");
  }
  const baseDigest = await documentDigestV3(branch.baseDocument);
  if (baseDigest !== branch.baseCanonicalDigest) {
    throw new LegacyOfflineBranchError("legacy base document digest mismatch");
  }
  const replayed = await replay(branch.pageId, branch.baseDocument, branch.semanticTransactions);
  if (
    replayed.digest !== branch.localDocumentDigest ||
    canonicalDocumentJsonV3(replayed.document) !== canonicalDocumentJsonV3(branch.localDocument)
  ) {
    throw new LegacyOfflineBranchError(
      "legacy local projection does not match its semantic replay",
    );
  }
  return replayed;
}

function allOccurrences(value: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const result: number[] = [];
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1)) {
    result.push(index);
  }
  return result;
}

function locateContextGap(
  current: string,
  command: Extract<LegacySemanticCommand, { type: "replace-text" }>,
): { readonly beforeEnd: number; readonly afterStart: number } | undefined {
  const beforeEnds =
    command.beforeContext.length === 0
      ? [0]
      : allOccurrences(current, command.beforeContext).map(
          (index) => index + command.beforeContext.length,
        );
  const afterStarts =
    command.afterContext.length === 0
      ? [current.length]
      : allOccurrences(current, command.afterContext);
  const expectedLength = command.baseTo - command.baseFrom;
  const candidates = beforeEnds
    .flatMap((beforeEnd) =>
      afterStarts
        .filter((afterStart) => afterStart >= beforeEnd)
        .map((afterStart) => ({
          beforeEnd,
          afterStart,
          score:
            Math.abs(afterStart - beforeEnd - expectedLength) +
            Math.abs(beforeEnd - command.baseFrom) / Math.max(1, current.length),
        })),
    )
    .sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (best === undefined) return undefined;
  const next = candidates[1];
  if (next !== undefined && next.score === best.score) return undefined;
  return best;
}

function sameBlock(left: CanonicalBlockV3, right: CanonicalBlockV3): boolean {
  return (
    canonicalDocumentJsonV3({ blocks: [left] }) === canonicalDocumentJsonV3({ blocks: [right] })
  );
}

function sourcePair(left: Uuid, right: Uuid): readonly [Uuid, Uuid] {
  return left < right ? [left, right] : [right, left];
}

function legacyAmbiguity(input: {
  readonly branch: LegacyOfflineBranch;
  readonly transactionId: Uuid;
  readonly kind: PageAmbiguityKind;
  readonly blockId: Uuid;
  readonly deletedSubtree?: CanonicalBlockV3;
  readonly recoverableSubtree: CanonicalBlockV3;
  readonly parentBlockId: Uuid | null;
  readonly beforeBlockId: Uuid | null;
  readonly propertyKey?: string;
}): PageAmbiguity {
  const sourceUpdateIds = sourcePair(input.branch.baseRevisionId, input.transactionId);
  const discriminator = input.propertyKey ?? "";
  return {
    logicalKey: ["legacy", input.kind, input.branch.branchId, input.blockId, discriminator].join(
      ":",
    ),
    kind: input.kind,
    status: "open",
    blockIds: [input.blockId],
    sourceUpdateIds,
    ...(input.deletedSubtree === undefined ? {} : { deletedSubtree: input.deletedSubtree }),
    recoverableSubtree: input.recoverableSubtree,
    recoverablePlacement: {
      parentBlockId: input.parentBlockId,
      beforeBlockId: input.beforeBlockId,
    },
    ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey }),
  };
}

function activeCommand(input: {
  readonly branch: LegacyOfflineBranch;
  readonly transactionId: Uuid;
  readonly command: LegacySemanticCommand;
  readonly proofBefore: BlockDocumentV3;
  readonly proofAfter: BlockDocumentV3;
  readonly active: BlockDocumentV3;
}): { readonly command?: PageCommand; readonly ambiguity?: PageAmbiguity } {
  const proofBefore = indexDocument(input.proofBefore);
  const proofAfter = indexDocument(input.proofAfter);
  const active = indexDocument(input.active);
  const command = input.command;
  const recoverable = proofAfter.get(
    "blockId" in command ? command.blockId : command.block.id,
  )?.block;
  const ambiguity = (
    kind: PageAmbiguityKind,
    blockId: Uuid,
    deletedSubtree?: CanonicalBlockV3,
    propertyKey?: string,
  ) => {
    const changed = recoverable ?? proofBefore.get(blockId)?.block;
    if (changed === undefined) {
      throw new LegacyOfflineBranchError(`legacy ambiguity ${blockId} has no recoverable block`);
    }
    const placement = proofAfter.get(blockId) ?? proofBefore.get(blockId);
    return legacyAmbiguity({
      branch: input.branch,
      transactionId: input.transactionId,
      kind,
      blockId,
      ...(deletedSubtree === undefined ? {} : { deletedSubtree }),
      recoverableSubtree: changed,
      parentBlockId: placement?.parentBlockId ?? null,
      beforeBlockId: placement?.beforeBlockId ?? null,
      ...(propertyKey === undefined ? {} : { propertyKey }),
    });
  };

  switch (command.type) {
    case "insert-block": {
      const existing = active.get(command.block.id)?.block;
      if (existing === undefined) return { command };
      if (sameBlock(existing, command.block)) return {};
      return { ambiguity: ambiguity("schema", command.block.id) };
    }
    case "move-block": {
      if (active.get(command.blockId)?.block === undefined) {
        return { ambiguity: ambiguity("delete-move", command.blockId) };
      }
      return {
        command: {
          ...command,
          beforeBlockId:
            command.beforeBlockId !== null && active.has(command.beforeBlockId)
              ? command.beforeBlockId
              : null,
        },
      };
    }
    case "delete-block": {
      const current = active.get(command.blockId);
      if (current?.block === undefined) return {};
      const before = proofBefore.get(command.blockId);
      if (before?.block === undefined) {
        return { ambiguity: ambiguity("schema", command.blockId) };
      }
      if (!sameBlock(current.block, before.block)) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before.block) };
      }
      if (
        current.parentBlockId !== before.parentBlockId ||
        current.beforeBlockId !== before.beforeBlockId
      ) {
        return { ambiguity: ambiguity("delete-move", command.blockId, before.block) };
      }
      return { command };
    }
    case "replace-text": {
      const current = active.get(command.blockId);
      const before = proofBefore.get(command.blockId);
      if (current?.text === undefined || before?.text === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before?.block) };
      }
      const gap = locateContextGap(current.text, command);
      if (gap === undefined) return { ambiguity: ambiguity("schema", command.blockId) };
      const removed = before.text.slice(command.baseFrom, command.baseTo);
      const currentGap = current.text.slice(gap.beforeEnd, gap.afterStart);
      if (command.baseFrom === command.baseTo) {
        return {
          command: {
            type: "replace-text",
            blockId: command.blockId,
            from: gap.afterStart,
            to: gap.afterStart,
            text: command.text,
          },
        };
      }
      if (currentGap === command.text) return {};
      if (currentGap !== removed) return { ambiguity: ambiguity("schema", command.blockId) };
      return {
        command: {
          type: "replace-text",
          blockId: command.blockId,
          from: gap.beforeEnd,
          to: gap.afterStart,
          text: command.text,
        },
      };
    }
    case "set-mark": {
      const current = active.get(command.blockId);
      const before = proofBefore.get(command.blockId);
      if (current?.text === undefined || before?.text === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, before?.block) };
      }
      if (current.text !== before.text) return { ambiguity: ambiguity("schema", command.blockId) };
      return {
        command: {
          type: "set-mark",
          blockId: command.blockId,
          from: command.baseFrom,
          to: command.baseTo,
          mark: command.mark,
          enabled: command.enabled,
        },
      };
    }
    case "set-type-or-property": {
      const current = active.get(command.blockId)?.block;
      const beforeBlock = proofBefore.get(command.blockId)?.block;
      if (current === undefined || beforeBlock === undefined) {
        return { ambiguity: ambiguity("delete-edit", command.blockId, beforeBlock) };
      }
      const currentValue = blockProperty(current, command.key) ?? null;
      if (valuesEqual(currentValue, command.after)) return {};
      if (!valuesEqual(currentValue, command.before)) {
        return {
          ambiguity: ambiguity(
            command.key === "type" ? "type-transform" : "property-transform",
            command.blockId,
            undefined,
            command.key === "type" ? undefined : command.key,
          ),
        };
      }
      return { command: proofCommand(command, input.proofBefore) };
    }
  }
}

export async function convertLegacyOfflineBranch(input: {
  readonly branch: LegacyOfflineBranch;
  readonly activePage: OperationalPageDocument;
}): Promise<LegacyBranchConversionResult> {
  await verifyLegacyOfflineBranch(input.branch);
  if (input.activePage.pageId !== input.branch.pageId) {
    throw new LegacyOfflineBranchError("legacy branch page does not match the active page");
  }
  const proofPage = OperationalPageDocument.create({
    pageId: input.branch.pageId,
    document: input.branch.baseDocument,
  });
  const activeStart = (await input.activePage.project()).document;
  const workingPage = OperationalPageDocument.create({
    pageId: input.branch.pageId,
    document: activeStart,
  });
  const commands: PageCommand[] = [];
  const ambiguities = new Map<string, PageAmbiguity>();

  for (const transaction of input.branch.semanticTransactions) {
    for (const legacyCommand of transaction.commands) {
      const proofBefore = (await proofPage.project()).document;
      proofPage.transact([proofCommand(legacyCommand, proofBefore)]);
      const proofAfter = (await proofPage.project()).document;
      const active = (await workingPage.project()).document;
      const translated = activeCommand({
        branch: input.branch,
        transactionId: transaction.transactionId,
        command: legacyCommand,
        proofBefore,
        proofAfter,
        active,
      });
      if (translated.ambiguity !== undefined) {
        ambiguities.set(translated.ambiguity.logicalKey, translated.ambiguity);
      }
      if (translated.command !== undefined) {
        try {
          workingPage.transact([translated.command]);
          commands.push(translated.command);
        } catch (error) {
          throw new LegacyOfflineBranchError(
            `legacy command cannot be translated safely: ${error instanceof Error ? error.message : "unknown failure"}`,
          );
        }
      }
    }
  }

  const proof = await proofPage.project();
  if (
    proof.canonicalDigest !== input.branch.localDocumentDigest ||
    canonicalDocumentJsonV3(proof.document) !== canonicalDocumentJsonV3(input.branch.localDocument)
  ) {
    throw new LegacyOfflineBranchError("legacy proof changed during conversion");
  }
  const transaction = commands.length === 0 ? undefined : input.activePage.transact(commands);
  return {
    convertedBranchId: input.branch.branchId,
    localDocumentDigest: input.branch.localDocumentDigest,
    commands,
    transaction,
    ambiguities: [...ambiguities.values()],
  };
}
