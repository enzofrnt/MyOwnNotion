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
  type CanonicalItem,
  canContain,
  createInitialDatabaseDefinition,
  type DatabaseDefinition,
  type DatabaseMutationCommand,
  type DatabasePresentationDefinition,
  databaseEntryPlacementId,
  type EntryValues,
  generateUuidV7,
  type HierarchyView,
  INTERNAL_PAGE_LINK_RELATION_TYPE,
  keyAfterAll,
  type MutationCommand,
  normalizeEntryValueMap,
  normalizeRelationTargets,
  ownedSourceIdFromItemId,
  type Placement,
  pageBodyHoldsEditorialContent,
  previewDefinitionImpact,
  type RelationTargets,
  TRASH_RETENTION_MS,
  type Uuid,
  validateDatabaseDefinition,
  validateDatabasePresentation,
  validatePageLinkTargetSet,
  wouldCreateCycle,
} from "@myownnotion/domain";
import {
  databaseEntryPairKey,
  type LocalDatabase,
  type LocalItemRow,
  parentKeyOf,
  type SealedLocalDatabaseEntryRow,
  type SealedLocalDatabaseRow,
  type SealedLocalItemRow,
} from "../local-store/schema.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";
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
    itemIsFile: (itemsById.get(row.itemId)?.kind ?? "page") === "file",
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
            // Empty rather than opened. The view exists to answer structural
            // questions — is the parent active, is it a container — and the
            // domain reads a name only from the *command*, never from here.
            // Opening every title on every mutation would be the projection's
            // most expensive operation, paid to fill a field nothing reads.
            //
            // If an invariant ever does need the stored name, this is where it
            // breaks, and it breaks by comparing against "" rather than by
            // failing to compile. That is the risk, and it is why the reason
            // is written down rather than assumed obvious.
            name: "",
            icon: null,
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
  // Supplied when the sealed row already carries it. Generating a second one
  // here would leave the row pointing at a revision that does not exist.
  revisionId?: Uuid,
  mutationId?: Uuid,
): Promise<Uuid> {
  const id = revisionId ?? generateUuidV7();
  await db.revisionHeaders.put({
    id,
    itemId,
    mutationId: mutationId ?? id,
    parentRevisionIds,
    acceptedAt: now().toISOString(),
    local: 1,
  });
  return id;
}

async function reconcileLocalPageLinks(
  db: LocalDatabase,
  sourceItemId: Uuid,
  targetItemIds: readonly Uuid[],
): Promise<void> {
  const current = await db.relationships.where("sourceItemId").equals(sourceItemId).toArray();
  const active = current.filter((relationship) => relationship.relationType === "page:link");
  const desired = new Set(targetItemIds);
  for (const relationship of active) {
    if (!desired.has(relationship.targetItemId)) {
      await db.relationships.delete(relationship.id);
    }
    desired.delete(relationship.targetItemId);
  }
  for (const targetItemId of desired) {
    const target = await db.items.get(targetItemId);
    if (target === undefined || target.kind === "file" || target.lifecycle === "purged") {
      throw new LocalValidationError(
        "relationship.endpoint-unavailable",
        "Internal page-link target is not available locally",
      );
    }
    await db.relationships.add({
      id: generateUuidV7(),
      sourceItemId,
      targetItemId,
      relationType: "page:link",
      metadata: {},
    });
  }
}

async function normalizeStructuredCommandValues(
  db: LocalDatabase,
  definition: DatabaseDefinition,
  command: Extract<
    DatabaseMutationCommand,
    {
      type:
        | "database.entry.create"
        | "database.entry.values.replace"
        | "database.entry.values.resolve-conflict";
    }
  >,
): Promise<{ readonly values: EntryValues; readonly relationTargets: RelationTargets }> {
  const properties = new Map(definition.properties.map((property) => [property.id, property]));
  const normalizedValues = normalizeEntryValueMap(properties, command.values);
  if (!normalizedValues.ok)
    throw new LocalValidationError("validation.invalid-payload", normalizedValues.error.title);
  const values = normalizedValues.value;

  const relationTargets: Record<string, readonly Uuid[]> = {};
  for (const [propertyId, rawTargets] of Object.entries(command.relationTargets)) {
    const property = properties.get(propertyId as Uuid);
    if (property === undefined || property.type !== "relation") {
      throw new LocalValidationError(
        "validation.invalid-payload",
        "Relationship property is unavailable",
      );
    }
    const normalized = normalizeRelationTargets(property, rawTargets);
    if (!normalized.ok || normalized.value === undefined) {
      throw new LocalValidationError(
        "validation.invalid-payload",
        normalized.ok ? "Relationship targets are absent" : normalized.error.title,
      );
    }
    for (const targetId of normalized.value) {
      const target = await db.items.get(targetId);
      if (target === undefined || target.lifecycle === "purged") {
        throw new LocalValidationError(
          "relationship.endpoint-unavailable",
          "Relationship target is unavailable locally",
        );
      }
    }
    relationTargets[propertyId] = normalized.value;
  }
  return {
    values: {
      format: "myownnotion.database-entry-values+json",
      formatVersion: 1,
      databaseId: command.databaseId,
      entryId: command.type === "database.entry.create" ? command.id : command.entryId,
      values: values as EntryValues["values"],
      preserved: [],
    },
    relationTargets: relationTargets as RelationTargets,
  };
}

