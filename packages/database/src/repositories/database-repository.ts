import type { DatabaseDefinition, EntryValues, RelationTargets, Uuid } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import { databaseEntries, databases, items, relationships, revisions } from "../schema/index.ts";

type Executor = Database | Transaction;

export interface DatabaseRecord {
  readonly databaseId: Uuid;
  readonly workspaceId: Uuid;
  readonly definitionVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseEntryRecord {
  readonly entryId: Uuid;
  readonly databaseId: Uuid;
  readonly workspaceId: Uuid;
  readonly valueVersion: number;
  readonly addedRevisionId: Uuid;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function databaseModel(row: typeof databases.$inferSelect): DatabaseRecord {
  return {
    databaseId: row.itemId as Uuid,
    workspaceId: row.workspaceId as Uuid,
    definitionVersion: row.definitionVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function entryModel(row: typeof databaseEntries.$inferSelect): DatabaseEntryRecord {
  return {
    entryId: row.entryItemId as Uuid,
    databaseId: row.databaseId as Uuid,
    workspaceId: row.workspaceId as Uuid,
    valueVersion: row.valueVersion,
    addedRevisionId: row.addedRevisionId as Uuid,
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
    .limit(1);
  return row === undefined ? null : databaseModel(row);
}

export async function readDatabaseEntryRecord(
  executor: Executor,
  entryId: Uuid,
): Promise<DatabaseEntryRecord | null> {
  const [row] = await executor
    .select()
    .from(databaseEntries)
    .where(eq(databaseEntries.entryItemId, entryId))
    .limit(1);
  return row === undefined ? null : entryModel(row);
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
    readonly workspaceId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<void> {
  await tx.insert(databases).values({
    itemId: input.databaseId,
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
    readonly expectedVersion: number;
    readonly acceptedAt: Date;
  },
): Promise<boolean> {
  const rows = await tx
    .update(databases)
    .set({ definitionVersion: input.expectedVersion + 1, updatedAt: input.acceptedAt })
    .where(
      and(
        eq(databases.itemId, input.databaseId),
        eq(databases.definitionVersion, input.expectedVersion),
      ),
    )
    .returning({ itemId: databases.itemId });
  return rows.length === 1;
}

export async function insertDatabaseEntryRecord(
  tx: Transaction,
  input: {
    readonly entryId: Uuid;
    readonly databaseId: Uuid;
    readonly workspaceId: Uuid;
    readonly addedRevisionId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<void> {
  await tx.insert(databaseEntries).values({
    entryItemId: input.entryId,
    databaseId: input.databaseId,
    workspaceId: input.workspaceId,
    valueVersion: 1,
    addedRevisionId: input.addedRevisionId,
    createdAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
  });
}

export async function advanceDatabaseEntryValueVersion(
  tx: Transaction,
  input: {
    readonly entryId: Uuid;
    readonly expectedVersion: number;
    readonly acceptedAt: Date;
  },
): Promise<boolean> {
  const rows = await tx
    .update(databaseEntries)
    .set({ valueVersion: input.expectedVersion + 1, updatedAt: input.acceptedAt })
    .where(
      and(
        eq(databaseEntries.entryItemId, input.entryId),
        eq(databaseEntries.valueVersion, input.expectedVersion),
      ),
    )
    .returning({ entryItemId: databaseEntries.entryItemId });
  return rows.length === 1;
}

async function currentSnapshot(
  executor: Executor,
  itemId: Uuid,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [row] = await executor
    .select({ snapshot: revisions.snapshot })
    .from(items)
    .innerJoin(revisions, eq(revisions.id, items.currentRevisionId))
    .where(eq(items.id, itemId))
    .limit(1);
  return row === undefined ? null : (row.snapshot as Readonly<Record<string, unknown>>);
}

export async function readCurrentDatabaseDefinition(
  executor: Executor,
  databaseId: Uuid,
): Promise<DatabaseDefinition | null> {
  const snapshot = await currentSnapshot(executor, databaseId);
  const definition = snapshot?.["databaseDefinition"];
  return typeof definition === "object" && definition !== null
    ? (definition as DatabaseDefinition)
    : null;
}

export async function readCurrentDatabaseEntryValues(
  executor: Executor,
  entryId: Uuid,
): Promise<EntryValues | null> {
  const snapshot = await currentSnapshot(executor, entryId);
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

export async function hasStructuredPageRole(executor: Executor, itemId: Uuid): Promise<boolean> {
  const database = await executor
    .select({ id: databases.itemId })
    .from(databases)
    .where(eq(databases.itemId, itemId))
    .limit(1);
  const entry = await executor
    .select({ id: databaseEntries.entryItemId })
    .from(databaseEntries)
    .where(eq(databaseEntries.entryItemId, itemId))
    .limit(1);
  return database.length > 0 || entry.length > 0;
}
