/**
 * Logical-file and placement persistence (T057, US2).
 *
 * Independent imports always create independent logical files — there is no
 * implicit logical merging. Physical reuse is decided by the blob store
 * (verified byte equality) and is invisible here: two logical files may point
 * at the same file_contents row without sharing any logical behavior.
 * Content replacement is copy-on-write: a new content row per accepted
 * update, only for the addressed logical file.
 */

import {
  type AddFilePlacementCommand,
  type DomainResult,
  err,
  generateUuidV7,
  normalizeDisplayName,
  ok,
  planRemoveFilePlacement,
  type Uuid,
  validateAddFilePlacement,
} from "@myownnotion/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { fileContents, items, lifecycleEvents, logicalFiles, placements } from "../schema/index.ts";
import { recordPlacementUsage, removePlacementUsage } from "./content/usage-repository.ts";
import { getActivePlacements, getItem, getPlacement } from "./hierarchy-repository.ts";
import { buildItemSnapshot, insertRevision, supersedeRevision } from "./revision-repository.ts";

export interface StoredContent {
  readonly contentId: Uuid;
  readonly sha256: Uint8Array;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly verifiedAt: Date;
  /** True when the blob store safely reused existing verified bytes. */
  readonly reusedExisting: boolean;
}

/**
 * Registers stored content metadata (idempotent on physical reuse).
 *
 * Concurrent identical imports both write the same content-addressed
 * storage key: the unique key makes one insert a no-op and the surviving
 * row is reused — physical reuse stays invisible to logical files.
 */
export async function registerContent(tx: Transaction, content: StoredContent): Promise<Uuid> {
  if (content.reusedExisting) {
    await tx
      .update(fileContents)
      .set({ referenceCount: sql`${fileContents.referenceCount} + 1` })
      .where(eq(fileContents.id, content.contentId));
    return content.contentId;
  }
  await tx
    .insert(fileContents)
    .values({
      id: content.contentId,
      sha256: content.sha256,
      byteLength: content.byteLength,
      storageKey: content.storageKey,
      verifiedAt: content.verifiedAt,
      referenceCount: 0,
    })
    .onConflictDoNothing({ target: fileContents.storageKey });
  const rows = await tx
    .select()
    .from(fileContents)
    .where(eq(fileContents.storageKey, content.storageKey))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("content registration failed");
  }
  await tx
    .update(fileContents)
    .set({ referenceCount: sql`${fileContents.referenceCount} + 1` })
    .where(eq(fileContents.id, row.id));
  return row.id as Uuid;
}

export interface ImportFileInput {
  readonly mutationId: Uuid;
  readonly workspaceId: Uuid;
  readonly itemId: Uuid;
  readonly name: string;
  readonly mediaType: string;
  readonly content: StoredContent;
  readonly placement: {
    readonly kind: "hierarchy" | "attachment";
    readonly parentItemId: Uuid | null;
    readonly positionKey: string;
  };
  readonly acceptedAt: Date;
}

export interface FileExecution {
  readonly revisionId: Uuid;
  readonly itemId: Uuid;
}

