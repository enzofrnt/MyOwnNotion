/**
 * Optimistic projection application for offline commands (T040, US6).
 *
 * Runs inside the caller's Dexie transaction. Enforces the same domain
 * rules as the server (containment, cycles, causal bases) over the local
 * projection, creates optimistic local revision headers, and returns their
 * identities. Throws LocalValidationError to abort the transaction without
 * partial writes.
 */
import {
  generateUuidV7,
  wouldCreateCycle,
  type CanonicalItem,
  type HierarchyView,
  type MutationCommand,
  type Placement,
  type Uuid,
  TRASH_RETENTION_MS,
} from "@myownnotion/domain";
import { parentKeyOf, type LocalDatabase } from "../local-store/schema.ts";
import { LocalValidationError } from "./apply-local-mutation.ts";

async function loadView(db: LocalDatabase): Promise<HierarchyView> {
  const items = await db.items.toArray();
  const placements = await db.placements.toArray();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const placementsByItem = new Map<string, typeof placements>();
  const childrenByParent = new Map<string, typeof placements>();
  for (const placement of placements) {
    const list = placementsByItem.get(placement.itemId) ?? [];
    list.push(placement);
    placementsByItem.set(placement.itemId, list);
    if (placement.kind === "hierarchy") {
      const children = childrenByParent.get(placement.parentKey) ?? [];
      children.push(placement);
      childrenByParent.set(placement.parentKey, children);
    }
  }
  const toDomainPlacement = (row: (typeof placements)[number]): Placement => ({
    id: row.id,
    workspaceId: row.id,
    itemId: row.itemId,
    itemKind: itemsById.get(row.itemId)?.kind ?? "page",
    kind: row.kind,
    parentItemId: row.parentItemId,
    positionKey: row.positionKey,
    removedAt: null,
  });
  return {
    getItem: (id: Uuid): CanonicalItem | null => {
      const row = itemsById.get(id);
      return row === undefined
        ? null
        : {
            id: row.id,
            workspaceId: row.id,
            kind: row.kind,
            name: row.name,
            lifecycle: row.lifecycle,
            trashedAt: row.trashedAt,
            purgeAfter: row.purgeAfter,
            currentRevisionId: row.currentRevisionId,
          };
    },
    getActivePlacements: (itemId: Uuid) =>
      (placementsByItem.get(itemId) ?? []).map(toDomainPlacement),
    getActiveChildren: (parentItemId: Uuid | null) =>
      (childrenByParent.get(parentKeyOf(parentItemId)) ?? []).map(toDomainPlacement),
  };
}

async function writeLocalRevision(
  db: LocalDatabase,
  itemId: Uuid,
  parentRevisionIds: Uuid[],
  now: () => Date,
): Promise<Uuid> {
  const id = generateUuidV7();
  await db.revisionHeaders.put({
    id,
    itemId,
    mutationId: id,
    parentRevisionIds,
    acceptedAt: now().toISOString(),
    local: 1,
  });
  return id;
}

