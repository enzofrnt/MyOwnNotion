import {
  createInitialDatabaseDefinition,
  type DatabaseDefinition,
  type DatabaseMutationCommand,
  type DatabasePresentationDefinition,
  type DatabaseSourceDefinition,
  type DomainResult,
  databaseEntryPlacementId,
  EMPTY_PAGE_DOCUMENT,
  type EntryValues,
  err,
  generateUuidV7,
  keyAfterAll,
  normalizePropertyValue,
  normalizeRelationTargets,
  ok,
  ownedSourceIdFromItemId,
  previewDefinitionImpact,
  type RelationTargets,
  type Uuid,
  validateCreateItem,
  validateDatabaseDefinition,
  validateDatabasePresentation,
  validateDatabaseSource,
} from "@myownnotion/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import {
  advanceDatabaseDefinitionVersion,
  advanceDatabaseEntryValueVersion,
  advanceDatabasePresentationVersion,
  insertDatabaseEntryRecord,
  insertDatabaseRecord,
  isActiveDatabaseEntry,
  listDatabaseEntryRecords,
  listDatabaseRecordsByOwner,
  nextDatabaseEntryValueVersion,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readCurrentDatabasePresentation,
  readDatabaseEntryRecord,
  readDatabasePresentationRecord,
  readDatabaseRecord,
  readDatabaseRecordBySourceId,
  replaceDatabaseRelationships,
} from "../repositories/database-repository.ts";
import { getItem } from "../repositories/hierarchy-repository.ts";
import {
  executeRestore,
  executeTrash,
  type LifecycleExecution,
} from "../repositories/lifecycle-repository.ts";
import {
  buildItemSnapshot,
  insertRevision,
  supersedeRevision,
} from "../repositories/revision-repository.ts";
import {
  databaseEntries,
  databasePresentations,
  databases,
  items,
  mutations,
  pageDocuments,
  placements,
  revisionParents,
  revisions,
} from "../schema/index.ts";

export interface DatabaseCommandContext {
  readonly workspaceId: Uuid;
  readonly mutationId: Uuid;
  readonly acceptedAt: Date;
  readonly resolveRevisionSnapshot?: (
    tx: Transaction,
    revisionId: Uuid,
  ) => Promise<Record<string, unknown> | null>;
}

function snapshotResolver(tx: Transaction, context: DatabaseCommandContext) {
  return (revisionId: Uuid) =>
    context.resolveRevisionSnapshot?.(tx, revisionId) ?? Promise.resolve(null);
}

export interface DatabaseCommandExecution {
  readonly revisionIds: Uuid[];
  readonly changedItemIds: Uuid[];
  readonly primaryItemId: Uuid;
}

export interface DatabaseTrashImpact {
  readonly isDatabase: boolean;
  readonly activeEntryCount: number;
}

export async function previewDatabaseTrashImpact(
  tx: Transaction,
  itemId: Uuid,
): Promise<DatabaseTrashImpact> {
  const owner = await getItem(tx, itemId);
  if (owner?.kind !== "database") return { isDatabase: false, activeEntryCount: 0 };
  const rows = await tx
    .select({ kind: items.kind })
    .from(placements)
    .innerJoin(items, eq(items.id, placements.itemId))
    .where(
      and(
        eq(placements.parentItemId, itemId),
        eq(placements.kind, "hierarchy"),
        isNull(placements.removedRevisionId),
        eq(items.lifecycle, "active"),
      ),
    );
  return {
    isDatabase: true,
    activeEntryCount: rows.filter((row) => row.kind === "page" || row.kind === "folder").length,
  };
}

