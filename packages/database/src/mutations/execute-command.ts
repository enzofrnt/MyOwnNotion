import type { PageDocument } from "@myownnotion/domain";
/**
 * Central mutation execution (T073/T074/T075 backbone).
 *
 * One entry point serves HTTP routes and offline batch submission: a typed
 * `MutationCommand` executes inside one transaction, appending revisions,
 * the mutation record, and the change envelope atomically. Replaying an
 * already-recorded mutation ID returns the prior result without side
 * effects (FR-040).
 */

import {
  type DomainResult,
  err,
  generateUuidV7,
  isUuid,
  type MutationCommand,
  normalizeDisplayName,
  ok,
  pageLinkTargets,
  planRestoreRevision,
  type QueuedMutationResult,
  readDocumentBody,
  replayResult,
  type SafeError,
  type Uuid,
  validateCreateItem,
  validateFavouriteItem,
  validateItemIcon,
  validateOfflineIntent,
  validatePageDocument,
  validateRenameItem,
  validateReplacePageDocument,
  validateResolveConflict,
} from "@myownnotion/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import { recordChange } from "../repositories/change-repository.ts";
import { executeConvertItem } from "../repositories/content/conversion-repository.ts";
import { rebuildEmbedUsages } from "../repositories/content/usage-repository.ts";
import { readDatabaseRecord } from "../repositories/database-repository.ts";
import {
  executeAddFilePlacement,
  executeRemovePlacement,
} from "../repositories/file-repository.ts";
import { getItem } from "../repositories/hierarchy-repository.ts";
import { executeRestore, executeTrash } from "../repositories/lifecycle-repository.ts";
import { executeMovePlacement } from "../repositories/move-branch.ts";
import { readPageOperationState } from "../repositories/page-operation-repository.ts";
import {
  executeCreateRelationship,
  executeRemoveRelationship,
} from "../repositories/relationship-repository.ts";
import {
  buildItemSnapshot,
  getRevision,
  insertRevision,
  supersedeRevision,
} from "../repositories/revision-repository.ts";
import {
  fileContents,
  items,
  logicalFiles,
  mutations,
  pageDocuments,
  placements as placementsTable,
  relationships,
} from "../schema/index.ts";
import {
  executeDatabaseCommand,
  executeDatabaseRestore,
  executeDatabaseTrash,
} from "./database-commands.ts";
import { runMutation } from "./run-mutation.ts";

export interface CommandExecution {
  readonly revisionIds: Uuid[];
  readonly changedItemIds: Uuid[];
  /** Item most relevant to the caller's response, when applicable. */
  readonly primaryItemId?: Uuid;
}

export interface MutationContext {
  readonly resolvePageBody?: (tx: Transaction, pageId: Uuid, stored: unknown) => Promise<unknown>;
  readonly workspaceId: Uuid;
  readonly mutationId: Uuid;
  readonly acceptedAt: Date;
  /** Trusted server resolver; protected snapshots never return to readable SQL. */
  readonly resolveRevisionSnapshot?: (
    tx: Transaction,
    revisionId: Uuid,
  ) => Promise<Record<string, unknown> | null>;
}

/**
 * Reconciles the derived page-link index with one saved document state.
 * Existing edges remain valid when a target is later trashed or purged: that
 * is how the reference keeps reporting the original identity as unavailable.
 * A normal edit may not introduce a new unavailable target, while restoring a
 * retained historical document may recreate that diagnostic edge.
 */
