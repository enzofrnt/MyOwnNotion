import type {
  DatabaseDefinition,
  DatabasePresentationDefinition,
  DatabaseSourceDefinition,
  EntryValues,
  RelationTargets,
  Uuid,
} from "@myownnotion/domain";
import { generateUuidV7, ownedSourceIdFromItemId } from "@myownnotion/domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import {
  databaseEntries,
  databasePresentations,
  databases,
  items,
  placements,
  relationships,
  revisions,
} from "../schema/index.ts";

type Executor = Database | Transaction;

export interface DatabaseRecord {
  readonly databaseId: Uuid;
  readonly sourceId: Uuid;
  readonly workspaceId: Uuid;
  readonly definitionVersion: number;
  readonly definitionRevisionId: Uuid | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseEntryRecord {
  readonly entryId: Uuid;
  readonly databaseId: Uuid;
  readonly sourceId: Uuid;
  readonly workspaceId: Uuid;
  readonly valueVersion: number;
  readonly addedRevisionId: Uuid;
  readonly valueRevisionId: Uuid;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabasePresentationRecord {
  readonly containerItemId: Uuid;
  readonly workspaceId: Uuid;
  readonly presentationRevisionId: Uuid;
  readonly presentationVersion: number;
}

export async function readDatabasePresentationRecord(
  executor: Executor,
  containerItemId: Uuid,
): Promise<DatabasePresentationRecord | null> {
  const [row] = await executor
    .select()
    .from(databasePresentations)
    .where(eq(databasePresentations.itemId, containerItemId))
    .limit(1);
  return row === undefined
    ? null
    : {
        containerItemId: row.itemId as Uuid,
        workspaceId: row.workspaceId as Uuid,
        presentationRevisionId: row.presentationRevisionId as Uuid,
        presentationVersion: row.presentationVersion,
      };
}

export async function listDatabasePresentationRecords(
  executor: Executor,
  workspaceId: Uuid,
): Promise<DatabasePresentationRecord[]> {
  const rows = await executor
    .select()
    .from(databasePresentations)
    .where(eq(databasePresentations.workspaceId, workspaceId));
  return rows.map((row) => ({
    containerItemId: row.itemId as Uuid,
    workspaceId: row.workspaceId as Uuid,
    presentationRevisionId: row.presentationRevisionId as Uuid,
    presentationVersion: row.presentationVersion,
  }));
}

export async function advanceDatabasePresentationVersion(
  tx: Transaction,
  input: {
    readonly containerItemId: Uuid;
    readonly presentationRevisionId: Uuid;
    readonly expectedVersion: number;
    readonly acceptedAt: Date;
  },
): Promise<boolean> {
  const rows = await tx
    .update(databasePresentations)
    .set({
      presentationVersion: input.expectedVersion + 1,
      presentationRevisionId: input.presentationRevisionId,
      updatedAt: input.acceptedAt,
    })
    .where(
      and(
        eq(databasePresentations.itemId, input.containerItemId),
        eq(databasePresentations.presentationVersion, input.expectedVersion),
      ),
    )
    .returning({ itemId: databasePresentations.itemId });
  return rows.length === 1;
}

function databaseModel(row: typeof databases.$inferSelect): DatabaseRecord {
  return {
    databaseId: row.itemId as Uuid,
    sourceId: row.sourceId as Uuid,
    workspaceId: row.workspaceId as Uuid,
    definitionVersion: row.definitionVersion,
    definitionRevisionId: row.definitionRevisionId as Uuid | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function entryModel(row: typeof databaseEntries.$inferSelect): DatabaseEntryRecord {
  return {
    entryId: row.entryItemId as Uuid,
    databaseId: row.databaseId as Uuid,
    sourceId: row.sourceId as Uuid,
    workspaceId: row.workspaceId as Uuid,
    valueVersion: row.valueVersion,
    addedRevisionId: row.addedRevisionId as Uuid,
    valueRevisionId: row.valueRevisionId as Uuid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readDatabaseRecord(
  executor: Executor,
  databaseId: Uuid,
): Promise<DatabaseRecord | null> {
  const [row] = await executor
    .select()
    .from(databases)
    .where(eq(databases.itemId, databaseId))
    .orderBy(databases.createdAt)
    .limit(1);
  return row === undefined ? null : databaseModel(row);
}

export async function listDatabaseRecordsByOwner(
  executor: Executor,
  ownerItemId: Uuid,
): Promise<DatabaseRecord[]> {
  const rows = await executor
    .select()
    .from(databases)
    .where(eq(databases.itemId, ownerItemId))
    .orderBy(databases.createdAt);
  return rows.map(databaseModel);
}

export async function readDatabaseRecordBySourceId(
  executor: Executor,
  sourceId: Uuid,
): Promise<DatabaseRecord | null> {
  const [row] = await executor
    .select()
    .from(databases)
    .where(eq(databases.sourceId, sourceId))
    .limit(1);
  return row === undefined ? null : databaseModel(row);
}

export async function listDatabaseRecords(
  executor: Executor,
  workspaceId: Uuid,
): Promise<DatabaseRecord[]> {
  const rows = await executor
    .select()
    .from(databases)
    .where(eq(databases.workspaceId, workspaceId));
  return rows.map(databaseModel);
}

export async function readDatabaseEntryRecord(
  executor: Executor,
  entryId: Uuid,
  databaseId?: Uuid,
): Promise<DatabaseEntryRecord | null> {
  const [row] = await executor
    .select()
    .from(databaseEntries)
    .where(
      and(
        eq(databaseEntries.entryItemId, entryId),
        databaseId === undefined ? undefined : eq(databaseEntries.databaseId, databaseId),
      ),
    )
    .limit(1);
  return row === undefined ? null : entryModel(row);
}

/** A source contains only active, direct page/folder children of its owner. */
export async function isActiveDatabaseEntry(
  executor: Executor,
  databaseId: Uuid,
  entryId: Uuid,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: items.id })
    .from(placements)
    .innerJoin(items, eq(items.id, placements.itemId))
    .where(
      and(
        eq(placements.itemId, entryId),
        eq(placements.parentItemId, databaseId),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedAt),
        eq(items.lifecycle, "active"),
        inArray(items.kind, ["page", "folder"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function activeDatabaseOwnerForEntry(
  executor: Executor,
  entryId: Uuid,
): Promise<Uuid | null> {
  const [row] = await executor
    .select({ databaseId: databases.itemId })
    .from(placements)
    .innerJoin(databases, eq(databases.itemId, placements.parentItemId))
    .innerJoin(items, eq(items.id, placements.itemId))
    .where(
      and(
        eq(placements.itemId, entryId),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedAt),
        eq(items.lifecycle, "active"),
      ),
    )
    .limit(1);
  return (row?.databaseId as Uuid | undefined) ?? null;
}

export async function nextDatabaseEntryValueVersion(
  executor: Executor,
  entryId: Uuid,
): Promise<number> {
  const [maximum] = await executor
    .select({ value: sql<number>`coalesce(max(${databaseEntries.valueVersion}), 0)` })
    .from(databaseEntries)
    .where(eq(databaseEntries.entryItemId, entryId));
  return (maximum?.value ?? 0) + 1;
}

export async function listDatabaseEntryRecords(
  executor: Executor,
  databaseId: Uuid,
): Promise<DatabaseEntryRecord[]> {
  const rows = await executor
    .select()
    .from(databaseEntries)
    .where(eq(databaseEntries.databaseId, databaseId));
  return rows.map(entryModel);
}

export async function insertDatabaseRecord(
  tx: Transaction,
  input: {
    readonly databaseId: Uuid;
    readonly sourceId?: Uuid;
    readonly definitionRevisionId: Uuid;
    readonly workspaceId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<void> {
  await tx.insert(databases).values({
    itemId: input.databaseId,
    sourceId: input.sourceId ?? ownedSourceIdFromItemId(input.databaseId),
    definitionRevisionId: input.definitionRevisionId,
    workspaceId: input.workspaceId,
    definitionVersion: 1,
    createdAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  });
}

export async function advanceDatabaseDefinitionVersion(
  tx: Transaction,
  input: {
    readonly databaseId: Uuid;
    readonly sourceId: Uuid;
    readonly definitionRevisionId: Uuid;
    readonly expectedVersion: number;
    readonly acceptedAt: Date;
  },
): Promise<boolean> {
  const rows = await tx
    .update(databases)
    .set({
      definitionVersion: input.expectedVersion + 1,
      definitionRevisionId: input.definitionRevisionId,
      updatedAt: input.acceptedAt,
    })
    .where(
      and(
        eq(databases.sourceId, input.sourceId),
        eq(databases.definitionVersion, input.expectedVersion),
      ),
    )
    .returning({ sourceId: databases.sourceId });
  return rows.length === 1;
}

export async function insertDatabaseEntryRecord(
  tx: Transaction,
  input: {
    readonly entryId: Uuid;
    readonly databaseId: Uuid;
    readonly sourceId: Uuid;
    readonly workspaceId: Uuid;
    readonly addedRevisionId: Uuid;
    readonly valueRevisionId?: Uuid;
    readonly valueVersion?: number;
    readonly acceptedAt: Date;
  },
): Promise<void> {
  await tx.insert(databaseEntries).values({
    entryItemId: input.entryId,
    databaseId: input.databaseId,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    valueVersion: input.valueVersion ?? 1,
    addedRevisionId: input.addedRevisionId,
    valueRevisionId: input.valueRevisionId ?? input.addedRevisionId,
    createdAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  });
}

export async function advanceDatabaseEntryValueVersion(
  tx: Transaction,
  input: {
    readonly entryId: Uuid;
    readonly databaseId: Uuid;
    readonly valueRevisionId: Uuid;
    readonly expectedVersion: number;
    readonly acceptedAt: Date;
  },
): Promise<number | null> {
  const nextVersion = await nextDatabaseEntryValueVersion(tx, input.entryId);
  const rows = await tx
    .update(databaseEntries)
    .set({
      valueVersion: nextVersion,
      valueRevisionId: input.valueRevisionId,
      updatedAt: input.acceptedAt,
    })
    .where(
      and(
        eq(databaseEntries.entryItemId, input.entryId),
        eq(databaseEntries.databaseId, input.databaseId),
        eq(databaseEntries.valueVersion, input.expectedVersion),
      ),
    )
    .returning({ entryItemId: databaseEntries.entryItemId });
  return rows.length === 1 ? nextVersion : null;
}

async function currentSnapshot(
  executor: Executor,
  itemId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [row] = await executor
    .select({ id: revisions.id, snapshot: revisions.snapshot })
    .from(items)
    .innerJoin(revisions, eq(revisions.id, items.currentRevisionId))
    .where(eq(items.id, itemId))
    .limit(1);
  if (row === undefined) return null;
  return (
    (row.snapshot as Readonly<Record<string, unknown>> | null) ??
    (await resolve?.(row.id as Uuid)) ??
    null
  );
}

async function revisionSnapshot(
  executor: Executor,
  revisionId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [row] = await executor
    .select({ snapshot: revisions.snapshot })
    .from(revisions)
    .where(eq(revisions.id, revisionId))
    .limit(1);
  return (
    (row?.snapshot as Readonly<Record<string, unknown>> | null) ??
    (await resolve?.(revisionId)) ??
    null
  );
}

export async function readCurrentDatabaseSource(
  executor: Executor,
  ownerItemId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
): Promise<DatabaseSourceDefinition | null> {
  const record = await readDatabaseRecord(executor, ownerItemId);
  if (record?.definitionRevisionId === null || record === null) return null;
  const snapshot = await revisionSnapshot(executor, record.definitionRevisionId, resolve);
  const source = snapshot?.["databaseSource"];
  return typeof source === "object" && source !== null
    ? (source as DatabaseSourceDefinition)
    : null;
}

export async function readCurrentDatabasePresentation(
  executor: Executor,
  containerItemId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
): Promise<DatabasePresentationDefinition | null> {
  const record = await readDatabasePresentationRecord(executor, containerItemId);
  if (record === null) return null;
  const snapshot = await revisionSnapshot(executor, record.presentationRevisionId, resolve);
  const presentation = snapshot?.["databasePresentation"];
  return typeof presentation === "object" && presentation !== null
    ? (presentation as DatabasePresentationDefinition)
    : null;
}

export async function readCurrentDatabaseDefinition(
  executor: Executor,
  databaseId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
): Promise<DatabaseDefinition | null> {
  const record = await readDatabaseRecord(executor, databaseId);
  let snapshot: Readonly<Record<string, unknown>> | null;
  if (record?.definitionRevisionId) {
    snapshot = await revisionSnapshot(executor, record.definitionRevisionId, resolve);
  } else {
    snapshot = await currentSnapshot(executor, databaseId, resolve);
  }
  const definition = snapshot?.["databaseDefinition"];
  return typeof definition === "object" && definition !== null
    ? (definition as DatabaseDefinition)
    : null;
}

export async function readCurrentDatabaseEntryValues(
  executor: Executor,
  entryId: Uuid,
  resolve?: (revisionId: Uuid) => Promise<Record<string, unknown> | null>,
  databaseId?: Uuid,
): Promise<EntryValues | null> {
  const record = await readDatabaseEntryRecord(executor, entryId, databaseId);
  if (record === null) return null;
  const snapshot = await revisionSnapshot(executor, record.valueRevisionId, resolve);
  const values = snapshot?.["databaseEntryValues"];
  return typeof values === "object" && values !== null ? (values as EntryValues) : null;
}

export async function readDatabaseRelationTargets(
  executor: Executor,
  input: { readonly databaseId: Uuid; readonly entryId: Uuid },
): Promise<RelationTargets> {
  const rows = await executor
    .select({ targetItemId: relationships.targetItemId, metadata: relationships.metadata })
    .from(relationships)
    .where(
      and(
        eq(relationships.sourceItemId, input.entryId),
        eq(relationships.relationType, "database:property"),
        isNull(relationships.removedRevisionId),
      ),
    );
  const targets = new Map<Uuid, Uuid[]>();
  for (const row of rows) {
    const metadata = row.metadata as Record<string, unknown>;
    if (metadata["databaseId"] !== input.databaseId || typeof metadata["propertyId"] !== "string") {
      continue;
    }
    const propertyId = metadata["propertyId"] as Uuid;
    const propertyTargets = targets.get(propertyId) ?? [];
    propertyTargets.push(row.targetItemId as Uuid);
    targets.set(propertyId, propertyTargets);
  }
  return Object.fromEntries(
    [...targets].map(([propertyId, propertyTargets]) => [propertyId, propertyTargets.sort()]),
  ) as RelationTargets;
}

export interface DatabasePropertyRelationshipRecord {
  readonly id: Uuid;
  readonly targetItemId: Uuid;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export async function listDatabasePropertyRelationships(
  executor: Executor,
  entryId: Uuid,
): Promise<DatabasePropertyRelationshipRecord[]> {
  const rows = await executor
    .select({
      id: relationships.id,
      targetItemId: relationships.targetItemId,
      metadata: relationships.metadata,
    })
    .from(relationships)
    .where(
      and(
        eq(relationships.sourceItemId, entryId),
        eq(relationships.relationType, "database:property"),
        isNull(relationships.removedRevisionId),
      ),
    );
  return rows.map((row) => ({
    id: row.id as Uuid,
    targetItemId: row.targetItemId as Uuid,
    metadata: row.metadata as Readonly<Record<string, unknown>>,
  }));
}

export interface ReconciledDatabaseRelationships {
  readonly createdRelationshipIds: readonly Uuid[];
  readonly removedRelationshipIds: readonly Uuid[];
}

export async function replaceDatabaseRelationships(
  tx: Transaction,
  input: {
    readonly workspaceId: Uuid;
    readonly databaseId: Uuid;
    readonly entryId: Uuid;
    readonly revisionId: Uuid;
    readonly relationTargets: RelationTargets;
  },
): Promise<ReconciledDatabaseRelationships> {
  const existing = await tx
    .select()
    .from(relationships)
    .where(
      and(
        eq(relationships.sourceItemId, input.entryId),
        eq(relationships.relationType, "database:property"),
        isNull(relationships.removedRevisionId),
      ),
    );
  const desired = new Set(
    Object.entries(input.relationTargets).flatMap(([propertyId, targetIds]) =>
      targetIds.map((targetId) => `${propertyId}/${targetId}`),
    ),
  );
  const removedRelationshipIds: Uuid[] = [];
  for (const relationship of existing) {
    const metadata = relationship.metadata as Record<string, unknown>;
    const key = `${String(metadata["propertyId"])}/${relationship.targetItemId}`;
    if (metadata["databaseId"] === input.databaseId && desired.delete(key)) continue;
    removedRelationshipIds.push(relationship.id as Uuid);
  }
  if (removedRelationshipIds.length > 0) {
    await tx
      .update(relationships)
      .set({ removedRevisionId: input.revisionId })
      .where(inArray(relationships.id, removedRelationshipIds));
  }

  const createdRelationshipIds: Uuid[] = [];
  for (const key of [...desired].sort()) {
    const separator = key.indexOf("/");
    const propertyId = key.slice(0, separator) as Uuid;
    const targetItemId = key.slice(separator + 1) as Uuid;
    const id = generateUuidV7();
    await tx.insert(relationships).values({
      id,
      workspaceId: input.workspaceId,
      sourceItemId: input.entryId,
      targetItemId,
      relationType: "database:property",
      metadata: { databaseId: input.databaseId, propertyId },
      createdRevisionId: input.revisionId,
    });
    createdRelationshipIds.push(id);
  }
  return { createdRelationshipIds, removedRelationshipIds };
}

/** Structural projection input; editorial page bodies and placements are not needed. */
export interface DatabaseProjectionEntryRecord {
  readonly entryId: Uuid;
  readonly revisionId: Uuid;
  readonly storedName: string;
  readonly valueVersion: number;
  readonly storedValues: EntryValues | null;
}

export async function listDatabaseProjectionEntries(
  executor: Executor,
  databaseId: Uuid,
  entryIds?: readonly Uuid[],
): Promise<DatabaseProjectionEntryRecord[]> {
  if (entryIds?.length === 0) return [];
  const rows = await executor
    .select({
      entryId: items.id,
      revisionId: items.currentRevisionId,
      storedName: items.name,
      valueVersion: databaseEntries.valueVersion,
      storedValues: sql<EntryValues | null>`${revisions.snapshot}->'databaseEntryValues'`,
    })
    .from(placements)
    .innerJoin(items, eq(items.id, placements.itemId))
    .leftJoin(
      databaseEntries,
      and(eq(databaseEntries.entryItemId, items.id), eq(databaseEntries.databaseId, databaseId)),
    )
    .leftJoin(revisions, eq(revisions.id, databaseEntries.valueRevisionId))
    .where(
      and(
        eq(placements.parentItemId, databaseId),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedAt),
        eq(items.lifecycle, "active"),
        inArray(items.kind, ["page", "folder"]),
        entryIds === undefined ? undefined : inArray(items.id, [...entryIds]),
      ),
    );
  return rows.map((row) => ({
    ...row,
    entryId: row.entryId as Uuid,
    revisionId: row.revisionId as Uuid,
    valueVersion: row.valueVersion ?? 0,
  }));
}

export async function listDatabaseProjectionRelationships(
  executor: Executor,
  databaseId: Uuid,
  entryIds?: readonly Uuid[],
): Promise<(DatabasePropertyRelationshipRecord & { readonly sourceItemId: Uuid })[]> {
  if (entryIds?.length === 0) return [];
  const rows = await executor
    .select({
      id: relationships.id,
      sourceItemId: relationships.sourceItemId,
      targetItemId: relationships.targetItemId,
      metadata: relationships.metadata,
    })
    .from(relationships)
    .innerJoin(placements, eq(placements.itemId, relationships.sourceItemId))
    .innerJoin(items, eq(items.id, placements.itemId))
    .where(
      and(
        eq(placements.parentItemId, databaseId),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedAt),
        eq(items.lifecycle, "active"),
        eq(relationships.relationType, "database:property"),
        isNull(relationships.removedRevisionId),
        entryIds === undefined ? undefined : inArray(items.id, [...entryIds]),
      ),
    );
  return rows.map((row) => ({
    ...row,
    id: row.id as Uuid,
    sourceItemId: row.sourceItemId as Uuid,
    targetItemId: row.targetItemId as Uuid,
    metadata: row.metadata as Readonly<Record<string, unknown>>,
  }));
}

export async function databaseIdsForEntries(
  executor: Executor,
  entryIds: readonly Uuid[],
): Promise<Uuid[]> {
  if (entryIds.length === 0) return [];
  const rows = await executor
    .selectDistinct({ databaseId: databases.itemId })
    .from(placements)
    .innerJoin(databases, eq(databases.itemId, placements.parentItemId))
    .where(
      and(
        inArray(placements.itemId, [...entryIds]),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedAt),
      ),
    );
  return rows.map((row) => row.databaseId as Uuid);
}