async function reconcileLocalDatabaseRelationships(
  db: LocalDatabase,
  input: {
    readonly databaseId: Uuid;
    readonly entryId: Uuid;
    readonly relationTargets: RelationTargets;
  },
): Promise<void> {
  const current = await db.relationships.where("sourceItemId").equals(input.entryId).toArray();
  const active = current.filter(
    (relationship) =>
      relationship.relationType === "database:property" &&
      relationship.metadata["databaseId"] === input.databaseId,
  );
  const desired = new Set(
    Object.entries(input.relationTargets).flatMap(([propertyId, targetIds]) =>
      targetIds.map((targetId) => `${propertyId}/${targetId}`),
    ),
  );
  for (const relationship of active) {
    const key = `${String(relationship.metadata["propertyId"])}/${relationship.targetItemId}`;
    if (!desired.delete(key)) await db.relationships.delete(relationship.id);
  }
  for (const key of [...desired].sort()) {
    const separator = key.indexOf("/");
    await db.relationships.add({
      id: generateUuidV7(),
      sourceItemId: input.entryId,
      targetItemId: key.slice(separator + 1) as Uuid,
      relationType: "database:property",
      metadata: {
        databaseId: input.databaseId,
        propertyId: key.slice(0, separator),
      },
    });
  }
}

/**
 * The rows a command will write, sealed, computed before any transaction opens.
 *
 * This split exists because of one Dexie property with an unpleasant failure
 * mode: a transaction commits as soon as control returns to the event loop for
 * anything that is not a Dexie promise. Sealing is WebCrypto and therefore
 * asynchronous, so doing it inside the transaction does not throw — it ends the
 * transaction early and lets the writes that follow land outside it. The
 * atomicity the outbox depends on would be gone with nothing to show for it.
 *
 * So: read and seal here, write there. The window between the two is a
 * single-user client applying its own queued mutations in order, and the
 * mutation id makes a replay a no-op, so a row changing underneath is not a
 * case this has to defend against.
 */
export interface PreparedProjectionWrite {
  /**
   * The revision this command will create.
   *
   * Generated here rather than inside the transaction, because the sealed row
   * carries it and the row has to be sealed before the transaction opens. It
   * is a client-side UUIDv7 with no dependency on stored state, so moving its
   * generation earlier changes nothing except when it happens.
   */
  readonly revisionId?: Uuid;
  /** The finished row to write, already sealed. */
  readonly item?: SealedLocalItemRow;
  readonly database?: SealedLocalDatabaseRow;
  /** An additional source owned by the same page, stored beside the container row. */
  readonly databaseSource?: SealedLocalDatabaseRow;
  readonly deletedSourceId?: Uuid;
  readonly databaseEntry?: SealedLocalDatabaseEntryRow;
  readonly relationTargets?: RelationTargets;
}