/** Apply ordinary page branch lifecycle independently of source membership. */
export async function executeDatabaseTrash(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly itemId: Uuid;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<LifecycleExecution>> {
  return executeTrash(tx, input);
}

/** Restores the complete lifecycle group recorded by executeDatabaseTrash. */
export async function executeDatabaseRestore(
  tx: Transaction,
  input: {
    readonly mutationId: Uuid;
    readonly itemId: Uuid;
    readonly fallbackParentItemId?: Uuid | null;
    readonly acceptedAt: Date;
  },
): Promise<DomainResult<LifecycleExecution>> {
  return executeRestore(tx, input);
}

async function validateStructuredValues(
  tx: Transaction,
  input: {
    readonly definition: DatabaseDefinition;
    readonly values: Extract<
      DatabaseMutationCommand,
      {
        type:
          | "database.entry.create"
          | "database.entry.values.replace"
          | "database.entry.values.resolve-conflict";
      }
    >["values"];
    readonly relationTargets: RelationTargets;
  },
): Promise<
  DomainResult<{ readonly values: EntryValues["values"]; readonly relations: RelationTargets }>
> {
  const properties = new Map(
    input.definition.properties.map((property) => [property.id, property]),
  );
  const values: Record<string, EntryValues["values"][Uuid]> = {};
  for (const [propertyId, rawValue] of Object.entries(input.values)) {
    const property = properties.get(propertyId as Uuid);
    if (property === undefined || property.type === "title" || property.type === "relation") {
      return err("validation.invalid-payload", "Structured value property is unavailable");
    }
    const normalized = normalizePropertyValue(property, rawValue);
    if (!normalized.ok || normalized.value === undefined) {
      return normalized.ok
        ? err("validation.invalid-payload", "Structured value is absent")
        : (normalized as DomainResult<never>);
    }
    values[propertyId] = normalized.value;
  }

  const relations: Record<string, readonly Uuid[]> = {};
  for (const [propertyId, rawTargets] of Object.entries(input.relationTargets)) {
    const property = properties.get(propertyId as Uuid);
    if (property === undefined || property.type !== "relation") {
      return err("validation.invalid-payload", "Relationship property is unavailable");
    }
    const normalized = normalizeRelationTargets(property, rawTargets);
    if (!normalized.ok || normalized.value === undefined) {
      return normalized.ok
        ? err("validation.invalid-payload", "Relationship target set is absent")
        : (normalized as DomainResult<never>);
    }
    for (const targetId of normalized.value) {
      const target = await getItem(tx, targetId);
      if (target === null || target.lifecycle === "purged") {
        return err("relationship.endpoint-unavailable", "Relationship target is unavailable");
      }
    }
    relations[propertyId] = normalized.value;
  }
  return ok({
    values: values as EntryValues["values"],
    relations: relations as RelationTargets,
  });
}

async function replacementSourceAndPresentation(
  tx: Transaction,
  context: DatabaseCommandContext,
  record: NonNullable<Awaited<ReturnType<typeof readDatabaseRecord>>>,
  definition: DatabaseDefinition,
): Promise<
  DomainResult<{
    readonly source: DatabaseSourceDefinition;
    readonly presentation: DatabasePresentationDefinition;
    readonly presentationVersion: number;
  }>
> {
  const currentPresentation = await readCurrentDatabasePresentation(
    tx,
    record.databaseId,
    snapshotResolver(tx, context),
  );
  const presentationRecord = await readDatabasePresentationRecord(tx, record.databaseId);
  if (currentPresentation === null || presentationRecord === null) {
    return err("database.not-found", "Database presentation is unavailable");
  }
  const source = validateDatabaseSource({
    format: "myownnotion.database-source+json",
    formatVersion: 1,
    sourceId: record.sourceId,
    ownerItemId: record.databaseId,
    name: definition.name ?? "Base sans nom",
    properties: definition.properties,
    taskRoles: definition.taskRoles,
  });
  if (!source.ok) return source;
  const presentation = validateDatabasePresentation(
    {
      ...currentPresentation,
      views: definition.views.map((view) => ({
        ...view,
        sourceId:
          currentPresentation.views.find((existing) => existing.id === view.id)?.sourceId ??
          record.sourceId,
      })),
    },
    "database",
  );
  if (!presentation.ok) return presentation;
  return ok({
    source: source.value,
    presentation: presentation.value,
    presentationVersion: presentationRecord.presentationVersion,
  });
}

async function executeReplacePresentation(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.presentation.replace" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const item = await getItem(tx, command.containerItemId);
  const record = await readDatabasePresentationRecord(tx, command.containerItemId);
  if (
    item === null ||
    record === null ||
    item.lifecycle !== "active" ||
    (item.kind !== "database" && item.kind !== "database_view")
  ) {
    return err("database.not-found", "Database presentation is unavailable");
  }
  if (record.presentationRevisionId !== command.baseRevisionId) {
    return err("revision.stale-base", "Database views changed since this edit was prepared", {
      competingRevisionIds: [record.presentationRevisionId],
    });
  }
  const current = await readCurrentDatabasePresentation(
    tx,
    command.containerItemId,
    snapshotResolver(tx, context),
  );
  if (current === null) return err("database.not-found", "Database presentation is unavailable");
  const candidate = validateDatabasePresentation(command.presentation, item.kind);
  if (!candidate.ok || candidate.value.containerItemId !== command.containerItemId) {
    return err("validation.invalid-payload", "Database presentation is invalid");
  }
  const activeCurrent = current.views.filter((view) => view.state === "active");
  const activeCandidate = candidate.value.views.filter((view) => view.state === "active");
  if (
    item.kind === "database" &&
    activeCurrent.length === 1 &&
    activeCandidate.length === 1 &&
    activeCurrent[0]?.sourceId !== activeCandidate[0]?.sourceId
  ) {
    return err("database.view-source-locked", "Add another view before changing its source");
  }
  for (const view of candidate.value.views) {
    const source = await readDatabaseRecordBySourceId(tx, view.sourceId);
    if (source === null || source.workspaceId !== context.workspaceId) {
      return err("database.source-unavailable", "View source does not exist");
    }
    const owner = await getItem(tx, source.databaseId);
    if (
      owner?.lifecycle !== "active" &&
      !current.views.some((existing) => existing.sourceId === view.sourceId)
    ) {
      return err("database.source-unavailable", "View source is unavailable");
    }
  }
  const revisionId = generateUuidV7();
  const advanced = await advanceDatabasePresentationVersion(tx, {
    containerItemId: command.containerItemId,
    presentationRevisionId: revisionId,
    expectedVersion: record.presentationVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database presentation version changed");
  const snapshot = await buildItemSnapshot(tx, command.containerItemId);
  snapshot["databasePresentation"] = candidate.value;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.containerItemId,
    mutationId: context.mutationId,
    parentRevisionIds: [item.currentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await tx
    .update(items)
    .set({
      currentRevisionId: revisionId,
      updatedAt: context.acceptedAt,
    })
    .where(eq(items.id, command.containerItemId));
  await supersedeRevision(tx, item.currentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.containerItemId],
    primaryItemId: command.containerItemId,
  });
}

async function executeCreateDatabase(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.create" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  if (
    (await readDatabaseRecord(tx, command.id)) !== null ||
    (await getItem(tx, command.id)) !== null
  ) {
    return err("mutation.duplicate", "Database identity already exists");
  }
  const parentId = command.hostPageId ?? command.placement.parentItemId;
  const parent = parentId === null ? null : await getItem(tx, parentId);
  const plan = validateCreateItem(
    {
      getItem: (id) => (id === parent?.id ? parent : null),
      getActivePlacements: () => [],
      getActiveChildren: () => [],
    },
    {
      id: command.id,
      kind: "database",
      name: command.name,
      placement: { ...command.placement, parentItemId: parentId, kind: "hierarchy" },
    },
  );
  if (!plan.ok) return plan as DomainResult<DatabaseCommandExecution>;
  if (command.hostPageId !== undefined) {
    const host = await getItem(tx, command.hostPageId);
    if (host === null || host.kind !== "page" || host.lifecycle !== "active")
      return err("item.not-active", "Database display needs an active page");
  }
  const definition = createInitialDatabaseDefinition(command);
  const validatedDefinition = validateDatabaseDefinition(definition);
  if (!validatedDefinition.ok) return validatedDefinition as DomainResult<DatabaseCommandExecution>;
  const sourceId = command.sourceId ?? ownedSourceIdFromItemId(command.id);
  const source: DatabaseSourceDefinition = {
    format: "myownnotion.database-source+json",
    formatVersion: 1,
    sourceId,
    ownerItemId: command.id,
    name: command.name,
    properties: definition.properties,
    taskRoles: definition.taskRoles,
  };
  const presentation: DatabasePresentationDefinition = {
    format: "myownnotion.database-presentation+json",
    formatVersion: 1,
    containerItemId: command.id,
    views: definition.views.map((view) => ({ ...view, sourceId })),
  };
  const validatedSource = validateDatabaseSource(source);
  if (!validatedSource.ok) return validatedSource as DomainResult<DatabaseCommandExecution>;
  const validatedPresentation = validateDatabasePresentation(presentation, "database");
  if (!validatedPresentation.ok)
    return validatedPresentation as DomainResult<DatabaseCommandExecution>;

  const revisionId = generateUuidV7();
  await tx.insert(items).values({
    id: command.id,
    workspaceId: context.workspaceId,
    kind: "database",
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  await tx.insert(placements).values({
    id: command.placement.id,
    workspaceId: context.workspaceId,
    itemId: command.id,
    itemIsFile: false,
    kind: "hierarchy",
    parentItemId: parentId,
    positionKey: command.placement.positionKey,
    createdRevisionId: revisionId,
  });
  await insertDatabaseRecord(tx, {
    databaseId: command.id,
    sourceId,
    definitionRevisionId: revisionId,
    workspaceId: context.workspaceId,
    acceptedAt: context.acceptedAt,
  });
  await tx.insert(databasePresentations).values({
    itemId: command.id,
    workspaceId: context.workspaceId,
    presentationRevisionId: revisionId,
    presentationVersion: 1,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  const snapshot = await buildItemSnapshot(tx, command.id);
  snapshot["databaseDefinition"] = validatedDefinition.value;
  snapshot["databaseDefinitionVersion"] = 1;
  snapshot["databaseSource"] = validatedSource.value;
  snapshot["databasePresentation"] = validatedPresentation.value;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.id,
    mutationId: context.mutationId,
    parentRevisionIds: [],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.id],
    primaryItemId: command.id,
  });
}

async function executeCreateLinkedView(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database_view.create" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  if ((await getItem(tx, command.id)) !== null) {
    return err("mutation.duplicate", "Linked view identity already exists");
  }
  const parentId = command.placement.parentItemId;
  const parent = parentId === null ? null : await getItem(tx, parentId);
  const plan = validateCreateItem(
    {
      getItem: (id) => (id === parent?.id ? parent : null),
      getActivePlacements: () => [],
      getActiveChildren: () => [],
    },
    {
      id: command.id,
      kind: "database_view",
      name: command.name,
      placement: { ...command.placement, kind: "hierarchy" },
    },
  );
  if (!plan.ok) return plan as DomainResult<DatabaseCommandExecution>;
  const source = await readDatabaseRecordBySourceId(tx, command.sourceId);
  if (
    source === null ||
    source.workspaceId !== context.workspaceId ||
    (await getItem(tx, source.databaseId))?.lifecycle !== "active"
  ) {
    return err("database.source-unavailable", "Linked view source is unavailable");
  }
  const definition = await readCurrentDatabaseDefinition(
    tx,
    source.databaseId,
    snapshotResolver(tx, context),
  );
  const template = definition?.views.find((view) => view.state === "active");
  if (template === undefined)
    return err("database.source-unavailable", "Source has no view template");
  const presentation: DatabasePresentationDefinition = {
    format: "myownnotion.database-presentation+json",
    formatVersion: 1,
    containerItemId: command.id,
    views: [{ ...template, id: command.initialViewId, sourceId: command.sourceId }],
  };
  const validated = validateDatabasePresentation(presentation, "database_view");
  if (!validated.ok) return validated as DomainResult<DatabaseCommandExecution>;
  const revisionId = generateUuidV7();
  await tx.insert(items).values({
    id: command.id,
    workspaceId: context.workspaceId,
    kind: "database_view",
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  await tx.insert(placements).values({
    id: command.placement.id,
    workspaceId: context.workspaceId,
    itemId: command.id,
    itemIsFile: false,
    kind: "hierarchy",
    parentItemId: parentId,
    positionKey: command.placement.positionKey,
    createdRevisionId: revisionId,
  });
  await tx.insert(databasePresentations).values({
    itemId: command.id,
    workspaceId: context.workspaceId,
    presentationRevisionId: revisionId,
    presentationVersion: 1,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  const snapshot = await buildItemSnapshot(tx, command.id);
  snapshot["databasePresentation"] = validated.value;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.id,
    mutationId: context.mutationId,
    parentRevisionIds: [],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  return ok({ revisionIds: [revisionId], changedItemIds: [command.id], primaryItemId: command.id });
}

async function executeReplaceDefinition(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.definition.replace" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  // A Drizzle transaction owns one pg client. Queries on that client are
  // deliberately sequential: pg 9 removes the accidental concurrent-query
  // queue that Promise.all relied on.
  const ownedSources = await listDatabaseRecordsByOwner(tx, command.databaseId);
  const record =
    command.sourceId === undefined
      ? (ownedSources[0] ?? null)
      : (ownedSources.find((source) => source.sourceId === command.sourceId) ?? null);
  const item = await getItem(tx, command.databaseId);
  const definitionRevisionId = record?.definitionRevisionId ?? null;
  const sourceSnapshot =
    definitionRevisionId === null
      ? null
      : await tx
          .select({ snapshot: revisions.snapshot })
          .from(revisions)
          .where(eq(revisions.id, definitionRevisionId))
          .limit(1);
  const storedSnapshot = sourceSnapshot?.[0]?.snapshot as
    | Record<string, unknown>
    | null
    | undefined;
  const storedDefinition = storedSnapshot?.["databaseDefinition"];
  const currentDefinition =
    typeof storedDefinition === "object" && storedDefinition !== null
      ? (storedDefinition as DatabaseDefinition)
      : await readCurrentDatabaseDefinition(tx, command.databaseId, snapshotResolver(tx, context));
  if (record === null || item === null || currentDefinition === null) {
    return err("database.not-found", "Database does not exist");
  }
  if ((record.definitionRevisionId ?? item.currentRevisionId) !== command.baseRevisionId) {
    return err("revision.stale-base", "Database changed since this definition was prepared", {
      competingRevisionIds: [record.definitionRevisionId ?? item.currentRevisionId],
    });
  }
  const candidate = validateDatabaseDefinition(command.definition);
  if (!candidate.ok || candidate.value.databaseId !== command.databaseId) {
    return err("validation.invalid-payload", "Database definition is invalid");
  }
  for (const embedding of candidate.value.embeddings ?? []) {
    const previous = currentDefinition.embeddings?.find((value) => value.id === embedding.id);
    if (embedding.state === "retired" || previous?.hostPageId === embedding.hostPageId) continue;
    const host = await getItem(tx, embedding.hostPageId);
    if (host === null || host.kind !== "page" || host.lifecycle !== "active")
      return err("item.not-active", "Database display needs an active page");
  }
  if (currentDefinition.embeddings !== undefined && candidate.value.embeddings === undefined)
    return err("validation.invalid-payload", "This client must preserve linked database displays");
  const entryRecords = await listDatabaseEntryRecords(tx, command.databaseId);
  const entryValues: EntryValues[] = [];
  for (const entry of entryRecords) {
    const values = await readCurrentDatabaseEntryValues(
      tx,
      entry.entryId,
      snapshotResolver(tx, context),
      command.databaseId,
    );
    if (values !== null) entryValues.push(values);
  }
  const impact = await previewDefinitionImpact({
    baseRevisionId: command.baseRevisionId,
    current: currentDefinition,
    candidate: candidate.value,
    entries: entryValues,
  });
  if (impact.destructive && command.impactConfirmation === undefined) {
    return err("database.impact-confirmation-required", "Database change requires confirmation");
  }
  if (
    impact.destructive &&
    command.impactConfirmation !== undefined &&
    command.impactConfirmation.digest !== impact.impactDigest
  ) {
    return err("database.impact-stale", "Database impact changed before commit");
  }

  const parts = await replacementSourceAndPresentation(tx, context, record, candidate.value);
  if (!parts.ok) return parts;

  const revisionId = generateUuidV7();
  const advanced = await advanceDatabaseDefinitionVersion(tx, {
    databaseId: command.databaseId,
    sourceId: record.sourceId,
    definitionRevisionId: revisionId,
    expectedVersion: record.definitionVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database definition version changed");
  if (
    !(await advanceDatabasePresentationVersion(tx, {
      containerItemId: command.databaseId,
      presentationRevisionId: revisionId,
      expectedVersion: parts.value.presentationVersion,
      acceptedAt: context.acceptedAt,
    }))
  )
    return err("mutation.conflict", "Database presentation version changed");
  // A source revision never recopies private editorial content from its former
  // host. Its journal owns only the live independent resource definition.
  const snapshot = {
    databaseDefinition: candidate.value,
    databaseDefinitionVersion: record.definitionVersion + 1,
    databaseSource: parts.value.source,
    databasePresentation: parts.value.presentation,
  };
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.databaseId,
    mutationId: context.mutationId,
    parentRevisionIds: [record.definitionRevisionId ?? item.currentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(
    tx,
    record.definitionRevisionId ?? item.currentRevisionId,
    context.acceptedAt,
  );
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.databaseId],
    primaryItemId: command.databaseId,
  });
}

async function executeResolveDefinitionConflict(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.definition.resolve-conflict" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const record = await readDatabaseRecord(tx, command.databaseId);
  const item = await getItem(tx, command.databaseId);
  const currentDefinition = await readCurrentDatabaseDefinition(
    tx,
    command.databaseId,
    snapshotResolver(tx, context),
  );
  if (record === null || item === null || currentDefinition === null) {
    return err("database.not-found", "Database does not exist");
  }
  if (
    !command.resolvedRevisionIds.includes(record.definitionRevisionId ?? item.currentRevisionId)
  ) {
    return err("revision.stale-base", "Database changed since this conflict was reviewed", {
      competingRevisionIds: [record.definitionRevisionId ?? item.currentRevisionId],
    });
  }
  const candidate = validateDatabaseDefinition(command.definition);
  if (!candidate.ok || candidate.value.databaseId !== command.databaseId) {
    return err("validation.invalid-payload", "Database definition is invalid");
  }
  for (const embedding of candidate.value.embeddings ?? []) {
    const previous = currentDefinition.embeddings?.find((value) => value.id === embedding.id);
    if (embedding.state === "retired" || previous?.hostPageId === embedding.hostPageId) continue;
    const host = await getItem(tx, embedding.hostPageId);
    if (host === null || host.kind !== "page" || host.lifecycle !== "active")
      return err("item.not-active", "Database display needs an active page");
  }
  if (currentDefinition.embeddings !== undefined && candidate.value.embeddings === undefined)
    return err("validation.invalid-payload", "This client must preserve linked database displays");
  const entryRecords = await listDatabaseEntryRecords(tx, command.databaseId);
  const entryValues: EntryValues[] = [];
  for (const entry of entryRecords) {
    const values = await readCurrentDatabaseEntryValues(
      tx,
      entry.entryId,
      snapshotResolver(tx, context),
      command.databaseId,
    );
    if (values !== null) entryValues.push(values);
  }
  const impact = await previewDefinitionImpact({
    baseRevisionId: record.definitionRevisionId ?? item.currentRevisionId,
    current: currentDefinition,
    candidate: candidate.value,
    entries: entryValues,
  });
  if (impact.destructive && command.impactConfirmation === undefined) {
    return err("database.impact-confirmation-required", "Database change requires confirmation");
  }
  if (
    impact.destructive &&
    command.impactConfirmation !== undefined &&
    command.impactConfirmation.digest !== impact.impactDigest
  ) {
    return err("database.impact-stale", "Database impact changed before resolution");
  }

  const parts = await replacementSourceAndPresentation(tx, context, record, candidate.value);
  if (!parts.ok) return parts;

  const revisionId = generateUuidV7();
  const advanced = await advanceDatabaseDefinitionVersion(tx, {
    databaseId: command.databaseId,
    sourceId: record.sourceId,
    definitionRevisionId: revisionId,
    expectedVersion: record.definitionVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database definition version changed");
  if (
    !(await advanceDatabasePresentationVersion(tx, {
      containerItemId: command.databaseId,
      presentationRevisionId: revisionId,
      expectedVersion: parts.value.presentationVersion,
      acceptedAt: context.acceptedAt,
    }))
  )
    return err("mutation.conflict", "Database presentation version changed");
  // A source revision never recopies private editorial content from its former
  // host. Its journal owns only the live independent resource definition.
  const snapshot = {
    databaseDefinition: candidate.value,
    databaseDefinitionVersion: record.definitionVersion + 1,
    databaseSource: parts.value.source,
    databasePresentation: parts.value.presentation,
  };
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.databaseId,
    mutationId: context.mutationId,
    parentRevisionIds: [...command.resolvedRevisionIds],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  for (const parentRevisionId of command.resolvedRevisionIds) {
    await supersedeRevision(tx, parentRevisionId, context.acceptedAt);
  }
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.databaseId],
    primaryItemId: command.databaseId,
  });
}

async function executeCreateEntry(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.entry.create" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const ownedSources = await listDatabaseRecordsByOwner(tx, command.databaseId);
  const membershipSource =
    command.sourceId === undefined
      ? ownedSources[0]
      : ownedSources.find((source) => source.sourceId === command.sourceId);
  const database = membershipSource ?? null;
  const databaseItem = await getItem(tx, command.databaseId);
  const definitionRevisionId = database?.definitionRevisionId ?? null;
  const sourceSnapshot =
    definitionRevisionId === null
      ? null
      : await tx
          .select({ snapshot: revisions.snapshot })
          .from(revisions)
          .where(eq(revisions.id, definitionRevisionId))
          .limit(1);
  const storedSnapshot = sourceSnapshot?.[0]?.snapshot as
    | Record<string, unknown>
    | null
    | undefined;
  const sourceDefinition = storedSnapshot?.["databaseDefinition"];
  const definition =
    typeof sourceDefinition === "object" && sourceDefinition !== null
      ? (sourceDefinition as DatabaseDefinition)
      : await readCurrentDatabaseDefinition(tx, command.databaseId, snapshotResolver(tx, context));
  const existingItem = await getItem(tx, command.id);
  const existingMembership = await readDatabaseEntryRecord(tx, command.id);
  if (database === null || databaseItem === null || definition === null) {
    return err("database.not-found", "Database does not exist");
  }
  if (databaseItem.kind !== "database" || databaseItem.lifecycle !== "active") {
    return err("database.source-unavailable", "Database source owner is not active");
  }
  if (command.kind === "folder" && command.document !== undefined) {
    return err("validation.invalid-payload", "Folders cannot carry a page document");
  }
  if (existingMembership !== null || existingItem !== null) {
    return err("database.membership-conflict", "Page already has a database membership");
  }
  // An entry is an ordinary page or folder directly beneath the source owner.
  const placement = command.placement ?? {
    id: databaseEntryPlacementId(command.id),
    parentItemId: command.databaseId,
    positionKey: `a${command.id.replaceAll("-", "")}`,
  };
  if (placement.parentItemId !== command.databaseId) {
    return err(
      "validation.invalid-payload",
      "Database entries must be direct children of their source owner",
    );
  }
  const plan = validateCreateItem(
    {
      getItem: (id) => (id === databaseItem.id ? databaseItem : null),
      getActivePlacements: () => [],
      getActiveChildren: () => [],
    },
    {
      id: command.id,
      kind: command.kind ?? "page",
      name: command.title,
      placement: {
        ...placement,
        parentItemId: command.databaseId,
        kind: "hierarchy",
      },
      ...(command.kind === "folder"
        ? {}
        : { pageDocument: command.document ?? EMPTY_PAGE_DOCUMENT }),
    },
  );
  if (!plan.ok) return plan as DomainResult<DatabaseCommandExecution>;
  const structured = await validateStructuredValues(tx, {
    definition,
    values: command.values,
    relationTargets: command.relationTargets,
  });
  if (!structured.ok) return structured as DomainResult<DatabaseCommandExecution>;

  const revisionId = generateUuidV7();
  await tx.insert(items).values({
    id: command.id,
    workspaceId: context.workspaceId,
    kind: command.kind ?? "page",
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  if (plan.value.pageDocument !== null) {
    await tx.insert(pageDocuments).values({
      pageId: command.id,
      format: plan.value.pageDocument.format,
      formatVersion: plan.value.pageDocument.formatVersion,
      body: plan.value.pageDocument.body,
    });
  }
  await tx.insert(placements).values({
    id: placement.id,
    workspaceId: context.workspaceId,
    itemId: command.id,
    itemIsFile: false,
    kind: "hierarchy",
    parentItemId: command.databaseId,
    positionKey: placement.positionKey,
    createdRevisionId: revisionId,
  });
  const entryValues: EntryValues = {
    format: "myownnotion.database-entry-values+json",
    formatVersion: 1,
    databaseId: command.databaseId,
    entryId: command.id,
    values: structured.value.values,
    preserved: [],
  };
  const snapshot = await buildItemSnapshot(tx, command.id);
  snapshot["databaseEntryValues"] = entryValues;
  snapshot["databaseEntryValueVersion"] = 1;
  snapshot["databaseRelationTargets"] = structured.value.relations;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.id,
    mutationId: context.mutationId,
    parentRevisionIds: [],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await insertDatabaseEntryRecord(tx, {
    entryId: command.id,
    databaseId: command.databaseId,
    sourceId: database.sourceId,
    workspaceId: context.workspaceId,
    addedRevisionId: revisionId,
    acceptedAt: context.acceptedAt,
  });
  await replaceDatabaseRelationships(tx, {
    workspaceId: context.workspaceId,
    databaseId: command.databaseId,
    entryId: command.id,
    revisionId,
    relationTargets: structured.value.relations,
  });
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.id],
    primaryItemId: command.id,
  });
}

async function executeReplaceEntryValues(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.entry.values.replace" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const entry = await readDatabaseEntryRecord(tx, command.entryId, command.databaseId);
  const ownerSource = await readDatabaseRecord(tx, command.databaseId);
  const item = await getItem(tx, command.entryId);
  const definition = await readCurrentDatabaseDefinition(
    tx,
    command.databaseId,
    snapshotResolver(tx, context),
  );
  const priorValues = await readCurrentDatabaseEntryValues(
    tx,
    command.entryId,
    snapshotResolver(tx, context),
    command.databaseId,
  );
  if (item === null || !(await isActiveDatabaseEntry(tx, command.databaseId, command.entryId))) {
    return err("database.entry-not-found", "Database entry does not exist");
  }
  if (definition === null || ownerSource === null) {
    return err("database.not-found", "Database definition is unavailable");
  }
  if (item.currentRevisionId !== command.baseRevisionId) {
    return err("revision.stale-base", "Database entry changed since values were prepared", {
      competingRevisionIds: [item.currentRevisionId],
    });
  }
  const structured = await validateStructuredValues(tx, {
    definition,
    values: command.values,
    relationTargets: command.relationTargets,
  });
  if (!structured.ok) return structured as DomainResult<DatabaseCommandExecution>;

  const revisionId = generateUuidV7();
  const advanced =
    entry === null
      ? await nextDatabaseEntryValueVersion(tx, command.entryId)
      : await advanceDatabaseEntryValueVersion(tx, {
          entryId: command.entryId,
          databaseId: command.databaseId,
          valueRevisionId: revisionId,
          expectedVersion: entry.valueVersion,
          acceptedAt: context.acceptedAt,
        });
  if (advanced === null) return err("mutation.conflict", "Database entry version changed");
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, command.entryId));
  const entryValues: EntryValues = {
    format: "myownnotion.database-entry-values+json",
    formatVersion: 1,
    databaseId: command.databaseId,
    entryId: command.entryId,
    values: structured.value.values,
    preserved: priorValues?.preserved ?? [],
  };
  const snapshot = await buildItemSnapshot(tx, command.entryId);
  snapshot["databaseEntryValues"] = entryValues;
  snapshot["databaseEntryValueVersion"] = advanced;
  snapshot["databaseRelationTargets"] = structured.value.relations;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.entryId,
    mutationId: context.mutationId,
    parentRevisionIds: [item.currentRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  if (entry === null) {
    await insertDatabaseEntryRecord(tx, {
      entryId: command.entryId,
      databaseId: command.databaseId,
      sourceId: ownerSource.sourceId,
      workspaceId: context.workspaceId,
      addedRevisionId: revisionId,
      valueRevisionId: revisionId,
      valueVersion: advanced,
      acceptedAt: context.acceptedAt,
    });
  }
  await replaceDatabaseRelationships(tx, {
    workspaceId: context.workspaceId,
    databaseId: command.databaseId,
    entryId: command.entryId,
    revisionId,
    relationTargets: structured.value.relations,
  });
  await supersedeRevision(tx, item.currentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.entryId],
    primaryItemId: command.entryId,
  });
}