async function reconcilePageLinks(
  tx: Transaction,
  input: {
    readonly workspaceId: Uuid;
    readonly sourceItemId: Uuid;
    readonly revisionId: Uuid;
    readonly targetItemIds: readonly Uuid[];
    readonly allowUnavailableTargets?: boolean;
  },
): Promise<DomainResult<void>> {
  const existing = await tx
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.sourceItemId, input.sourceItemId),
        eq(relationships.relationType, "page:link"),
        isNull(relationships.removedRevisionId),
      ),
    );
  const desired = new Set(input.targetItemIds);
  for (const relationship of existing) {
    if (!desired.has(relationship.targetItemId as Uuid)) {
      await tx
        .update(relationships)
        .set({ removedRevisionId: input.revisionId })
        .where(eq(relationships.id, relationship.id));
    }
    desired.delete(relationship.targetItemId as Uuid);
  }
  for (const targetItemId of desired) {
    const target = await getItem(tx, targetItemId);
    if (
      target === null ||
      target.kind === "file" ||
      (!input.allowUnavailableTargets && target.lifecycle === "purged")
    ) {
      return err("relationship.endpoint-unavailable", "Internal page-link target is unavailable");
    }
    await tx.insert(relationships).values({
      id: generateUuidV7(),
      workspaceId: input.workspaceId,
      sourceItemId: input.sourceItemId,
      targetItemId,
      relationType: "page:link",
      metadata: {},
      createdRevisionId: input.revisionId,
    });
  }
  return ok(undefined);
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
    ...(command.icon !== undefined ? { icon: command.icon } : {}),
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
    icon: plan.value.item.icon,
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
    // Client-generated placement identity keeps offline projections and the
    // canonical store referring to the same placement (UUIDv7 principle).
    id: plan.value.placement.id ?? generateUuidV7(),
    workspaceId: context.workspaceId,
    itemId: plan.value.item.id,
    // Always false here, and the type says so: `item.create` accepts only
    // 'page' and 'folder'. Files enter through `file.placement.add`, which sets
    // this to true itself.
    itemIsFile: false,
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