export async function applyCommandToProjection(
  db: LocalDatabase,
  command: MutationCommand,
  now: () => Date,
): Promise<Uuid[]> {
  switch (command.type) {
    case "item.create": {
      const view = await loadView(db);
      if (command.placement.parentItemId !== null) {
        const parent = view.getItem(command.placement.parentItemId);
        if (parent === null || parent.lifecycle !== "active" || parent.kind === "file") {
          throw new LocalValidationError("item.not-found", "Parent is not an active container");
        }
      }
      const revisionId = await writeLocalRevision(db, command.id, [], now);
      await db.items.add({
        id: command.id,
        kind: command.kind,
        name: command.name.trim(),
        lifecycle: "active",
        currentRevisionId: revisionId,
        trashedAt: null,
        purgeAfter: null,
        pageDocument:
          command.kind === "page"
            ? (command.pageDocument ?? {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: {},
              })
            : null,
        file: null,
      });
      await db.placements.add({
        // Shared client-generated identity: the server persists the same
        // placement id, so queued follow-up moves keep resolving after sync.
        id: command.placement.id ?? generateUuidV7(),
        itemId: command.id,
        kind: "hierarchy",
        parentItemId: command.placement.parentItemId,
        parentKey: parentKeyOf(command.placement.parentItemId),
        positionKey: command.placement.positionKey,
      });
      return [revisionId];
    }

    case "item.rename": {
      const item = await db.items.get(command.itemId);
      if (item === undefined) {
        throw new LocalValidationError("item.not-found", "Item is not available locally");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.itemId,
        [item.currentRevisionId],
        now,
      );
      await db.items.update(command.itemId, {
        name: command.name.trim(),
        currentRevisionId: revisionId,
      });
      return [revisionId];
    }

    case "page.document.replace": {
      const item = await db.items.get(command.itemId);
      if (item === undefined || item.kind !== "page") {
        throw new LocalValidationError("item.not-found", "Page is not available locally");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.itemId,
        [item.currentRevisionId],
        now,
      );
      await db.items.update(command.itemId, {
        pageDocument: {
          format: command.document.format,
          formatVersion: command.document.formatVersion,
          body: command.document.body as Record<string, unknown>,
        },
        currentRevisionId: revisionId,
      });
      return [revisionId];
    }

    case "placement.move": {
      const placement = await db.placements.get(command.placementId);
      if (placement === undefined) {
        throw new LocalValidationError("placement.not-found", "Placement is not available locally");
      }
      const view = await loadView(db);
      if (
        command.parentItemId !== null &&
        wouldCreateCycle(view, placement.itemId, command.parentItemId)
      ) {
        throw new LocalValidationError(
          "containment.cycle-rejected",
          "Moving an item beneath its own descendant is rejected",
        );
      }
      const item = await db.items.get(placement.itemId);
      if (item === undefined) {
        throw new LocalValidationError("item.not-found", "Item is not available locally");
      }
      const revisionId = await writeLocalRevision(
        db,
        placement.itemId,
        [item.currentRevisionId],
        now,
      );
      await db.placements.update(command.placementId, {
        parentItemId: command.parentItemId,
        parentKey: parentKeyOf(command.parentItemId),
        positionKey: command.positionKey,
      });
      await db.items.update(placement.itemId, { currentRevisionId: revisionId });
      return [revisionId];
    }

    case "item.trash": {
      const view = await loadView(db);
      const root = view.getItem(command.itemId);
      if (root === null || root.lifecycle !== "active") {
        throw new LocalValidationError("item.not-found", "Item is not available locally");
      }
      const queue: Uuid[] = [command.itemId];
      const branch: Uuid[] = [];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift() as Uuid;
        if (seen.has(current)) {
          continue;
        }
        seen.add(current);
        branch.push(current);
        for (const child of view.getActiveChildren(current)) {
          queue.push(child.itemId);
        }
      }
      const trashedAt = now().toISOString();
      const purgeAfter = new Date(now().getTime() + TRASH_RETENTION_MS).toISOString();
      const revisionIds: Uuid[] = [];
      for (const itemId of branch) {
        const item = await db.items.get(itemId);
        if (item === undefined) {
          continue;
        }
        const revisionId = await writeLocalRevision(db, itemId, [item.currentRevisionId], now);
        await db.items.update(itemId, {
          lifecycle: "trashed",
          trashedAt,
          purgeAfter,
          currentRevisionId: revisionId,
        });
        revisionIds.push(revisionId);
      }
      return revisionIds;
    }

    case "item.restore": {
      const item = await db.items.get(command.itemId);
      if (item === undefined || item.lifecycle !== "trashed") {
        throw new LocalValidationError("item.not-found", "Item is not recoverable locally");
      }
      // Restore the branch trashed at the same instant (same local action).
      const branch = await db.items
        .filter(
          (candidate) =>
            candidate.lifecycle === "trashed" && candidate.trashedAt === item.trashedAt,
        )
        .toArray();
      const revisionIds: Uuid[] = [];
      for (const member of branch) {
        const revisionId = await writeLocalRevision(db, member.id, [member.currentRevisionId], now);
        await db.items.update(member.id, {
          lifecycle: "active",
          trashedAt: null,
          purgeAfter: null,
          currentRevisionId: revisionId,
        });
        revisionIds.push(revisionId);
      }
      return revisionIds;
    }

    case "relationship.create": {
      const revisionId = await writeLocalRevision(db, command.sourceItemId, [], now);
      await db.relationships.add({
        id: command.id,
        sourceItemId: command.sourceItemId,
        targetItemId: command.targetItemId,
        relationType: command.relationType,
        metadata: (command.metadata as Record<string, unknown>) ?? {},
      });
      return [revisionId];
    }

    case "relationship.remove": {
      const relationship = await db.relationships.get(command.relationshipId);
      if (relationship === undefined) {
        throw new LocalValidationError("item.not-found", "Relationship is not available locally");
      }
      const revisionId = await writeLocalRevision(db, relationship.sourceItemId, [], now);
      await db.relationships.delete(command.relationshipId);
      return [revisionId];
    }

    default:
      throw new LocalValidationError(
        "validation.invalid-payload",
        `Command ${command.type} is not supported offline`,
      );
  }
}
