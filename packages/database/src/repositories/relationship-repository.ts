/**
 * Stable relationship persistence and diagnostics (T066, US3).
 *
 * Endpoints are stored by stable identity only; a relationship survives
 * renames, moves, trash, and restoration untouched. Removal is an explicit
 * lineage event. Listing exposes endpoint availability so unavailable
 * targets stay diagnosable instead of silently redirecting (FR-011/FR-014).
 */

import {
  type CreateRelationshipCommand,
  type DomainResult,
  type EndpointAvailability,
  endpointAvailability,
  err,
  extractWikiLinkOccurrences,
  generateUuidV7,
  normalizePageDocumentForEditor,
  ok,
  type PageDocument,
  type Uuid,
  validateCreateRelationship,
  validateWikiLinkTargets,
} from "@myownnotion/domain";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import { items, relationships } from "../schema/index.ts";
import { getItem } from "./hierarchy-repository.ts";
import { buildItemSnapshot, insertRevision, supersedeRevision } from "./revision-repository.ts";

export interface RelationshipExecution {
  readonly revisionId: Uuid;
  readonly relationshipId: Uuid;
  readonly sourceItemId: Uuid;
}

export interface DocumentWikiRelationshipPlan {
  readonly sourceItemId: Uuid;
  readonly occurrences: ReadonlyArray<{
    readonly occurrenceId: Uuid;
    readonly targetItemId: Uuid;
    readonly label: string;
  }>;
}

export async function planDocumentWikiRelationships(
  tx: Transaction,
  sourceItemId: Uuid,
  document: PageDocument,
): Promise<DomainResult<DocumentWikiRelationshipPlan>> {
  if (document.formatVersion === 1) {
    return ok({ sourceItemId, occurrences: [] });
  }
  const normalized = normalizePageDocumentForEditor(document);
  if (!normalized.ok) {
    return normalized as DomainResult<DocumentWikiRelationshipPlan>;
  }
  const occurrences = extractWikiLinkOccurrences(normalized.value);
  const targets = new Map<string, Awaited<ReturnType<typeof getItem>>>();
  for (const targetItemId of new Set(occurrences.map((occurrence) => occurrence.targetItemId))) {
    targets.set(targetItemId, await getItem(tx, targetItemId));
  }
  const targetsValid = validateWikiLinkTargets(
    normalized.value,
    sourceItemId,
    (id) => targets.get(id) ?? null,
  );
  if (!targetsValid.ok) {
    return targetsValid as DomainResult<DocumentWikiRelationshipPlan>;
  }
  if (occurrences.length > 0) {
    const existing = await tx
      .select()
      .from(relationships)
      .where(
        inArray(
          relationships.id,
          occurrences.map((occurrence) => occurrence.occurrenceId),
        ),
      );
    for (const row of existing) {
      const occurrence = occurrences.find((candidate) => candidate.occurrenceId === row.id);
      if (
        occurrence === undefined ||
        row.sourceItemId !== sourceItemId ||
        row.targetItemId !== occurrence.targetItemId ||
        row.relationType !== "link:references"
      ) {
        return err(
          "validation.invalid-identifier",
          "Wiki-link occurrence identity is already assigned",
        );
      }
    }
  }
  return ok({ sourceItemId, occurrences });
}

export async function applyDocumentWikiRelationshipPlan(
  tx: Transaction,
  input: {
    readonly workspaceId: Uuid;
    readonly revisionId: Uuid;
    readonly plan: DocumentWikiRelationshipPlan;
  },
): Promise<void> {
  const activeRows = await tx
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.sourceItemId, input.plan.sourceItemId),
        eq(relationships.relationType, "link:references"),
        isNull(relationships.removedRevisionId),
      ),
    );
  const proposedIds = new Set(input.plan.occurrences.map((occurrence) => occurrence.occurrenceId));
  const removedIds = activeRows
    .filter((row) => !proposedIds.has(row.id as Uuid))
    .map((row) => row.id as Uuid);
  if (removedIds.length > 0) {
    await tx
      .update(relationships)
      .set({ removedRevisionId: input.revisionId })
      .where(inArray(relationships.id, removedIds));
  }

  for (const occurrence of input.plan.occurrences) {
    const existing = await tx
      .select()
      .from(relationships)
      .where(eq(relationships.id, occurrence.occurrenceId))
      .limit(1);
    const row = existing[0];
    if (row === undefined) {
      await tx.insert(relationships).values({
        id: occurrence.occurrenceId,
        workspaceId: input.workspaceId,
        sourceItemId: input.plan.sourceItemId,
        targetItemId: occurrence.targetItemId,
        relationType: "link:references",
        metadata: { label: occurrence.label },
        createdRevisionId: input.revisionId,
      });
    } else {
      await tx
        .update(relationships)
        .set({
          metadata: { label: occurrence.label },
          createdRevisionId:
            row.removedRevisionId === null ? row.createdRevisionId : input.revisionId,
          removedRevisionId: null,
        })
        .where(eq(relationships.id, occurrence.occurrenceId));
    }
  }
}