/** Advance a reviewed parent only through automatic page history boundaries.
 * These revisions preserve structured values. Other commands require review.
 * Read headers only: encrypted snapshot payloads are not needed for this proof.
 */
async function resolutionParentsAfterConsolidation(
  tx: Transaction,
  entryId: Uuid,
  currentHead: Uuid,
  reviewedParents: readonly [Uuid, Uuid],
): Promise<readonly [Uuid, Uuid] | null> {
  let cursor = currentHead;
  for (let depth = 0; depth <= 64; depth += 1) {
    if (reviewedParents.includes(cursor)) {
      return [
        reviewedParents[0] === cursor ? currentHead : reviewedParents[0],
        reviewedParents[1] === cursor ? currentHead : reviewedParents[1],
      ];
    }
    if (depth === 64) return null;
    const [header] = await tx
      .select({
        itemId: revisions.itemId,
        commandType: mutations.commandType,
        status: mutations.status,
      })
      .from(revisions)
      .innerJoin(mutations, eq(mutations.id, revisions.mutationId))
      .where(eq(revisions.id, cursor))
      .limit(1);
    if (
      header?.itemId !== entryId ||
      header.commandType !== "page-operations.consolidated" ||
      header.status !== "accepted"
    )
      return null;
    const parents = await tx
      .select({ id: revisionParents.parentRevisionId })
      .from(revisionParents)
      .where(eq(revisionParents.revisionId, cursor))
      .limit(2);
    if (parents.length !== 1 || parents[0] === undefined) return null;
    cursor = parents[0].id as Uuid;
  }
  return null;
}