export async function prepareProjectionWrite(
  db: LocalDatabase,
  command: MutationCommand,
  codec: LocalRecordCodec,
): Promise<PreparedProjectionWrite> {
  switch (command.type) {
    case "database_view.create": {
      const sources = await Promise.all(
        [...(await db.databases.toArray()), ...(await db.databaseSources.toArray())].map((row) =>
          codec.openDatabase(row),
        ),
      );
      const source = sources.find((row) => row.sourceId === command.sourceId);
      const owner = source === undefined ? undefined : await db.items.get(source.itemId);
      const template = source?.definition.views.find((view) => view.state === "active");
      if (source === undefined || owner?.lifecycle !== "active" || template === undefined) {
        throw new LocalValidationError(
          "database.source-unavailable",
          "Linked view source is unavailable locally",
        );
      }
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: "database_view",
          name: command.name,
          icon: null,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument: null,
          file: null,
        }),
        database: await codec.sealDatabase({
          itemId: command.id,
          definitionVersion: source.definitionVersion,
          ...(source.definitionRevisionId === undefined
            ? {}
            : { definitionRevisionId: source.definitionRevisionId }),
          definition: source.definition,
          presentationVersion: 1,
          presentationRevisionId: revisionId,
          presentation: {
            format: "myownnotion.database-presentation+json",
            formatVersion: 1,
            containerItemId: command.id,
            views: [{ ...template, id: command.initialViewId, sourceId: command.sourceId }],
          },
        }),
      };
    }
    case "database.source.create": {
      const owner = await db.items.get(command.ownerItemId);
      const container = await db.databases.get(command.ownerItemId);
      const opened = container === undefined ? null : await codec.openDatabase(container);
      const presentation = opened?.presentation;
      if (
        owner === undefined ||
        owner.lifecycle !== "active" ||
        (owner.kind !== "database" && owner.kind !== "database_view") ||
        opened === null ||
        presentation === undefined ||
        opened.presentationRevisionId !== command.baseRevisionId
      ) {
        throw new LocalValidationError("database.not-found", "Database page does not exist");
      }
      if ((await db.databaseSources.get(command.sourceId)) !== undefined) {
        throw new LocalValidationError("mutation.duplicate", "Source identity already exists");
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
      const validatedPresentation = validateDatabasePresentation(nextPresentation, "database");
      if (!validatedPresentation.ok) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          validatedPresentation.error.title,
        );
      }
      const revisionId = generateUuidV7();
      const presentationVersion = (opened.presentationVersion ?? 1) + 1;
      return {
        revisionId,
        ...(owner.kind === "database_view"
          ? { item: { ...owner, kind: "database" as const } }
          : {}),
        database: await codec.sealDatabase({
          ...opened,
          presentation: validatedPresentation.value,
          presentationRevisionId: revisionId,
          presentationVersion,
        }),
        databaseSource: await codec.sealDatabase({
          itemId: command.ownerItemId,
          sourceId: command.sourceId,
          definition,
          definitionRevisionId: revisionId,
          definitionVersion: 1,
          presentation: validatedPresentation.value,
          presentationRevisionId: revisionId,
          presentationVersion,
        }),
      };
    }
    case "database.source.delete": {
      const owner = await db.items.get(command.ownerItemId);
      const container = await db.databases.get(command.ownerItemId);
      const opened = container === undefined ? null : await codec.openDatabase(container);
      const storedSource = await db.databaseSources.get(command.sourceId);
      const openedSource =
        storedSource === undefined ? null : await codec.openDatabase(storedSource);
      if (
        owner === undefined ||
        opened === null ||
        openedSource === null ||
        openedSource.itemId !== command.ownerItemId ||
        opened.presentation === undefined ||
        opened.presentationRevisionId !== command.baseRevisionId
      ) {
        throw new LocalValidationError("database.not-found", "Source does not exist on this page");
      }
      const owned = await db.databaseSources.where("itemId").equals(command.ownerItemId).count();
      const remaining = Math.max(0, owned - 1);
      const revisionId = generateUuidV7();
      const nextPresentation: DatabasePresentationDefinition = {
        ...opened.presentation,
        views: opened.presentation.views.map((view) =>
          view.sourceId === command.sourceId ? { ...view, state: "retired" as const } : view,
        ),
      };
      return {
        revisionId,
        ...(remaining === 0 && owner.kind === "database"
          ? { item: { ...owner, kind: "database_view" as const } }
          : {}),
        database: await codec.sealDatabase({
          ...opened,
          presentation: nextPresentation,
          presentationRevisionId: revisionId,
          presentationVersion: (opened.presentationVersion ?? 1) + 1,
        }),
        deletedSourceId: command.sourceId,
      };
    }
    case "database.create": {
      const revisionId = generateUuidV7();
      const definition = createInitialDatabaseDefinition(command);
      const validated = validateDatabaseDefinition(definition);
      if (!validated.ok) {
        throw new LocalValidationError("validation.invalid-payload", validated.error.title);
      }
      if (command.hostPageId !== undefined) {
        const host = await db.items.get(command.hostPageId);
        if (host === undefined || host.kind !== "page" || host.lifecycle !== "active")
          throw new LocalValidationError("item.not-found", "Database display needs an active page");
      }
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: "database",
          name: command.name,
          icon: null,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument: null,
          file: null,
        }),
        database: await codec.sealDatabase({
          itemId: command.id,
          sourceId: command.sourceId ?? ownedSourceIdFromItemId(command.id),
          definitionVersion: 1,
          definitionRevisionId: revisionId,
          definition: validated.value,
          presentationVersion: 1,
          presentationRevisionId: revisionId,
          presentation: {
            format: "myownnotion.database-presentation+json",
            formatVersion: 1,
            containerItemId: command.id,
            views: validated.value.views.map((view) => ({
              ...view,
              sourceId: command.sourceId ?? ownedSourceIdFromItemId(command.id),
            })),
          },
        }),
      };
    }

    case "database.definition.replace":
    case "database.definition.resolve-conflict": {
      const [containerRow, storedItem] = await Promise.all([
        db.databases.get(command.databaseId),
        db.items.get(command.databaseId),
      ]);
      const requestedSourceId =
        command.type === "database.definition.replace" ? command.sourceId : undefined;
      const openedContainer =
        containerRow === undefined ? null : await codec.openDatabase(containerRow);
      const containerSourceId =
        openedContainer?.sourceId ?? ownedSourceIdFromItemId(command.databaseId);
      const extraRow =
        requestedSourceId !== undefined && containerSourceId !== requestedSourceId
          ? await db.databaseSources.get(requestedSourceId)
          : undefined;
      if (
        requestedSourceId !== undefined &&
        containerSourceId !== requestedSourceId &&
        (extraRow === undefined || extraRow.itemId !== command.databaseId)
      ) {
        throw new LocalValidationError("database.not-found", "Source is not owned by this page");
      }
      const storedDatabase = extraRow ?? containerRow;
      if (storedDatabase === undefined) return {};
      const database = await codec.openDatabase(storedDatabase);
      const item = storedItem === undefined ? undefined : await codec.openItem(storedItem);
      const sourceRevisionId = database.definitionRevisionId ?? item?.currentRevisionId;
      if (sourceRevisionId === undefined) return {};
      if (
        command.type === "database.definition.replace" &&
        sourceRevisionId !== command.baseRevisionId
      ) {
        throw new LocalValidationError(
          "revision.stale-base",
          "Database changed since this definition was prepared",
        );
      }
      const candidate = validateDatabaseDefinition(command.definition);
      if (!candidate.ok || candidate.value.databaseId !== command.databaseId) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Database definition is invalid",
        );
      }
      if (database.definition.embeddings !== undefined && candidate.value.embeddings === undefined)
        throw new LocalValidationError(
          "validation.invalid-payload",
          "This client must preserve linked database displays",
        );
      const entryRows = await db.databaseEntryPairs
        .where("databaseId")
        .equals(command.databaseId)
        .toArray();
      const entryValues: EntryValues[] = [];
      for (const row of entryRows) {
        if (row.availability !== "present" || row.sealedValues === null) {
          throw new LocalValidationError(
            "database.projection-unavailable",
            "Complete entry values are required to assess this database change",
          );
        }
        entryValues.push((await codec.openDatabaseEntry(row)).values);
      }
      const impact = await previewDefinitionImpact({
        baseRevisionId: sourceRevisionId,
        current: database.definition,
        candidate: candidate.value,
        entries: entryValues,
      });
      if (impact.destructive && command.impactConfirmation === undefined) {
        throw new LocalValidationError(
          "database.impact-confirmation-required",
          "Database change requires confirmation",
        );
      }
      if (
        impact.destructive &&
        command.impactConfirmation !== undefined &&
        command.impactConfirmation.digest !== impact.impactDigest
      ) {
        throw new LocalValidationError("database.impact-stale", "Database impact changed");
      }
      const revisionId = generateUuidV7();
      const sealedDefinition = await codec.sealDatabase({
        ...database,
        itemId: command.databaseId,
        definitionVersion: database.definitionVersion + 1,
        definitionRevisionId: revisionId,
        definition: candidate.value,
      });
      return {
        revisionId,
        ...(item === undefined ? {} : { item: await codec.sealItem(item) }),
        ...(extraRow === undefined
          ? { database: sealedDefinition }
          : { databaseSource: sealedDefinition }),
      };
    }

    case "database.presentation.replace": {
      const stored = await db.databases.get(command.containerItemId);
      const itemRow = await db.items.get(command.containerItemId);
      if (stored === undefined || itemRow === undefined) {
        throw new LocalValidationError(
          "database.not-found",
          "Database presentation is unavailable locally",
        );
      }
      const database = await codec.openDatabase(stored);
      const item = await codec.openItem(itemRow);
      if (
        database.presentation === undefined ||
        database.presentationRevisionId === undefined ||
        database.presentationRevisionId !== command.baseRevisionId ||
        item.lifecycle !== "active"
      ) {
        throw new LocalValidationError(
          "revision.stale-base",
          "Database views changed since this edit was prepared",
        );
      }
      const validated = validateDatabasePresentation(
        command.presentation,
        item.kind === "database_view" ? "database_view" : "database",
      );
      if (!validated.ok || validated.value.containerItemId !== command.containerItemId) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Database presentation is invalid",
        );
      }
      const before = database.presentation.views.filter((view) => view.state === "active");
      const after = validated.value.views.filter((view) => view.state === "active");
      if (
        item.kind === "database" &&
        before.length === 1 &&
        after.length === 1 &&
        before[0]?.sourceId !== after[0]?.sourceId
      ) {
        throw new LocalValidationError(
          "database.view-source-locked",
          "Add another view before changing its source",
        );
      }
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({ ...item, currentRevisionId: revisionId }),
        database: await codec.sealDatabase({
          ...database,
          presentationVersion: (database.presentationVersion ?? 1) + 1,
          presentationRevisionId: revisionId,
          presentation: validated.value,
        }),
      };
    }

    case "database.entry.create": {
      const storedDatabase = await db.databases.get(command.databaseId);
      if (storedDatabase === undefined) return {};
      if (command.kind === "folder" && command.document !== undefined) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Folders cannot carry a page document",
        );
      }
      const database = await codec.openDatabase(storedDatabase);
      const structured = await normalizeStructuredCommandValues(db, database.definition, command);
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: command.kind ?? "page",
          name: command.title,
          icon: null,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument:
            command.kind === "folder"
              ? null
              : (command.document ?? {
                  format: "myownnotion.document+json",
                  formatVersion: 1,
                  body: {},
                }),
          file: null,
        }),
        databaseEntry: await codec.sealDatabaseEntry({
          entryItemId: command.id,
          databaseId: command.databaseId,
          sourceId:
            command.sourceId ?? database.sourceId ?? ownedSourceIdFromItemId(command.databaseId),
          valueVersion: 1,
          availability: "present",
          values: structured.values,
        }),
        relationTargets: structured.relationTargets,
      };
    }

    case "database.entry.values.replace":
    case "database.entry.values.resolve-conflict": {
      const [storedDatabase, storedEntry, storedItem] = await Promise.all([
        db.databases.get(command.databaseId),
        db.databaseEntryPairs.get(databaseEntryPairKey(command.databaseId, command.entryId)),
        db.items.get(command.entryId),
      ]);
      if (storedDatabase === undefined) {
        throw new LocalValidationError("database.not-found", "Database is not available locally");
      }
      if (storedItem === undefined) return {};
      const activePlacement = (
        await db.placements.where("itemId").equals(command.entryId).toArray()
      ).some(
        (placement) =>
          placement.kind === "hierarchy" && placement.parentItemId === command.databaseId,
      );
      if (!activePlacement) {
        throw new LocalValidationError("database.entry-not-found", "Entry is outside this source");
      }
      const [database, existingEntry, item] = await Promise.all([
        codec.openDatabase(storedDatabase),
        storedEntry === undefined ? Promise.resolve(null) : codec.openDatabaseEntry(storedEntry),
        codec.openItem(storedItem),
      ]);
      if (
        storedEntry !== undefined &&
        (storedEntry.availability !== "present" || storedEntry.sealedValues === null)
      ) {
        throw new LocalValidationError(
          "database.projection-unavailable",
          "Database entry values are not available on this device",
        );
      }
      if (
        command.type === "database.entry.values.replace" &&
        item.currentRevisionId !== command.baseRevisionId
      ) {
        throw new LocalValidationError(
          "revision.stale-base",
          "Database entry changed since values were prepared",
        );
      }
      const structured = await normalizeStructuredCommandValues(db, database.definition, command);
      const revisionId = generateUuidV7();
      const history = await db.databaseEntryPairs
        .where("entryItemId")
        .equals(command.entryId)
        .toArray();
      const nextVersion = Math.max(0, ...history.map((row) => row.valueVersion)) + 1;
      return {
        revisionId,
        item: await codec.sealItem({ ...item, currentRevisionId: revisionId }),
        databaseEntry: await codec.sealDatabaseEntry({
          key: databaseEntryPairKey(command.databaseId, command.entryId),
          entryItemId: command.entryId,
          databaseId: command.databaseId,
          availability: "present",
          valueVersion: nextVersion,
          values: { ...structured.values, preserved: existingEntry?.values.preserved ?? [] },
        }),
        relationTargets: structured.relationTargets,
      };
    }

    case "item.create": {
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: command.kind,
          name: command.name.trim(),
          icon: command.icon ?? null,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          // Just created here, so this device necessarily holds it.
          localAvailability: "present",
          pageDocument:
            command.kind === "page"
              ? (command.pageDocument ?? {
                  format: "myownnotion.document+json",
                  formatVersion: 1,
                  body: {},
                })
              : null,
          file: null,
        }),
      };
    }

    case "item.rename":
    case "item.icon":
    case "item.convert":
    case "item.favourite":
    case "item.offline":
    case "page.document.replace":
    // A resolution writes the same body an edit does, so it prepares the same
    // row. What differs is the lineage, and the lineage is written below.
    case "document.resolve-conflict": {
      const row = await db.items.get(command.itemId);
      // A missing row is not an error here. The write step raises the domain
      // failure with the message the caller expects, and duplicating that
      // check would mean two places deciding what "not found" means.
      if (row === undefined) {
        return {};
      }
      const opened = await codec.openItem(row);
      const revisionId = generateUuidV7();
      // Reopened, edited, resealed. A partial update is not available: the
      // envelope binds the whole row's identity, so a new title cannot be
      // written without re-deriving the record it belongs to.
      if (
        command.type === "item.convert" &&
        command.targetKind === "folder" &&
        !command.confirmedDestruction &&
        pageBodyHoldsEditorialContent(opened.pageDocument?.body)
      ) {
        // Refused before anything is written. Applying it optimistically would
        // show the owner a folder and then take it back when the server
        // declines; refusing here means the two sides agree from the start.
        throw new LocalValidationError(
          "conversion.confirmation-required",
          "Converting a page with content to a folder destroys that content",
        );
      }
      if (
        command.type === "page.document.replace" ||
        command.type === "document.resolve-conflict"
      ) {
        const pageLinks = validatePageLinkTargetSet(
          command.document,
          command.pageLinkTargetIds ?? [],
        );
        if (!pageLinks.ok) {
          throw new LocalValidationError("validation.invalid-payload", pageLinks.error.title);
        }
      }

      const edited = ((): LocalItemRow => {
        switch (command.type) {
          case "item.rename":
            return { ...opened, name: command.name.trim(), currentRevisionId: revisionId };
          case "item.icon":
            if (opened.kind === "file") {
              throw new LocalValidationError("item.wrong-kind", "Files do not carry a custom icon");
            }
            return { ...opened, icon: command.icon, currentRevisionId: revisionId };
          case "item.favourite":
            return { ...opened, favourite: command.favourite, currentRevisionId: revisionId };
          case "item.offline":
            return { ...opened, offlineIntent: command.offline, currentRevisionId: revisionId };
          case "item.convert":
            return {
              ...opened,
              kind: command.targetKind,
              // Confirmation was checked above using the same domain rule as
              // the server. Once accepted, a folder cannot retain a hidden
              // page body that could later resurrect on an offline conversion.
              // The opposite direction must be useful before the network is
              // available too: a folder has no document to retain, so seed the
              // same empty canonical envelope the server exposes for a page
              // without a stored body. Leaving this null made an optimistic
              // folder -> page conversion look like content that had never
              // downloaded and prevented the owner from editing it offline.
              pageDocument:
                command.targetKind === "folder"
                  ? null
                  : (opened.pageDocument ?? {
                      format: "myownnotion.document+json",
                      formatVersion: 1,
                      body: {},
                    }),
              currentRevisionId: revisionId,
            };
          default:
            return {
              ...opened,
              pageDocument: {
                format: command.document.format,
                formatVersion: command.document.formatVersion,
                body: command.document.body as Record<string, unknown>,
              },
              currentRevisionId: revisionId,
            };
        }
      })();
      return { revisionId, item: await codec.sealItem(edited) };
    }

    default:
      return {};
  }
}

