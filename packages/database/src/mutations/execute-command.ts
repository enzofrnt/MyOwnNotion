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
  type MutationCommand,
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
  validateOfflineIntent,
  validateRenameItem,
  validateReplacePageDocument,
  validateResolveConflict,
} from "@myownnotion/domain";
import { and, eq, isNull } from "drizzle-orm";
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
  items,
  mutations,
  pageDocuments,
  placements as placementsTable,
  relationships,
} from "../schema/index.ts";
import {
  executeDatabaseCommand,
  executeDatabaseRestore,
  executeDatabaseTrash,
  hasStructuredPageRole,
} from "./database-commands.ts";
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
  // Both indexes derived from this document are rebuilt here, inside the same
  // transaction that writes it. They answer different questions — which pages
  // this one links to, and which files it embeds — and share one reason for
  // being here rather than after the commit: an index written in a second
  // transaction has a window in which it disagrees with the page it describes.
  const reconciled = await reconcilePageLinks(tx, {
    workspaceId: context.workspaceId,
    sourceItemId: plan.value.item.id,
    revisionId,
    targetItemIds: plan.value.pageLinkTargetIds,
  });
  if (!reconciled.ok) {
    return reconciled as DomainResult<CommandExecution>;
  }
  // For file usages that window is the dangerous one: the deletion
  // confirmation shown during it says "nothing uses this" about a file the
  // page still shows (FR-004).
  await rebuildEmbedUsages(tx, plan.value.item.id, plan.value.document.body);
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

/**
 * Commits an owner's conflict resolution as a revision with two parents
 * (feature 006, FR-016).
 *
 * Almost the same body as `executeReplacePageDocument`, and deliberately not
 * factored together with it. The two differ in what they do to history — one
 * parent versus two, and which revisions start their retention clock — and that
 * is precisely the part a shared helper would hide behind a flag. A reader
 * asking "does resolving destroy either version?" can answer it from this
 * function alone.
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
  const reconciled = await reconcilePageLinks(tx, {
    workspaceId: context.workspaceId,
    sourceItemId: plan.value.item.id,
    revisionId,
    targetItemIds: plan.value.pageLinkTargetIds,
  });
  if (!reconciled.ok) {
    return reconciled as DomainResult<CommandExecution>;
  }
  await rebuildEmbedUsages(tx, plan.value.item.id, plan.value.document.body);
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, plan.value.item.id));
  const snapshot = await buildItemSnapshot(tx, plan.value.item.id);
  // Both parents. This single line is what makes FR-016 structural: the two
  // versions the owner chose between remain reachable as ancestors of the
  // resolution, so "the originals are kept" is a fact about the graph rather
  // than a promise about a retention job.
  await insertRevision(tx, {
    id: revisionId,
    itemId: plan.value.item.id,
    mutationId: context.mutationId,
    parentRevisionIds: plan.value.parentRevisionIds,
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  // Both clocks start, not just the head's. A superseded snapshot is retained
  // for its window and then pruned; the *headers and parent edges are never
  // deleted*, so the lineage survives the pruning and the resolution keeps
  // reading as a place where two lines of work rejoined.
  for (const parentRevisionId of plan.value.parentRevisionIds) {
    await supersedeRevision(tx, parentRevisionId, context.acceptedAt);
  }
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
    case "item.favourite":
      return executeFavouriteItem(tx, context, command);
    case "item.offline":
      return executeOfflineIntent(tx, context, command);
    case "item.convert": {
      if (command.targetKind === "folder" && (await hasStructuredPageRole(tx, command.itemId))) {
        return err("database.page-required", "A database host or entry must remain a page");
      }
      const result = await executeConvertItem(tx, {
        command,
        mutationId: context.mutationId,
        acceptedAt: context.acceptedAt,
        insertRevision: (revision) => insertRevision(tx, revision),
        buildItemSnapshot: (itemId) => buildItemSnapshot(tx, itemId),
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
    case "database.definition.replace":
    case "database.definition.resolve-conflict":
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
            competingRevisionIds: existing.competingRevisionIds as Uuid[],
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
          result: replayResult({
            id: record.id as Uuid,
            workspaceId: record.workspaceId as Uuid,
            commandType: record.commandType,
            status: record.status as "accepted" | "rejected",
            submittedAt: record.submittedAt.toISOString(),
            acceptedAt: record.acceptedAt?.toISOString() ?? null,
            resultRevisionIds: record.resultRevisionIds as Uuid[],
            failureCode: record.failureCode,
            competingRevisionIds: record.competingRevisionIds as Uuid[],
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