export async function executeImportFile(
  tx: Transaction,
  input: ImportFileInput,
): Promise<DomainResult<FileExecution>> {
  const name = normalizeDisplayName(input.name);
  if (!name.ok) {
    return name as DomainResult<FileExecution>;
  }
  const existing = await getItem(tx, input.itemId);
  if (existing !== null) {
    return err("mutation.duplicate", "An item with this identity already exists");
  }
  if (input.placement.parentItemId !== null) {
    const parent = await getItem(tx, input.placement.parentItemId);
    if (parent === null || parent.lifecycle !== "active") {
      return err("containment.parent-not-found", "Parent item does not exist");
    }
    if (parent.kind === "file") {
      return err("containment.file-cannot-contain", "Files are terminal");
    }
    if (input.placement.kind === "attachment" && parent.kind !== "page") {
      return err("containment.attachment-parent-must-be-page", "Attachments require a page");
    }
  } else if (input.placement.kind === "attachment") {
    return err("containment.attachment-parent-must-be-page", "Attachments require a page");
  }

  const revisionId = generateUuidV7();
  const contentId = await registerContent(tx, input.content);
  await tx.insert(items).values({
    id: input.itemId,
    workspaceId: input.workspaceId,
    kind: "file",
    name: name.value,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  });
  await tx.insert(logicalFiles).values({
    itemId: input.itemId,
    contentId,
    mediaType: input.mediaType,
    originalName: name.value,
    byteLength: input.content.byteLength,
  });
  await tx.insert(placements).values({
    id: generateUuidV7(),
    workspaceId: input.workspaceId,
    itemId: input.itemId,
    itemIsFile: true,
    kind: input.placement.kind,
    parentItemId: input.placement.parentItemId,
    positionKey: input.placement.positionKey,
    createdRevisionId: revisionId,
  });
  const snapshot = await buildItemSnapshot(tx, input.itemId);
  await insertRevision(tx, {
    id: revisionId,
    itemId: input.itemId,
    mutationId: input.mutationId,
    parentRevisionIds: [],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  return ok({ revisionId, itemId: input.itemId });
}

export async function executeAddFilePlacement(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly command: AddFilePlacementCommand;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<FileExecution>> {
  const item = await getItem(tx, input.command.itemId);
  const parent =
    input.command.parentItemId === null ? null : await getItem(tx, input.command.parentItemId);
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : id === parent?.id ? parent : null),
    getActivePlacements: () => [] as const,
    getActiveChildren: () => [] as const,
  };
  const plan = validateAddFilePlacement(view, input.command);
  if (!plan.ok) {
    return plan as DomainResult<FileExecution>;
  }

  const revisionId = generateUuidV7();
  const file = plan.value.item;
  await tx.insert(placements).values({
    id: generateUuidV7(),
    workspaceId: file.workspaceId,
    itemId: file.id,
    itemIsFile: true,
    kind: plan.value.kind,
    parentItemId: plan.value.parentItemId,
    positionKey: plan.value.positionKey,
    createdRevisionId: revisionId,
  });
  // The placement is a usage: it is what a deletion confirmation has to name
  // (FR-004). Recorded here, in the same transaction as the placement itself,
  // so the two cannot disagree.
  await recordPlacementUsage(tx, {
    fileItemId: file.id,
    parentItemId: plan.value.parentItemId,
    kind: plan.value.kind,
  });
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
    .where(eq(items.id, file.id));
  const snapshot = await buildItemSnapshot(tx, file.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: file.id,
    mutationId: input.mutationId,
    parentRevisionIds: [file.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, file.currentRevisionId, input.acceptedAt);
  return ok({ revisionId, itemId: file.id });
}

export async function executeRemovePlacement(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly placementId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<FileExecution>> {
  const placement = await getPlacement(tx, input.placementId);
  if (placement === null) {
    return err("placement.not-found", "Placement does not exist");
  }
  const item = await getItem(tx, placement.itemId);
  const active = await getActivePlacements(tx, placement.itemId);
  const view = {
    getItem: (id: Uuid) => (id === item?.id ? item : null),
    getActivePlacements: (itemId: Uuid) => (itemId === placement.itemId ? active : []),
    getActiveChildren: () => [] as const,
  };
  const plan = planRemoveFilePlacement(view, placement, () => input.acceptedAt);
  if (!plan.ok) {
    return plan as DomainResult<FileExecution>;
  }

  const file = item as NonNullable<typeof item>;
  const revisionId = generateUuidV7();
  await tx
    .update(placements)
    .set({ removedAt: input.acceptedAt, removedRevisionId: revisionId })
    .where(and(eq(placements.id, placement.id), isNull(placements.removedAt)));
  // The usage goes with the placement. An index that keeps it would over-report
  // — and over-reporting is not the harmless direction here either: it blocks a
  // deletion the owner is entitled to make and sends them looking for a page
  // that no longer references the file.
  if (placement.parentItemId !== null) {
    await removePlacementUsage(tx, {
      fileItemId: placement.itemId as Uuid,
      parentItemId: placement.parentItemId as Uuid,
      kind: placement.kind as "attachment" | "hierarchy",
    });
  }

  if (plan.value.type === "file-trashed") {
    await tx
      .update(items)
      .set({
        lifecycle: "trashed",
        trashedAt: new Date(plan.value.trashedAt),
        purgeAfter: new Date(plan.value.purgeAfter),
        currentRevisionId: revisionId,
        updatedAt: input.acceptedAt,
      })
      .where(eq(items.id, file.id));
    await tx.insert(lifecycleEvents).values({
      id: generateUuidV7(),
      itemId: file.id,
      mutationId: input.mutationId,
      eventType: "trashed",
      occurredAt: input.acceptedAt,
      placementSnapshot: [
        {
          placementId: placement.id,
          itemId: placement.itemId,
          kind: plan.value.restorablePlacement.kind,
          parentItemId: plan.value.restorablePlacement.parentItemId,
          positionKey: plan.value.restorablePlacement.positionKey,
        },
      ],
    });
  } else {
    await tx
      .update(items)
      .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
      .where(eq(items.id, file.id));
  }
  const snapshot = await buildItemSnapshot(tx, file.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: file.id,
    mutationId: input.mutationId,
    parentRevisionIds: [file.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, file.currentRevisionId, input.acceptedAt);
  return ok({ revisionId, itemId: file.id });
}

export async function executeReplaceFileContent(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly itemId: Uuid;
    readonly baseRevisionId: Uuid;
    readonly content: StoredContent;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<FileExecution>> {
  const item = await getItem(tx, input.itemId);
  if (item === null) {
    return err("item.not-found", "File does not exist");
  }
  if (item.kind !== "file") {
    return err("item.wrong-kind", "Only files carry replaceable binary content");
  }
  if (item.lifecycle !== "active") {
    return err("item.not-active", "Only active files can be updated");
  }
  if (input.baseRevisionId !== item.currentRevisionId) {
    return err("revision.stale-base", "File changed since this update was prepared", {
      competingRevisionIds: [item.currentRevisionId],
    });
  }

  const revisionId = generateUuidV7();
  const contentId = await registerContent(tx, input.content);
  // Copy-on-write: only this logical file's pointer moves. Every placement
  // resolves through logical_files, so all placements observe the update.
  await tx
    .update(logicalFiles)
    .set({ contentId, byteLength: input.content.byteLength })
    .where(eq(logicalFiles.itemId, input.itemId));
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
    .where(eq(items.id, input.itemId));
  const snapshot = await buildItemSnapshot(tx, input.itemId);
  await insertRevision(tx, {
    id: revisionId,
    itemId: input.itemId,
    mutationId: input.mutationId,
    parentRevisionIds: [item.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, item.currentRevisionId, input.acceptedAt);
  return ok({ revisionId, itemId: input.itemId });
}

export async function findVerifiedContentByDigest(
  tx: Transaction,
  sha256: Uint8Array,
  byteLength: number,
): Promise<{ contentId: Uuid; storageKey: string } | null> {
  const rows = await tx
    .select()
    .from(fileContents)
    .where(and(eq(fileContents.sha256, sha256), eq(fileContents.byteLength, byteLength)))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.verifiedAt === null) {
    return null;
  }
  return { contentId: row.id as Uuid, storageKey: row.storageKey };
}
