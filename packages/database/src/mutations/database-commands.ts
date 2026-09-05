import {
  createInitialDatabaseDefinition,
  type DatabaseDefinition,
  type DatabaseMutationCommand,
  type DomainResult,
  EMPTY_PAGE_DOCUMENT,
  type EntryValues,
  err,
  generateUuidV7,
  normalizePropertyValue,
  normalizeRelationTargets,
  ok,
  previewDefinitionImpact,
  type RelationTargets,
  type Uuid,
  validateCreateItem,
  validateDatabaseDefinition,
} from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import type { Transaction } from "../client.ts";
import {
  advanceDatabaseDefinitionVersion,
  advanceDatabaseEntryValueVersion,
  hasStructuredPageRole,
  insertDatabaseEntryRecord,
  insertDatabaseRecord,
  listDatabaseEntryRecords,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readDatabaseEntryRecord,
  readDatabaseRecord,
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
import { items, pageDocuments, placements } from "../schema/index.ts";

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

/** Membership never adds entries to a page trash operation (026). */
export async function previewDatabaseTrashImpact(
  _tx: Transaction,
  _itemId: Uuid,
): Promise<DatabaseTrashImpact> {
  return { isDatabase: false, activeEntryCount: 0 };
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
  const parent =
    command.placement.parentItemId === null
      ? null
      : await getItem(tx, command.placement.parentItemId);
  const plan = validateCreateItem(
    {
      getItem: (id) => (id === parent?.id ? parent : null),
      getActivePlacements: () => [],
      getActiveChildren: () => [],
    },
    {
      id: command.id,
      kind: "page",
      name: command.name,
      placement: { ...command.placement, kind: "hierarchy" },
      pageDocument: EMPTY_PAGE_DOCUMENT,
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

  const revisionId = generateUuidV7();
  await tx.insert(items).values({
    id: command.id,
    workspaceId: context.workspaceId,
    kind: "page",
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  await tx.insert(pageDocuments).values({
    pageId: command.id,
    format: EMPTY_PAGE_DOCUMENT.format,
    formatVersion: EMPTY_PAGE_DOCUMENT.formatVersion,
    body: EMPTY_PAGE_DOCUMENT.body,
  });
  if (command.hostPageId === undefined) {
    await tx.insert(placements).values({
      id: command.placement.id,
      workspaceId: context.workspaceId,
      itemId: command.id,
      itemIsFile: false,
      kind: "hierarchy",
      parentItemId: command.placement.parentItemId,
      positionKey: command.placement.positionKey,
      createdRevisionId: revisionId,
    });
  }
  await insertDatabaseRecord(tx, {
    databaseId: command.id,
    definitionRevisionId: revisionId,
    workspaceId: context.workspaceId,
    acceptedAt: context.acceptedAt,
  });
  const snapshot = await buildItemSnapshot(tx, command.id);
  snapshot["databaseDefinition"] = validatedDefinition.value;
  snapshot["databaseDefinitionVersion"] = 1;
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

async function executeReplaceDefinition(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.definition.replace" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  // A Drizzle transaction owns one pg client. Queries on that client are
  // deliberately sequential: pg 9 removes the accidental concurrent-query
  // queue that Promise.all relied on.
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

  const revisionId = generateUuidV7();
  const advanced = await advanceDatabaseDefinitionVersion(tx, {
    databaseId: command.databaseId,
    definitionRevisionId: revisionId,
    expectedVersion: record.definitionVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database definition version changed");
  // A source revision never recopies private editorial content from its former
  // host. Its journal owns only the live independent resource definition.
  const snapshot = {
    databaseDefinition: candidate.value,
    databaseDefinitionVersion: record.definitionVersion + 1,
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

  const revisionId = generateUuidV7();
  const advanced = await advanceDatabaseDefinitionVersion(tx, {
    databaseId: command.databaseId,
    definitionRevisionId: revisionId,
    expectedVersion: record.definitionVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database definition version changed");
  // A source revision never recopies private editorial content from its former
  // host. Its journal owns only the live independent resource definition.
  const snapshot = {
    databaseDefinition: candidate.value,
    databaseDefinitionVersion: record.definitionVersion + 1,
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
  const database = await readDatabaseRecord(tx, command.databaseId);
  const databaseItem = await getItem(tx, command.databaseId);
  const definition = await readCurrentDatabaseDefinition(
    tx,
    command.databaseId,
    snapshotResolver(tx, context),
  );
  const existingItem = await getItem(tx, command.id);
  const existingMembership = await readDatabaseEntryRecord(tx, command.id);
  if (database === null || databaseItem === null || definition === null) {
    return err("database.not-found", "Database does not exist");
  }
  if (existingMembership !== null || existingItem !== null) {
    return err("database.membership-conflict", "Page already has a database membership");
  }
  // Reuse ordinary page/document validation without assigning an implicit
  // navigation location to pages whose membership is their creation context.
  const placement = command.placement ?? {
    id: generateUuidV7(),
    parentItemId: null,
    positionKey: "a0",
  };
  const parent =
    (placement.parentItemId === command.databaseId ? null : placement.parentItemId) === null
      ? null
      : await getItem(tx, placement.parentItemId as Uuid);
  const plan = validateCreateItem(
    {
      getItem: (id) => (id === parent?.id ? parent : null),
      getActivePlacements: () => [],
      getActiveChildren: () => [],
    },
    {
      id: command.id,
      kind: "page",
      name: command.title,
      placement: {
        ...placement,
        parentItemId: placement.parentItemId === command.databaseId ? null : placement.parentItemId,
        kind: "hierarchy",
      },
      pageDocument: command.document ?? EMPTY_PAGE_DOCUMENT,
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
    kind: "page",
    name: plan.value.item.name,
    lifecycle: "active",
    currentRevisionId: revisionId,
    createdAt: context.acceptedAt,
    updatedAt: context.acceptedAt,
  });
  const document = plan.value.pageDocument ?? EMPTY_PAGE_DOCUMENT;
  await tx.insert(pageDocuments).values({
    pageId: command.id,
    format: document.format,
    formatVersion: document.formatVersion,
    body: document.body,
  });
  if (command.placement !== undefined)
    await tx.insert(placements).values({
      id: placement.id,
      workspaceId: context.workspaceId,
      itemId: command.id,
      itemIsFile: false,
      kind: "hierarchy",
      parentItemId: placement.parentItemId === command.databaseId ? null : placement.parentItemId,
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
  const entry = await readDatabaseEntryRecord(tx, command.entryId);
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
  );
  if (entry === null || item === null || entry.databaseId !== command.databaseId) {
    return err("database.entry-not-found", "Database entry does not exist");
  }
  if (definition === null || priorValues === null) {
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
  const advanced = await advanceDatabaseEntryValueVersion(tx, {
    entryId: command.entryId,
    expectedVersion: entry.valueVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database entry version changed");
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, command.entryId));
  const entryValues: EntryValues = {
    ...priorValues,
    values: structured.value.values,
  };
  const snapshot = await buildItemSnapshot(tx, command.entryId);
  snapshot["databaseEntryValues"] = entryValues;
  snapshot["databaseEntryValueVersion"] = entry.valueVersion + 1;
  snapshot["databaseRelationTargets"] = structured.value.relations;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.entryId,
    mutationId: context.mutationId,
    parentRevisionIds: [item.currentRevisionId],
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
  await supersedeRevision(tx, item.currentRevisionId, context.acceptedAt);
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.entryId],
    primaryItemId: command.entryId,
  });
}

async function executeResolveEntryValuesConflict(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: Extract<DatabaseMutationCommand, { type: "database.entry.values.resolve-conflict" }>,
): Promise<DomainResult<DatabaseCommandExecution>> {
  const entry = await readDatabaseEntryRecord(tx, command.entryId);
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
  );
  if (entry === null || item === null || entry.databaseId !== command.databaseId) {
    return err("database.entry-not-found", "Database entry does not exist");
  }
  if (definition === null || priorValues === null) {
    return err("database.not-found", "Database definition is unavailable");
  }
  if (!command.resolvedRevisionIds.includes(item.currentRevisionId)) {
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
    expectedVersion: entry.valueVersion,
    acceptedAt: context.acceptedAt,
  });
  if (!advanced) return err("mutation.conflict", "Database entry version changed");
  await tx
    .update(items)
    .set({ currentRevisionId: revisionId, updatedAt: context.acceptedAt })
    .where(eq(items.id, command.entryId));
  const entryValues: EntryValues = { ...priorValues, values: structured.value.values };
  const snapshot = await buildItemSnapshot(tx, command.entryId);
  snapshot["databaseEntryValues"] = entryValues;
  snapshot["databaseEntryValueVersion"] = entry.valueVersion + 1;
  snapshot["databaseRelationTargets"] = structured.value.relations;
  await insertRevision(tx, {
    id: revisionId,
    itemId: command.entryId,
    mutationId: context.mutationId,
    parentRevisionIds: [...command.resolvedRevisionIds],
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
  for (const parentRevisionId of command.resolvedRevisionIds) {
    await supersedeRevision(tx, parentRevisionId, context.acceptedAt);
  }
  return ok({
    revisionIds: [revisionId],
    changedItemIds: [command.entryId],
    primaryItemId: command.entryId,
  });
}

export async function executeDatabaseCommand(
  tx: Transaction,
  context: DatabaseCommandContext,
  command: DatabaseMutationCommand,
): Promise<DomainResult<DatabaseCommandExecution>> {
  switch (command.type) {
    case "database.create":
      return executeCreateDatabase(tx, context, command);
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

export { hasStructuredPageRole };