async function executeSetItemIcon(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "item.icon" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const plan = validateItemIcon({ getItem: () => item }, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  const revisionId = generateUuidV7();
  await tx
    .update(items)
    .set({ icon: plan.value.icon, currentRevisionId: revisionId, updatedAt: context.acceptedAt })
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

/**
 * Marks or unmarks a favourite, with a revision like any other item change.
 *
 * A revision for a shortcut looks heavy, and it is deliberate: the browser
 * projection learns about items through revisions, so a change that skipped the
 * lineage would be invisible on every other device — which is precisely the
 * property FR-012 asks for by making favourites per-installation.
 */
/**
 * Marks an item to be kept on the owner's devices (feature 005, FR-016).
 *
 * A revision like any other item change, for the reason `item.favourite`
 * documents: the browser projection learns about items through revisions, so a
 * change outside the lineage never reaches the other devices — which is exactly
 * the point of the instruction.
 *
 * For a folder this marks the folder only. Inheritance is resolved when the
 * branch is read, so moving a branch cannot leave a stale marking behind and a
 * newly added child is covered without anyone rewriting it.
 */
async function executeOfflineIntent(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "item.offline" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateOfflineIntent(view, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  const revisionId = generateUuidV7();
  await tx
    .update(items)
    .set({
      offlineIntent: plan.value.offline,
      currentRevisionId: revisionId,
      updatedAt: context.acceptedAt,
    })
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

async function executeFavouriteItem(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "item.favourite" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateFavouriteItem(view, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  const revisionId = generateUuidV7();
  await tx
    .update(items)
    .set({
      favourite: plan.value.favourite,
      currentRevisionId: revisionId,
      updatedAt: context.acceptedAt,
    })
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
  // The legacy full-document protocol and the operational page journal are
  // mutually exclusive authorities. This check deliberately lives in the
  // same SERIALIZABLE transaction as the replacement: a route-level check can
  // be overtaken by activation, and a transaction retry would then execute the
  // replacement without running that route hook again.
  const operational = await readPageOperationState(tx, context.workspaceId, command.itemId);
  if (operational?.status === "active" || operational?.status === "blocked") {
    return err(
      "page-operations.protocol-read-only",
      "This page uses convergent synchronization and cannot be replaced as one document.",
    );
  }
  const item = await getItem(tx, command.itemId);
  const plan = validateReplacePageDocument(item, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  return persistPageDocumentRevision(tx, context, {
    itemId: plan.value.item.id,
    document: plan.value.document,
    pageLinkTargetIds: plan.value.pageLinkTargetIds,
    parentRevisionIds: [plan.value.parentRevisionId],
  });
}

/**
 * Commits an owner's conflict resolution as a revision with two parents
 * (feature 006, FR-016).
 *
 * Validations remain specific to conflict resolution. Both reviewed parents
 * are explicitly passed to the common document commit, which retains their
 * headers and starts both retention clocks in the same transaction.
 */
async function executeResolveConflict(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "document.resolve-conflict" }>,
): Promise<DomainResult<CommandExecution>> {
  const item = await getItem(tx, command.itemId);
  const plan = validateResolveConflict(item, command);
  if (!plan.ok) {
    return plan as DomainResult<CommandExecution>;
  }
  return persistPageDocumentRevision(tx, context, {
    itemId: plan.value.item.id,
    document: plan.value.document,
    pageLinkTargetIds: plan.value.pageLinkTargetIds,
    parentRevisionIds: plan.value.parentRevisionIds,
  });
}

async function executeRestoreRevision(
  tx: Transaction,
  context: MutationContext,
  command: Extract<MutationCommand, { type: "revision.restore" }>,
): Promise<DomainResult<CommandExecution>> {
  const raw = await getRevision(tx, command.revisionId);
  if (raw === null) {
    return err("revision.not-found", "Revision does not exist");
  }
  if (
    raw.snapshotExpiresAt !== null &&
    Date.parse(raw.snapshotExpiresAt) <= context.acceptedAt.getTime()
  ) {
    return err("revision.snapshot-expired", "Revision content is no longer retained");
  }
  const resolvedSnapshot = await context.resolveRevisionSnapshot?.(tx, command.revisionId);
  const source = {
    ...raw,
    // A configured protected resolver is authoritative. Falling back to
    // the legacy column after it returns null would resurrect a readable
    // historical copy after its authenticated envelope was lost.
    snapshot:
      context.resolveRevisionSnapshot === undefined ? raw.snapshot : (resolvedSnapshot ?? null),
  };
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
  const restoredName = typeof restored["name"] === "string" ? restored["name"] : null;
  const normalizedRestoredName = restoredName === null ? null : normalizeDisplayName(restoredName);
  if (normalizedRestoredName !== null && !normalizedRestoredName.ok) {
    return normalizedRestoredName as DomainResult<CommandExecution>;
  }
  const restoredDocument = restored["pageDocument"] as
    | { format: "myownnotion.document+json"; formatVersion: number; body: Record<string, unknown> }
    | null
    | undefined;
  if (item.kind === "page" && restoredDocument != null) {
    const document = validatePageDocument(restoredDocument);
    if (!document.ok) return document as DomainResult<CommandExecution>;
  }
  if (item.kind === "file") {
    const file = restored["file"];
    if (
      file === null ||
      typeof file !== "object" ||
      !("contentId" in file) ||
      typeof file.contentId !== "string" ||
      !isUuid(file.contentId) ||
      !("originalName" in file) ||
      typeof file.originalName !== "string" ||
      !("mediaType" in file) ||
      typeof file.mediaType !== "string" ||
      !("byteLength" in file) ||
      typeof file.byteLength !== "number"
    ) {
      return err("revision.snapshot-expired", "Retained file content is unavailable");
    }
    const originalName = normalizeDisplayName(file.originalName);
    if (!originalName.ok) {
      return originalName as DomainResult<CommandExecution>;
    }
    const [content] = await tx
      .select()
      .from(fileContents)
      .where(eq(fileContents.id, file.contentId))
      .limit(1);
    if (
      content === undefined ||
      content.verifiedAt === null ||
      content.byteLength !== file.byteLength
    )
      return err("revision.snapshot-expired", "Retained file content is unavailable");
    await tx
      .update(fileContents)
      .set({ referenceCount: sql`${fileContents.referenceCount} + 1` })
      .where(eq(fileContents.id, content.id));
    await tx
      .update(logicalFiles)
      .set({
        contentId: content.id,
        originalName: originalName.value,
        mediaType: file.mediaType,
        byteLength: content.byteLength,
      })
      .where(eq(logicalFiles.itemId, item.id));
  }
  const revisionId = generateUuidV7();
  if (normalizedRestoredName?.ok) {
    await tx
      .update(items)
      .set({
        name: normalizedRestoredName.value,
        currentRevisionId: revisionId,
        updatedAt: context.acceptedAt,
      })
      .where(eq(items.id, item.id));
  } else {
    await tx
      .update(items)
      .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
      .where(eq(items.id, item.id));
  }
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
    const read = readDocumentBody(restoredDocument.body);
    const restoredPageLinkTargets =
      read.kind === "blocks" && read.result.ok ? pageLinkTargets(read.result.document) : [];
    const reconciled = await reconcilePageLinks(tx, {
      workspaceId: context.workspaceId,
      sourceItemId: item.id,
      revisionId,
      targetItemIds: restoredPageLinkTargets,
      allowUnavailableTargets: true,
    });
    if (!reconciled.ok) {
      return reconciled as DomainResult<CommandExecution>;
    }
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
    case "item.icon":
      return executeSetItemIcon(tx, context, command);
    case "item.favourite":
      return executeFavouriteItem(tx, context, command);
    case "item.offline":
      return executeOfflineIntent(tx, context, command);
    case "item.convert": {
      const result = await executeConvertItem(tx, {
        command,
        mutationId: context.mutationId,
        acceptedAt: context.acceptedAt,
        insertRevision: (revision) => insertRevision(tx, revision),
        buildItemSnapshot: (itemId) => buildItemSnapshot(tx, itemId),
        ...(context.resolvePageBody === undefined
          ? {}
          : {
              resolvePageBody: (pageId: Uuid, stored: unknown) =>
                context.resolvePageBody?.(tx, pageId, stored) ?? Promise.resolve(stored),
            }),
        supersedeRevision: (revisionId, at) => supersedeRevision(tx, revisionId, at),
      });
      return result.ok
        ? ok({
            revisionIds: result.value.revisionIds,
            changedItemIds: result.value.changedItemIds,
            primaryItemId: result.value.itemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "item.trash": {
      const lifecycleInput = {
        mutationId: context.mutationId,
        itemId: command.itemId,
        acceptedAt: context.acceptedAt,
      };
      const result = (await readDatabaseRecord(tx, command.itemId))
        ? await executeDatabaseTrash(tx, lifecycleInput)
        : await executeTrash(tx, lifecycleInput);
      return result.ok
        ? ok({
            revisionIds: result.value.revisionIds,
            changedItemIds: result.value.changedItemIds,
            primaryItemId: result.value.rootItemId,
          })
        : (result as DomainResult<CommandExecution>);
    }
    case "item.restore": {
      const lifecycleInput = {
        mutationId: context.mutationId,
        itemId: command.itemId,
        ...(command.fallbackParentItemId !== undefined
          ? { fallbackParentItemId: command.fallbackParentItemId }
          : {}),
        acceptedAt: context.acceptedAt,
      };
      const result = (await readDatabaseRecord(tx, command.itemId))
        ? await executeDatabaseRestore(tx, lifecycleInput)
        : await executeRestore(tx, lifecycleInput);
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
    case "document.resolve-conflict":
      return executeResolveConflict(tx, context, command);
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
    case "database.create":
    case "database.source.create":
    case "database.source.delete":
    case "database_view.create":
    case "database.definition.replace":
    case "database.definition.resolve-conflict":
    case "database.presentation.replace":
    case "database.entry.create":
    case "database.entry.values.replace":
    case "database.entry.values.resolve-conflict":
      return executeDatabaseCommand(tx, context, command);
    default: {
      const exhaustive: never = command;
      throw new Error(`unhandled command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface SubmitOutcome {
  readonly result: QueuedMutationResult;
  readonly primaryItemId?: Uuid;
  /** Canonical identities affected by a newly committed mutation. */
  readonly changedItemIds?: readonly Uuid[];
  /**
   * The feed position this mutation reached, once it is committed (feature 006).
   *
   * Returned rather than published from inside the transaction, and that is the
   * whole point of carrying it out here. A notification sent before the commit
   * tells a device to fetch a cursor the database has not reached yet: the fetch
   * returns nothing, the device believes it is up to date, and the change it was
   * told about is the one it will never ask for again. So the position leaves as
   * a value, and the caller — which is the code that knows the transaction
   * returned — decides to announce it.
   *
   * Absent for a replay and for a rejection: neither appended anything, and
   * announcing a position that did not move would make every retry look like a
   * change to every connected device.
   */
  readonly committedSequence?: number;
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
    readonly resolveRevisionSnapshot?: MutationContext["resolveRevisionSnapshot"];
    readonly resolvePageBody?: MutationContext["resolvePageBody"];
    /** Acquire deployment maintenance guards before touching canonical rows. */
    readonly beforeExecute?: (tx: Transaction) => Promise<void>;
    /**
     * Runs inside the mutation's transaction, after the command is accepted.
     *
     * The encryption layer seals payloads here. Doing it afterwards, on a
     * separate connection, was both slower — an extra round trip on every
     * mutation, enough to push a journey past its timeout — and wrong: a
     * failure between the two left committed content with no envelope. Inside
     * the transaction, the content and its envelope commit together or neither
     * does.
     *
     * This package knows nothing about encryption; it calls a callback. A
     * throw here rolls the whole mutation back, which is the intended
     * behaviour: content that could not be sealed must not be stored.
     */
    readonly onAccepted?: (
      tx: Transaction,
      accepted: {
        readonly revisionIds: readonly Uuid[];
        readonly changedItemIds: readonly Uuid[];
        readonly primaryItemId?: Uuid;
      },
    ) => Promise<void>;
  },
): Promise<SubmitOutcome> {
  const acceptedAt = (input.now ?? (() => new Date()))();
  try {
    return await runMutation(db, async (tx) => {
      await input.beforeExecute?.(tx);
      const existing = await readMutationRecord(tx, input.mutationId);
      if (existing !== undefined) {
        return {
          result: mutationReplayResult(existing),
        };
      }

      const context: MutationContext = {
        workspaceId: input.workspaceId,
        mutationId: input.mutationId,
        acceptedAt,
        ...(input.resolvePageBody === undefined ? {} : { resolvePageBody: input.resolvePageBody }),
        ...(input.resolveRevisionSnapshot === undefined
          ? {}
          : { resolveRevisionSnapshot: input.resolveRevisionSnapshot }),
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
      const committedSequence = await recordChange(tx, {
        workspaceId: input.workspaceId,
        mutationId: input.mutationId,
        revisionIds: execution.value.revisionIds,
        changedItemIds: execution.value.changedItemIds,
      });

      // Last, and still inside the transaction. A throw from here rolls the
      // mutation back, so content that could not be sealed is never stored.
      if (input.onAccepted !== undefined) {
        await input.onAccepted(tx, {
          revisionIds: execution.value.revisionIds,
          changedItemIds: execution.value.changedItemIds,
          ...(execution.value.primaryItemId !== undefined
            ? { primaryItemId: execution.value.primaryItemId }
            : {}),
        });
      }

      return {
        result: {
          mutationId: input.mutationId,
          status: "accepted" as const,
          revisionIds: execution.value.revisionIds,
        },
        committedSequence,
        changedItemIds: execution.value.changedItemIds,
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
          // Retained so a replay can return the same competing identities the
          // first response carried (FR-042).
          competingRevisionIds: [...(error.safeError.competingRevisionIds ?? [])],
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
          result: mutationReplayResult(record),
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

async function persistPageDocumentRevision(
  tx: Transaction,
  context: MutationContext,
  input: {
    readonly itemId: Uuid;
    readonly document: PageDocument;
    readonly pageLinkTargetIds: readonly Uuid[];
    readonly parentRevisionIds: readonly Uuid[];
  },
): Promise<DomainResult<CommandExecution>> {
  const revisionId = generateUuidV7();
  await tx
    .insert(pageDocuments)
    .values({
      pageId: input.itemId,
      format: input.document.format,
      formatVersion: input.document.formatVersion,
      body: input.document.body,
    })
    .onConflictDoUpdate({
      target: pageDocuments.pageId,
      set: {
        format: input.document.format,
        formatVersion: input.document.formatVersion,
        body: input.document.body,
      },
    });
  const reconciled = await reconcilePageLinks(tx, {
    workspaceId: context.workspaceId,
    sourceItemId: input.itemId,
    revisionId,
    targetItemIds: input.pageLinkTargetIds,
  });
  if (!reconciled.ok) {
    return reconciled as DomainResult<CommandExecution>;
  }
  await rebuildEmbedUsages(tx, input.itemId, input.document.body);
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, input.itemId));
  const snapshot = await buildItemSnapshot(tx, input.itemId);
  // Every supplied parent remains an ancestor. Conflict resolution supplies
  // both reviewed versions, making preservation structural (006 FR-016).
  await insertRevision(tx, {
    id: revisionId,
    itemId: input.itemId,
    mutationId: context.mutationId,
    parentRevisionIds: input.parentRevisionIds,
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  // Start retention for all superseded snapshots; headers and parent edges
  // survive pruning, including both lineages of a conflict resolution.
  for (const parentRevisionId of input.parentRevisionIds) {
    await supersedeRevision(tx, parentRevisionId, context.acceptedAt);
  }
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [input.itemId],
    primaryItemId: input.itemId,
  });
}

function mutationReplayResult(
  row: NonNullable<Awaited<ReturnType<typeof readMutationRecord>>>,
): ReturnType<typeof replayResult> {
  return replayResult({
    id: row.id as Uuid,
    workspaceId: row.workspaceId as Uuid,
    commandType: row.commandType,
    status: row.status as "accepted" | "rejected",
    submittedAt: row.submittedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    resultRevisionIds: row.resultRevisionIds as Uuid[],
    failureCode: row.failureCode,
    competingRevisionIds: row.competingRevisionIds as Uuid[],
  });
}