export async function executeCreateRelationship(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly workspaceId: Uuid;
    readonly command: CreateRelationshipCommand;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<RelationshipExecution>> {
  const existing = await tx
    .select({ id: relationships.id })
    .from(relationships)
    .where(eq(relationships.id, input.command.id))
    .limit(1);
  if (existing.length > 0) {
    return err("mutation.duplicate", "A relationship with this identity already exists");
  }
  const source = await getItem(tx, input.command.sourceItemId);
  const target = await getItem(tx, input.command.targetItemId);
  const plan = validateCreateRelationship(
    (id) => (id === source?.id ? source : id === target?.id ? target : null),
    input.command,
  );
  if (!plan.ok) {
    return plan as DomainResult<RelationshipExecution>;
  }

  // The relationship's lineage is carried by a source-item revision: the
  // source's observable state (its outgoing relations) changed.
  const sourceItem = source as NonNullable<typeof source>;
  const revisionId = generateUuidV7();
  await tx.insert(relationships).values({
    id: plan.value.id,
    workspaceId: input.workspaceId,
    sourceItemId: plan.value.sourceItemId,
    targetItemId: plan.value.targetItemId,
    relationType: plan.value.relationType,
    metadata: plan.value.metadata,
    createdRevisionId: revisionId,
  });
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
    .where(eq(items.id, sourceItem.id));
  const snapshot = await buildItemSnapshot(tx, sourceItem.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: sourceItem.id,
    mutationId: input.mutationId,
    parentRevisionIds: [sourceItem.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, sourceItem.currentRevisionId, input.acceptedAt);
  return ok({ revisionId, relationshipId: plan.value.id, sourceItemId: sourceItem.id });
}

export async function executeRemoveRelationship(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly relationshipId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<RelationshipExecution>> {
  const rows = await tx
    .select()
    .from(relationships)
    .where(eq(relationships.id, input.relationshipId))
    .limit(1);
  const relationship = rows[0];
  if (relationship === undefined || relationship.removedRevisionId !== null) {
    return err("relationship.not-found", "Relationship does not exist");
  }
  const source = await getItem(tx, relationship.sourceItemId as Uuid);
  if (source === null) {
    return err("relationship.endpoint-unavailable", "Source item is unavailable");
  }
  const revisionId = generateUuidV7();
  await tx
    .update(relationships)
    .set({ removedRevisionId: revisionId })
    .where(eq(relationships.id, input.relationshipId));
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: input.acceptedAt })
    .where(eq(items.id, source.id));
  const snapshot = await buildItemSnapshot(tx, source.id);
  await insertRevision(tx, {
    id: revisionId,
    itemId: source.id,
    mutationId: input.mutationId,
    parentRevisionIds: [source.currentRevisionId],
    snapshot,
    acceptedAt: input.acceptedAt,
  });
  await supersedeRevision(tx, source.currentRevisionId, input.acceptedAt);
  return ok({
    revisionId,
    relationshipId: input.relationshipId,
    sourceItemId: source.id,
  });
}

export interface RelationshipListing {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata: Record<string, unknown>;
  readonly createdRevisionId: Uuid;
  readonly removedRevisionId: Uuid | null;
  readonly sourceAvailability: EndpointAvailability;
  readonly targetAvailability: EndpointAvailability;
}

export async function listRelationships(
  tx: Transaction,
  workspaceId: Uuid,
  itemId?: Uuid,
): Promise<RelationshipListing[]> {
  const baseCondition = and(
    eq(relationships.workspaceId, workspaceId),
    isNull(relationships.removedRevisionId),
  );
  const condition =
    itemId === undefined
      ? baseCondition
      : and(
          baseCondition,
          or(eq(relationships.sourceItemId, itemId), eq(relationships.targetItemId, itemId)),
        );
  const rows = await tx.select().from(relationships).where(condition);

  const endpointIds = new Set<string>();
  for (const row of rows) {
    endpointIds.add(row.sourceItemId);
    endpointIds.add(row.targetItemId);
  }
  const availability = new Map<string, EndpointAvailability>();
  for (const id of endpointIds) {
    const itemRows = await tx.select().from(items).where(eq(items.id, id)).limit(1);
    const item = itemRows[0];
    availability.set(
      id,
      endpointAvailability(
        item === undefined
          ? null
          : {
              id: item.id as Uuid,
              workspaceId: item.workspaceId as Uuid,
              kind: item.kind as "page" | "folder" | "file",
              name: item.name,
              lifecycle: item.lifecycle as "active" | "trashed" | "purged",
              trashedAt: null,
              purgeAfter: null,
              currentRevisionId: item.currentRevisionId as Uuid,
            },
      ),
    );
  }

  return rows.map((row) => ({
    id: row.id as Uuid,
    sourceItemId: row.sourceItemId as Uuid,
    targetItemId: row.targetItemId as Uuid,
    relationType: row.relationType,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdRevisionId: row.createdRevisionId as Uuid,
    removedRevisionId: (row.removedRevisionId as Uuid | null) ?? null,
    sourceAvailability: availability.get(row.sourceItemId) ?? "unavailable",
    targetAvailability: availability.get(row.targetItemId) ?? "unavailable",
  }));
}
