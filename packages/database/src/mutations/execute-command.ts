/**
 * Central mutation execution (T073/T074/T075 backbone).
 *
 * One entry point serves HTTP routes and offline batch submission: a typed
 * `MutationCommand` executes inside one transaction, appending revisions,
 * the mutation record, and the change envelope atomically. Replaying an
 * already-recorded mutation ID returns the prior result without side
 * effects (FR-040).
 */
import { eq } from "drizzle-orm";
import {
  err,
  generateUuidV7,
  ok,
  replayResult,
  validateCreateItem,
  validateRenameItem,
  validateReplacePageDocument,
  planRestoreRevision,
  type DomainResult,
  type MutationCommand,
  type QueuedMutationResult,
  type SafeError,
  type Uuid,
} from "@myownnotion/domain";
import type { Database, Transaction } from "../client.ts";
import { items, mutations, pageDocuments } from "../schema/index.ts";
import { placements as placementsTable } from "../schema/index.ts";
import { getItem } from "../repositories/hierarchy-repository.ts";
import {
  buildItemSnapshot,
  getRevision,
  insertRevision,
  supersedeRevision,
} from "../repositories/revision-repository.ts";
import { recordChange } from "../repositories/change-repository.ts";
import { executeMovePlacement } from "../repositories/move-branch.ts";
import { executeRestore, executeTrash } from "../repositories/lifecycle-repository.ts";
import {
  executeAddFilePlacement,
  executeRemovePlacement,
} from "../repositories/file-repository.ts";
import {
  executeCreateRelationship,
  executeRemoveRelationship,
} from "../repositories/relationship-repository.ts";
import { runMutation } from "./run-mutation.ts";

export interface CommandExecution {
  readonly revisionIds: Uuid[];
  readonly changedItemIds: Uuid[];
  /** Item most relevant to the caller's response, when applicable. */
  readonly primaryItemId?: Uuid;
}

export interface MutationContext {
  readonly workspaceId: Uuid;
  readonly mutationId: Uuid;
  readonly acceptedAt: Date;
}