async function executeResolveEntryValuesConflict(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.entry.values.resolve-conflict" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const entry = await readDatabaseEntryRecord(tx, command.entryId, command.databaseId);
  const item = await getItem(tx, command.entryId);
  const definition = await readCurrentDatabaseDefinition(
    tx,
    command.databaseId,
    snapshotResolver(tx, context),
  );
  const priorValues = await readCurrentDatabaseEntryValues(
    tx,
    command.entryId,
    snapshotResolver(tx, context),
    command.databaseId,
  );
  if (
    entry === null ||
    item === null ||
    !(await isActiveDatabaseEntry(tx, command.databaseId, command.entryId))
  ) {
    return err("database.entry-not-found", "Database entry does not exist");
  }
  if (definition === null || priorValues === null) {
    return err("database.not-found", "Database definition is unavailable");
  }
  const parentRevisionIds = await resolutionParentsAfterConsolidation(
    tx,
    command.entryId,
    item.currentRevisionId,
    command.resolvedRevisionIds,
  );
  if (parentRevisionIds === null) {
    return err("revision.stale-base", "Database entry changed since this conflict was reviewed", {
      competingRevisionIds: [item.currentRevisionId],
    });
  }
  const structured = await validateStructuredValues(tx, {
    definition,
    values: command.values,
    relationTargets: command.relationTargets,
  });
  if (!structured.ok) return structured as DomainResult<DatabaseCommandExecution>;

  const revisionId = generateUuidV7();
  const advanced = await advanceDatabaseEntryValueVersion(tx, {
    entryId: command.entryId,
    databaseId: command.databaseId,
    valueRevisionId: revisionId,
    expectedVersion: entry.valueVersion,
    acceptedAt: context.acceptedAt,
  });
  if (advanced === null) return err("mutation.conflict", "Database entry version changed");
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, command.entryId));
  const entryValues: EntryValues = { ...priorValues, values: structured.value.values };
  const snapshot = await buildItemSnapshot(tx, command.entryId);
  snapshot["databaseEntryValues"] = entryValues;
  snapshot["databaseEntryValueVersion"] = advanced;
  snapshot["databaseRelationTargets"] = structured.value.relations;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.entryId,
    mutationId: context.mutationId,
    parentRevisionIds: [...parentRevisionIds],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await replaceDatabaseRelationships(tx, {
    workspaceId: context.workspaceId,
    databaseId: command.databaseId,
    entryId: command.entryId,
    revisionId,
    relationTargets: structured.value.relations,
  });
  for (const parentRevisionId of parentRevisionIds) {
    await supersedeRevision(tx, parentRevisionId, context.acceptedAt);
  }
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.entryId],
    primaryItemId: command.entryId,
  });
}