/**
 * Writes what `prepareProjectionWrite` produced.
 *
 * Takes no codec, and that absence is the guarantee: with no way to seal from
 * in here, nothing in this function can accidentally end the transaction it
 * runs inside. The linter noticing the unused parameter is what made the
 * property explicit rather than incidental.
 */
export async function applyCommandToProjection(
  db: LocalDatabase,
  command: MutationCommand,
  now: () => Date,
  prepared: PreparedProjectionWrite = {},
  mutationId?: Uuid,
): Promise<Uuid[]> {
  switch (command.type) {
    case "database_view.create": {
      if ((await db.items.get(command.id)) !== undefined) {
        throw new LocalValidationError(
          "database.membership-conflict",
          "Linked view already exists",
        );
      }
      const parentId = command.placement.parentItemId;
      if (parentId !== null) {
        const parent = await db.items.get(parentId);
        if (
          parent === undefined ||
          parent.lifecycle !== "active" ||
          !canContain(parent.kind, "database_view", "hierarchy")
        ) {
          throw new LocalValidationError("item.not-found", "Parent is not an active container");
        }
      }
      if (
        prepared.item === undefined ||
        prepared.database === undefined ||
        prepared.revisionId === undefined
      ) {
        throw new LocalValidationError("database.not-found", "Linked view was not prepared");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.id,
        [],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.add(prepared.item);
      await db.placements.add({
        id: command.placement.id,
        itemId: command.id,
        kind: "hierarchy",
        parentItemId: parentId,
        parentKey: parentKeyOf(parentId),
        positionKey: command.placement.positionKey,
      });
      await db.databases.add(prepared.database);
      return [revisionId];
    }
    case "database.source.create":
    case "database.source.delete": {
      if (
        prepared.database === undefined ||
        prepared.revisionId === undefined ||
        (command.type === "database.source.create" && prepared.databaseSource === undefined)
      ) {
        throw new LocalValidationError("database.not-found", "The source write was not prepared");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.ownerItemId,
        [command.baseRevisionId],
        now,
        prepared.revisionId,
        mutationId,
      );
      if (prepared.item !== undefined) await db.items.put(prepared.item);
      await db.databases.put(prepared.database);
      if (command.type === "database.source.create" && prepared.databaseSource !== undefined) {
        if ((await db.databaseSources.get(command.sourceId)) !== undefined)
          throw new LocalValidationError("mutation.duplicate", "Source identity already exists");
        await db.databaseSources.add(prepared.databaseSource);
      } else if (
        command.type === "database.source.delete" &&
        prepared.deletedSourceId !== undefined
      )
        await db.databaseSources.delete(prepared.deletedSourceId);
      return [revisionId];
    }
    case "database.create": {
      if (
        (await db.items.get(command.id)) !== undefined ||
        (await db.databases.get(command.id)) !== undefined
      ) {
        throw new LocalValidationError("database.membership-conflict", "Database already exists");
      }
      const parentItemId = command.hostPageId ?? command.placement.parentItemId;
      if (parentItemId !== null) {
        const parent = await db.items.get(parentItemId);
        if (
          parent === undefined ||
          parent.lifecycle !== "active" ||
          !canContain(parent.kind, "database", "hierarchy")
        ) {
          throw new LocalValidationError("item.not-found", "Parent is not an active container");
        }
      }
      if (
        prepared.item === undefined ||
        prepared.database === undefined ||
        prepared.revisionId === undefined
      ) {
        throw new LocalValidationError("database.not-found", "The database write was not prepared");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.id,
        [],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.add(prepared.item);
      await db.placements.add({
        id: command.placement.id,
        itemId: command.id,
        kind: "hierarchy",
        parentItemId,
        parentKey: parentKeyOf(parentItemId),
        positionKey: command.placement.positionKey,
      });
      await db.databases.add(prepared.database);
      if (prepared.database.sourceId !== undefined) await db.databaseSources.put(prepared.database);
      return [revisionId];
    }

    case "database.definition.replace":
    case "database.definition.resolve-conflict": {
      const item = await db.items.get(command.databaseId);
      const source = await db.databases.get(command.databaseId);
      const targeted =
        command.type === "database.definition.replace" && command.sourceId !== undefined
          ? ((await db.databaseSources.get(command.sourceId)) ?? source)
          : source;
      if (targeted === undefined) {
        throw new LocalValidationError("database.not-found", "Database is not available locally");
      }
      if (
        (prepared.database === undefined && prepared.databaseSource === undefined) ||
        prepared.revisionId === undefined
      ) {
        throw new LocalValidationError("database.not-found", "The database write was not prepared");
      }
      const sourceRevisionId = targeted.definitionRevisionId ?? item?.currentRevisionId;
      if (sourceRevisionId === undefined)
        throw new LocalValidationError("database.not-found", "Database revision is unavailable");
      const revisionId = await writeLocalRevision(
        db,
        command.databaseId,
        command.type === "database.definition.resolve-conflict"
          ? [...command.resolvedRevisionIds]
          : [sourceRevisionId],
        now,
        prepared.revisionId,
        mutationId,
      );
      if (prepared.item !== undefined) await db.items.put(prepared.item);
      if (prepared.databaseSource !== undefined) {
        await db.databaseSources.put(prepared.databaseSource);
      } else if (prepared.database !== undefined) {
        await db.databases.put(prepared.database);
        if (prepared.database.sourceId !== undefined)
          await db.databaseSources.put(prepared.database);
      }
      return [revisionId];
    }

    case "database.presentation.replace": {
      const item = await db.items.get(command.containerItemId);
      const database = await db.databases.get(command.containerItemId);
      if (
        item === undefined ||
        database === undefined ||
        prepared.item === undefined ||
        prepared.database === undefined ||
        prepared.revisionId === undefined
      ) {
        throw new LocalValidationError(
          "database.not-found",
          "Database presentation is unavailable locally",
        );
      }
      const revisionId = await writeLocalRevision(
        db,
        command.containerItemId,
        [item.currentRevisionId],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.put(prepared.item);
      await db.databases.put(prepared.database);
      return [revisionId];
    }

    case "database.entry.create": {
      if ((await db.databases.get(command.databaseId)) === undefined) {
        throw new LocalValidationError("database.not-found", "Database is not available locally");
      }
      if (
        (await db.items.get(command.id)) !== undefined ||
        (await db.databaseEntryPairs.get(databaseEntryPairKey(command.databaseId, command.id))) !==
          undefined
      ) {
        throw new LocalValidationError(
          "database.membership-conflict",
          "Page already has a database membership",
        );
      }
      const owner = await db.items.get(command.databaseId);
      if (owner === undefined || owner.kind !== "database" || owner.lifecycle !== "active") {
        throw new LocalValidationError("database.source-unavailable", "Source owner is not active");
      }
      if (
        command.placement !== undefined &&
        command.placement.parentItemId !== command.databaseId
      ) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Entries must be direct children of their source owner",
        );
      }
      if (
        prepared.item === undefined ||
        prepared.databaseEntry === undefined ||
        prepared.revisionId === undefined ||
        prepared.relationTargets === undefined
      ) {
        throw new LocalValidationError(
          "database.entry-not-found",
          "The entry write was not prepared",
        );
      }
      const revisionId = await writeLocalRevision(
        db,
        command.id,
        [],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.add(prepared.item);
      await db.placements.add({
        id: command.placement?.id ?? databaseEntryPlacementId(command.id),
        itemId: command.id,
        kind: "hierarchy",
        parentItemId: command.databaseId,
        parentKey: parentKeyOf(command.databaseId),
        positionKey: command.placement?.positionKey ?? `a${command.id.replaceAll("-", "")}`,
      });
      await db.databaseEntryPairs.add(prepared.databaseEntry);
      await reconcileLocalDatabaseRelationships(db, {
        databaseId: command.databaseId,
        entryId: command.id,
        relationTargets: prepared.relationTargets,
      });
      return [revisionId];
    }

    case "database.entry.values.replace":
    case "database.entry.values.resolve-conflict": {
      const item = await db.items.get(command.entryId);
      if (
        item === undefined ||
        !(await db.placements.where("itemId").equals(command.entryId).toArray()).some(
          (placement) =>
            placement.kind === "hierarchy" && placement.parentItemId === command.databaseId,
        )
      ) {
        throw new LocalValidationError(
          "database.entry-not-found",
          "Database entry is not available locally",
        );
      }
      if (
        prepared.item === undefined ||
        prepared.databaseEntry === undefined ||
        prepared.revisionId === undefined ||
        prepared.relationTargets === undefined
      ) {
        throw new LocalValidationError(
          "database.entry-not-found",
          "The entry write was not prepared",
        );
      }
      const revisionId = await writeLocalRevision(
        db,
        command.entryId,
        command.type === "database.entry.values.resolve-conflict"
          ? [...command.resolvedRevisionIds]
          : [item.currentRevisionId],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.put(prepared.item);
      await db.databaseEntryPairs.put(prepared.databaseEntry);
      await reconcileLocalDatabaseRelationships(db, {
        databaseId: command.databaseId,
        entryId: command.entryId,
        relationTargets: prepared.relationTargets,
      });
      return [revisionId];
    }

    case "item.create": {
      const view = await loadView(db);
      if (command.placement.parentItemId !== null) {
        const parent = view.getItem(command.placement.parentItemId);
        if (parent === null || parent.lifecycle !== "active" || parent.kind === "file") {
          throw new LocalValidationError("item.not-found", "Parent is not an active container");
        }
      }
      if (prepared.item === undefined || prepared.revisionId === undefined) {
        throw new LocalValidationError("item.not-found", "The write was not prepared");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.id,
        [],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.add(prepared.item);
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

    case "item.convert":
    case "item.favourite":
    case "item.offline":
    case "item.rename":
    case "item.icon": {
      const item = await db.items.get(command.itemId);
      if (item === undefined) {
        throw new LocalValidationError("item.not-found", "Item is not available locally");
      }
      if (prepared.item === undefined || prepared.revisionId === undefined) {
        throw new LocalValidationError("item.not-found", "The write was not prepared");
      }
      const revisionId = await writeLocalRevision(
        db,
        command.itemId,
        [item.currentRevisionId],
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.put(prepared.item);
      if (
        command.type === "item.convert" &&
        item.kind === "page" &&
        command.targetKind === "folder"
      ) {
        const outgoing = await db.relationships
          .where("sourceItemId")
          .equals(command.itemId)
          .toArray();
        await db.relationships.bulkDelete(
          outgoing
            .filter((relationship) => relationship.relationType === "page:link")
            .map((relationship) => relationship.id),
        );
        // The operational journal is a second local representation of the
        // page body. Once the owner confirms that this page becomes a folder,
        // retaining that journal would both keep destroyed content on disk
        // and let a stale reconciler continue submitting page operations to a
        // server that has retired the page authority. Keep the optimistic
        // projection, its outbox command and every operational store in the
        // same IndexedDB transaction so a crash observes either the page and
        // its complete journal, or the folder and no hidden page authority.
        await db.pageOperationUpdates.where("pageId").equals(command.itemId).delete();
        await db.pageAmbiguities.where("pageId").equals(command.itemId).delete();
        await db.pageOperationStates.delete(command.itemId);
        await db.legacyOfflineBranches.delete(command.itemId);
      }
      return [revisionId];
    }

    case "page.document.replace":
    case "document.resolve-conflict": {
      const item = await db.items.get(command.itemId);
      if (item === undefined || item.kind !== "page")
        throw new LocalValidationError("item.not-found", "Page is not available locally");
      if (prepared.item === undefined || prepared.revisionId === undefined)
        throw new LocalValidationError("item.not-found", "The write was not prepared");
      const parents =
        command.type === "document.resolve-conflict"
          ? [...command.resolvedRevisionIds]
          : [item.currentRevisionId];
      const revisionId = await writeLocalRevision(
        db,
        command.itemId,
        parents,
        now,
        prepared.revisionId,
        mutationId,
      );
      await db.items.put(prepared.item);
      await reconcileLocalPageLinks(db, command.itemId, command.pageLinkTargetIds ?? []);
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
        undefined,
        mutationId,
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
          if (view.getItem(child.itemId)?.lifecycle === "active") queue.push(child.itemId);
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
        const revisionId = await writeLocalRevision(
          db,
          itemId,
          [item.currentRevisionId],
          now,
          undefined,
          mutationId,
        );
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
      // The current trash revision carries the durable mutation identity, so
      // the restore group cannot collide with a separate action in the same
      // millisecond. Timestamp fallback keeps older local projections
      // recoverable after this invariant is introduced.
      const rootHeader = await db.revisionHeaders.get(item.currentRevisionId);
      const candidates = await db.items.where("lifecycle").equals("trashed").toArray();
      const candidateHeaders = await db.revisionHeaders.bulkGet(
        candidates.map(({ currentRevisionId }) => currentRevisionId),
      );
      const branch = candidates.filter((candidate, index) => {
        const header = candidateHeaders[index];
        return rootHeader === undefined
          ? candidate.trashedAt === item.trashedAt
          : header?.mutationId === rootHeader.mutationId;
      });
      const revisionIds: Uuid[] = [];
      for (const member of branch) {
        const revisionId = await writeLocalRevision(
          db,
          member.id,
          [member.currentRevisionId],
          now,
          undefined,
          mutationId,
        );
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
      if (command.relationType === INTERNAL_PAGE_LINK_RELATION_TYPE) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Internal page links must be managed through the page document",
        );
      }
      const revisionId = await writeLocalRevision(
        db,
        command.sourceItemId,
        [],
        now,
        undefined,
        mutationId,
      );
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
      if (relationship.relationType === INTERNAL_PAGE_LINK_RELATION_TYPE) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Internal page links must be removed by editing the page document",
        );
      }
      const revisionId = await writeLocalRevision(
        db,
        relationship.sourceItemId,
        [],
        now,
        undefined,
        mutationId,
      );
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