async function executeCreateItem(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "item.create" }>,
): Promise<DomainResult<CommandExecution>> {
  const existing = await getItem(tx, command.id);
  const parent =
    command.placement.parentItemId === null
      ? null
      : await getItem(tx, command.placement.parentItemId);
  const view = {
    getItem: (id: Uuid) => (id === existing?.id ? existing : id === parent?.id ? parent : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateCreateItem(view, {
    id: command.id,
    kind: command.kind,
    name: command.name,
    placement: command.placement,
    ...(command.pageDocument !== undefined ? { pageDocument: command.pageDocument } : {}),
  });
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }

  const revisionId = generateUuidV7();
  await tx.insert(items).values({
    id: plan.value.item.id,
    workspaceId: context.workspaceId,
    kind: plan.value.item.kind,
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  if (plan.value.pageDocument !== null) {
    await tx.insert(pageDocuments).values({
      pageId: plan.value.item.id,
      format: plan.value.pageDocument.format,
      formatVersion: plan.value.pageDocument.formatVersion,
      body: plan.value.pageDocument.body,
    });
  }
  await tx.insert(placementsTable).values({
    id: generateUuidV7(),
    workspaceId: context.workspaceId,
    itemId: plan.value.item.id,
    itemKind: plan.value.item.kind,
    kind: "hierarchy",
    parentItemId: plan.value.placement.parentItemId,
    positionKey: plan.value.placement.positionKey,
    createdRevisionId: revisionId,
  });
  const snapshot = await buildItemSnapshot(tx, plan.value.item.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: plan.value.item.id,
    mutationId: context.mutationId,
    parentRevisionIds: [],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [plan.value.item.id],
    primaryItemId: plan.value.item.id,
  });
}

async function executeRenameItem(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "item.rename" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateRenameItem(view, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  const revisionId = generateUuidV7();
  await tx
    .update(items)
    .set({ name: plan.value.name, currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, plan.value.item.id));
  const snapshot = await buildItemSnapshot(tx, plan.value.item.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: plan.value.item.id,
    mutationId: context.mutationId,
    parentRevisionIds: [plan.value.item.currentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(tx, plan.value.item.currentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [plan.value.item.id],
    primaryItemId: plan.value.item.id,
  });
}

async function executeReplacePageDocument(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "page.document.replace" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const plan = validateReplacePageDocument(item, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  const revisionId = generateUuidV7();
  await tx
    .insert(pageDocuments)
    .values({
      pageId: plan.value.item.id,
      format: plan.value.document.format,
      formatVersion: plan.value.document.formatVersion,
      body: plan.value.document.body,
    })
    .onConflictDoUpdate({
      target: pageDocuments.pageId,
      set: {
        format: plan.value.document.format,
        formatVersion: plan.value.document.formatVersion,
        body: plan.value.document.body,
      },
    });
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, plan.value.item.id));
  const snapshot = await buildItemSnapshot(tx, plan.value.item.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: plan.value.item.id,
    mutationId: context.mutationId,
    parentRevisionIds: [plan.value.parentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(tx, plan.value.parentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [plan.value.item.id],
    primaryItemId: plan.value.item.id,
  });
}

async function executeRestoreRevision(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "revision.restore" }>,
): Promise<DomainResult<CommandExecution>> {
  const source = await getRevision(tx, command.revisionId);
  if (source === null) {
    return err("revision.not-found", "Revision does not exist");
  }
  const item = await getItem(tx, source.itemId);
  if (item === null) {
    return err("item.not-found", "Revised item does not exist");
  }
  const plan = planRestoreRevision(source, item.currentRevisionId, {
    revisionId: command.revisionId,
    expectedCurrentRevisionId: command.currentRevisionId,
  });
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }

  // Restoration applies the retained content as new state (never rewriting
  // history): name and page document are restored; lifecycle and placements
  // are not touched by a content restore.
  const restored = plan.value.restoredSnapshot;
  const revisionId = generateUuidV7();
  const restoredName = typeof restored["name"] === "string" ? (restored["name"] as string) : null;
  if (restoredName !== null) {
    await tx
      .update(items)
      .set({ name: restoredName, currentRevisionId: revisionId, updatedAt: context.acceptedAt })
      .where(eq(items.id, item.id));
  } else {
    await tx
      .update(items)
      .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
      .where(eq(items.id, item.id));
  }
  const restoredDocument = restored["pageDocument"] as
    | { format: "myownnotion.document+json"; formatVersion: number; body: Record<string, unknown> }
    | null
    | undefined;
  if (item.kind === "page" && restoredDocument != null) {
    await tx
      .insert(pageDocuments)
      .values({
        pageId: item.id,
        format: restoredDocument.format,
        formatVersion: restoredDocument.formatVersion,
        body: restoredDocument.body,
      })
      .onConflictDoUpdate({
        target: pageDocuments.pageId,
        set: {
          format: restoredDocument.format,
          formatVersion: restoredDocument.formatVersion,
          body: restoredDocument.body,
        },
      });
  }
  const snapshot = await buildItemSnapshot(tx, item.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: item.id,
    mutationId: context.mutationId,
    parentRevisionIds: [plan.value.parentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(tx, plan.value.parentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [item.id],
    primaryItemId: item.id,
  });
}

export async function executeCommand(
  tx: Transaction,
  context: MutationContext,
  command: MutationCommand,
): Promise<DomainResult<CommandExecution>> {
  switch (command.type) {
    case "item.create":
      return executeCreateItem(tx, context, command);
    case "item.rename":
      return executeRenameItem(tx, context, command);
    case "item.trash": {
      const result = await executeTrash(tx, {
        mutationId: context.mutationId,
        itemId: command.itemId,
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: result.value.revisionIds,
            changedItemIds: result.value.changedItemIds,
            primaryItemId: result.value.rootItemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "item.restore": {
      const result = await executeRestore(tx, {
        mutationId: context.mutationId,
        itemId: command.itemId,
        ...(command.fallbackParentItemId !== undefined
          ? { fallbackParentItemId: command.fallbackParentItemId }
          : {}),
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: result.value.revisionIds,
            changedItemIds: result.value.changedItemIds,
            primaryItemId: result.value.rootItemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "placement.move": {
      const result = await executeMovePlacement(tx, {
        mutationId: context.mutationId,
        command,
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: [result.value.revisionId],
            changedItemIds: [result.value.itemId],
            primaryItemId: result.value.itemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "placement.remove": {
      const result = await executeRemovePlacement(tx, {
        mutationId: context.mutationId,
        placementId: command.placementId,
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: [result.value.revisionId],
            changedItemIds: [result.value.itemId],
            primaryItemId: result.value.itemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "file.placement.add": {
      const result = await executeAddFilePlacement(tx, {
        mutationId: context.mutationId,
        command: {
          itemId: command.itemId,
          kind: command.kind,
          parentItemId: command.parentItemId,
          positionKey: command.positionKey,
        },
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: [result.value.revisionId],
            changedItemIds: [result.value.itemId],
            primaryItemId: result.value.itemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "page.document.replace":
      return executeReplacePageDocument(tx, context, command);
    case "relationship.create": {
      const result = await executeCreateRelationship(tx, {
        mutationId: context.mutationId,
        workspaceId: context.workspaceId,
        command,
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: [result.value.revisionId],
            changedItemIds: [result.value.sourceItemId],
            primaryItemId: result.value.sourceItemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "relationship.remove": {
      const result = await executeRemoveRelationship(tx, {
        mutationId: context.mutationId,
        relationshipId: command.relationshipId,
        acceptedAt: context.acceptedAt,
      });
      return result.ok
        ? ok({
            revisionIds: [result.value.revisionId],
            changedItemIds: [result.value.sourceItemId],
            primaryItemId: result.value.sourceItemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "revision.restore":
      return executeRestoreRevision(tx, context, command);
    default: {
      const exhaustive: never = command;
      throw new Error(`unhandled command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface SubmitOutcome {
  readonly result: QueuedMutationResult;
  readonly primaryItemId?: Uuid;
}

function conflictStatus(error: SafeError): "conflict" | "rejected" {
  return error.code === "revision.stale-base" || error.code === "mutation.conflict"
    ? "conflict"
    : "rejected";
}

async function readMutationRecord(tx: Transaction, mutationId: Uuid) {
  const rows = await tx.select().from(mutations).where(eq(mutations.id, mutationId)).limit(1);
  return rows[0];
}

/**
 * Submits one mutation with full idempotency semantics: an existing mutation
 * ID replays its prior terminal result; a fresh one executes atomically and
 * records the mutation plus its change envelope.
 */
export async function submitMutation(
  db: Database,
  input: {
    readonly workspaceId: Uuid;
    readonly mutationId: Uuid;
    readonly commandType: string;
    readonly command: MutationCommand;
    readonly now?: () => Date;
  },
): Promise<SubmitOutcome> {
  const acceptedAt = (input.now ?? (() => new Date()))();
  try {
    return await runMutation(db, async (tx) => {
      const existing = await readMutationRecord(tx, input.mutationId);
      if (existing !== undefined) {
        return {
          result: replayResult({
            id: existing.id as Uuid,
            workspaceId: existing.workspaceId as Uuid,
            commandType: existing.commandType,
            status: existing.status as "accepted" | "rejected",
            submittedAt: existing.submittedAt.toISOString(),
            acceptedAt: existing.acceptedAt?.toISOString() ?? null,
            resultRevisionIds: existing.resultRevisionIds as Uuid[],
            failureCode: existing.failureCode,
          }),
        };
      }

      const context: MutationContext = {
        workspaceId: input.workspaceId,
        mutationId: input.mutationId,
        acceptedAt,
      };
      const execution = await executeCommand(tx, context, input.command);
      if (!execution.ok) {
        // Throwing rolls back every partial write of this command (FR-018);
        // the rejection itself is recorded outside this transaction.
        throw new DomainRejection(execution.error);
      }

      await tx.insert(mutations).values({
        id: input.mutationId,
        workspaceId: input.workspaceId,
        commandType: input.commandType,
        status: "accepted",
        submittedAt: acceptedAt,
        acceptedAt,
        resultRevisionIds: execution.value.revisionIds,
      });
      await recordChange(tx, {
        workspaceId: input.workspaceId,
        mutationId: input.mutationId,
        revisionIds: execution.value.revisionIds,
        changedItemIds: execution.value.changedItemIds,
      });
      return {
        result: {
          mutationId: input.mutationId,
          status: "accepted" as const,
          revisionIds: execution.value.revisionIds,
        },
        ...(execution.value.primaryItemId !== undefined
          ? { primaryItemId: execution.value.primaryItemId }
          : {}),
      };
    });
  } catch (error) {
    if (error instanceof DomainRejection) {
      // Record the terminal rejection (idempotent) so replays observe the
      // same outcome without re-executing side effects.
      await db
        .insert(mutations)
        .values({
          id: input.mutationId,
          workspaceId: input.workspaceId,
          commandType: input.commandType,
          status: "rejected",
          submittedAt: acceptedAt,
          failureCode: error.safeError.code,
        })
        .onConflictDoNothing();
      return {
        result: {
          mutationId: input.mutationId,
          status: conflictStatus(error.safeError),
          ...(error.safeError.competingRevisionIds !== undefined
            ? { competingRevisionIds: error.safeError.competingRevisionIds }
            : {}),
          problem: error.safeError,
        },
      };
    }
    if (isUniqueViolationOnMutations(error)) {
      // Concurrent duplicate submission: read and replay the winner's result.
      const replay = await db
        .select()
        .from(mutations)
        .where(eq(mutations.id, input.mutationId))
        .limit(1);
      const record = replay[0];
      if (record !== undefined) {
        return {
          result: replayResult({
            id: record.id as Uuid,
            workspaceId: record.workspaceId as Uuid,
            commandType: record.commandType,
            status: record.status as "accepted" | "rejected",
            submittedAt: record.submittedAt.toISOString(),
            acceptedAt: record.acceptedAt?.toISOString() ?? null,
            resultRevisionIds: record.resultRevisionIds as Uuid[],
            failureCode: record.failureCode,
          }),
        };
      }
    }
    throw error;
  }
}

export class DomainRejection extends Error {
  readonly safeError: SafeError;
  constructor(safeError: SafeError) {
    super(safeError.title);
    this.name = "DomainRejection";
    this.safeError = safeError;
  }
}

function isUniqueViolationOnMutations(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && candidate.constraint === "mutations_pkey";
}