async function executeCreateOwnedSource(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.source.create" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const owner = await getItem(tx, command.ownerItemId);
  const presentationRecord = await readDatabasePresentationRecord(tx, command.ownerItemId);
  const presentation = await readCurrentDatabasePresentation(
    tx,
    command.ownerItemId,
    snapshotResolver(tx, context),
  );
  if (
    owner === null ||
    owner.lifecycle !== "active" ||
    (owner.kind !== "database" && owner.kind !== "database_view") ||
    presentationRecord === null ||
    presentation === null
  ) {
    return err("database.not-found", "Database page does not exist");
  }
  if (presentationRecord.presentationRevisionId !== command.baseRevisionId) {
    return err("revision.stale-base", "Database views changed since this source was prepared");
  }
  if ((await readDatabaseRecordBySourceId(tx, command.sourceId)) !== null) {
    return err("mutation.duplicate", "Source identity already exists");
  }
  const definition = createInitialDatabaseDefinition({
    type: "database.create",
    id: command.ownerItemId,
    sourceId: command.sourceId,
    name: command.name,
    placement: {
      id: command.initialViewId,
      parentItemId: command.ownerItemId,
      positionKey: "a",
    },
    titlePropertyId: command.titlePropertyId,
    initialViewId: command.initialViewId,
    initialViewName: command.initialViewName,
  });
  const validatedDefinition = validateDatabaseDefinition(definition);
  if (!validatedDefinition.ok) return validatedDefinition as DomainResult<DatabaseCommandExecution>;
  const source: DatabaseSourceDefinition = {
    format: "myownnotion.database-source+json",
    formatVersion: 1,
    sourceId: command.sourceId,
    ownerItemId: command.ownerItemId,
    name: command.name,
    properties: definition.properties,
    taskRoles: definition.taskRoles,
  };
  const validatedSource = validateDatabaseSource(source);
  if (!validatedSource.ok) return validatedSource as DomainResult<DatabaseCommandExecution>;
  const nextPresentation: DatabasePresentationDefinition = {
    ...presentation,
    views: [
      ...presentation.views,
      {
        id: command.initialViewId,
        name: command.initialViewName,
        type: "table",
        positionKey: keyAfterAll(presentation.views.map((view) => view.positionKey)),
        state: "active",
        sourceId: command.sourceId,
        properties: definition.views[0]?.properties ?? [],
        filter: { mode: "all", criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
  };
  const validatedPresentation = validateDatabasePresentation(
    nextPresentation,
    owner.kind === "database_view" ? "database" : owner.kind,
  );
  if (!validatedPresentation.ok)
    return validatedPresentation as DomainResult<DatabaseCommandExecution>;
  const revisionId = generateUuidV7();
  if (owner.kind === "database_view") {
    await tx
      .update(items)
      .set({ kind: "database", updatedAt: context.acceptedAt })
      .where(eq(items.id, command.ownerItemId));
  }
  await insertDatabaseRecord(tx, {
    databaseId: command.ownerItemId,
    sourceId: command.sourceId,
    definitionRevisionId: revisionId,
    workspaceId: context.workspaceId,
    acceptedAt: context.acceptedAt,
  });
  if (
    !(await advanceDatabasePresentationVersion(tx, {
      containerItemId: command.ownerItemId,
      presentationRevisionId: revisionId,
      expectedVersion: presentationRecord.presentationVersion,
      acceptedAt: context.acceptedAt,
    }))
  )
    return err("mutation.conflict", "Database presentation version changed");
  const snapshot = {
    databaseDefinition: validatedDefinition.value,
    databaseDefinitionVersion: 1,
    databaseSource: validatedSource.value,
    databasePresentation: validatedPresentation.value,
  };
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.ownerItemId,
    mutationId: context.mutationId,
    parentRevisionIds: [command.baseRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(tx, command.baseRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.ownerItemId],
    primaryItemId: command.ownerItemId,
  });
}

async function executeDeleteOwnedSource(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.source.delete" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const owner = await getItem(tx, command.ownerItemId);
  const presentationRecord = await readDatabasePresentationRecord(tx, command.ownerItemId);
  const presentation = await readCurrentDatabasePresentation(
    tx,
    command.ownerItemId,
    snapshotResolver(tx, context),
  );
  const source = await readDatabaseRecordBySourceId(tx, command.sourceId);
  if (
    owner === null ||
    source === null ||
    source.databaseId !== command.ownerItemId ||
    presentationRecord === null ||
    presentation === null
  ) {
    return err("database.not-found", "Source does not exist on this page");
  }
  if (presentationRecord.presentationRevisionId !== command.baseRevisionId) {
    return err("revision.stale-base", "Database views changed since this source was prepared");
  }
  await tx.delete(databaseEntries).where(eq(databaseEntries.sourceId, command.sourceId));
  await tx.delete(databases).where(eq(databases.sourceId, command.sourceId));
  const remaining = (await listDatabaseRecordsByOwner(tx, command.ownerItemId)).length;
  if (remaining === 0 && owner.kind === "database") {
    await tx
      .update(items)
      .set({ kind: "database_view", updatedAt: context.acceptedAt })
      .where(eq(items.id, command.ownerItemId));
  }
  const nextPresentation: DatabasePresentationDefinition = {
    ...presentation,
    views: presentation.views.map((view) =>
      view.sourceId === command.sourceId ? { ...view, state: "retired" } : view,
    ),
  };
  const validatedPresentation = validateDatabasePresentation(
    nextPresentation,
    remaining === 0 ? "database_view" : "database",
  );
  if (!validatedPresentation.ok)
    return validatedPresentation as DomainResult<DatabaseCommandExecution>;
  const revisionId = generateUuidV7();
  if (
    !(await advanceDatabasePresentationVersion(tx, {
      containerItemId: command.ownerItemId,
      presentationRevisionId: revisionId,
      expectedVersion: presentationRecord.presentationVersion,
      acceptedAt: context.acceptedAt,
    }))
  )
    return err("mutation.conflict", "Database presentation version changed");
  const snapshot = await buildItemSnapshot(tx, command.ownerItemId);
  snapshot["databasePresentation"] = validatedPresentation.value;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.ownerItemId,
    mutationId: context.mutationId,
    parentRevisionIds: [command.baseRevisionId],
    snapshot,
    acceptedAt: context.acceptedAt,
  });
  await supersedeRevision(tx, command.baseRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.ownerItemId],
    primaryItemId: command.ownerItemId,
  });
}

export async function executeDatabaseCommand(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: DatabaseMutationCommand,
): Promise<DomainResult<DatabaseCommandExecution>> {
  switch (command.type) {
    case "database_view.create":
      return executeCreateLinkedView(tx, context, command);
    case "database.presentation.replace":
      return executeReplacePresentation(tx, context, command);
    case "database.create":
      return executeCreateDatabase(tx, context, command);
    case "database.source.create":
      return executeCreateOwnedSource(tx, context, command);
    case "database.source.delete":
      return executeDeleteOwnedSource(tx, context, command);
    case "database.definition.replace":
      return executeReplaceDefinition(tx, context, command);
    case "database.definition.resolve-conflict":
      return executeResolveDefinitionConflict(tx, context, command);
    case "database.entry.create":
      return executeCreateEntry(tx, context, command);
    case "database.entry.values.replace":
      return executeReplaceEntryValues(tx, context, command);
    case "database.entry.values.resolve-conflict":
      return executeResolveEntryValuesConflict(tx, context, command);
  }
}
