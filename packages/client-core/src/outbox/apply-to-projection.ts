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
  createInitialDatabaseDefinition,
  type DatabaseDefinition,
  type DatabaseMutationCommand,
  type EntryValues,
  generateUuidV7,
  type HierarchyView,
  INTERNAL_PAGE_LINK_RELATION_TYPE,
  type MutationCommand,
  normalizePropertyValue,
  normalizeRelationTargets,
  type Placement,
  previewDefinitionImpact,
  type RelationTargets,
  TRASH_RETENTION_MS,
  type Uuid,
  validateDatabaseDefinition,
  validatePageLinkTargetSet,
  wouldCreateCycle,
} from "@myownnotion/domain";
import {
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

/**
 * Whether a stored body holds anything an owner would miss.
 *
 * Mirrors the server rule deliberately: every page has a document from the
 * moment it is created, so "a document exists" is true of a page never typed
 * in, and warning about that teaches an owner to dismiss the warning that
 * matters.
 */
function holdsEditorialContent(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  const blocks = record["blocks"];
  return Array.isArray(blocks) ? blocks.length > 0 : Object.keys(record).length > 0;
}

async function writeLocalRevision(
  db: LocalDatabase,
  itemId: Uuid,
  parentRevisionIds: Uuid[],
  now: () => Date,
  // Supplied when the sealed row already carries it. Generating a second one
  // here would leave the row pointing at a revision that does not exist.
  revisionId?: Uuid,
): Promise<Uuid> {
  const id = revisionId ?? generateUuidV7();
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
    { type: "database.entry.create" | "database.entry.values.replace" }
  >,
): Promise<{ readonly values: EntryValues; readonly relationTargets: RelationTargets }> {
  const properties = new Map(definition.properties.map((property) => [property.id, property]));
  const values: Record<string, EntryValues["values"][Uuid]> = {};
  for (const [propertyId, rawValue] of Object.entries(command.values)) {
    const property = properties.get(propertyId as Uuid);
    if (property === undefined || property.type === "title" || property.type === "relation") {
      throw new LocalValidationError(
        "validation.invalid-payload",
        "Structured value property is unavailable",
      );
    }
    const normalized = normalizePropertyValue(property, rawValue);
    if (!normalized.ok || normalized.value === undefined) {
      throw new LocalValidationError(
        "validation.invalid-payload",
        normalized.ok ? "Structured value is absent" : normalized.error.title,
      );
    }
    values[propertyId] = normalized.value;
  }
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
  readonly databaseEntry?: SealedLocalDatabaseEntryRow;
  readonly relationTargets?: RelationTargets;
}

export async function prepareProjectionWrite(
  db: LocalDatabase,
  command: MutationCommand,
  codec: LocalRecordCodec,
): Promise<PreparedProjectionWrite> {
  switch (command.type) {
    case "database.create": {
      const revisionId = generateUuidV7();
      const definition = createInitialDatabaseDefinition(command);
      const validated = validateDatabaseDefinition(definition);
      if (!validated.ok) {
        throw new LocalValidationError("validation.invalid-payload", validated.error.title);
      }
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: "page",
          name: command.name,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: {},
          },
          file: null,
        }),
        database: await codec.sealDatabase({
          itemId: command.id,
          definitionVersion: 1,
          definition: validated.value,
        }),
      };
    }

    case "database.definition.replace": {
      const [storedDatabase, storedItem] = await Promise.all([
        db.databases.get(command.databaseId),
        db.items.get(command.databaseId),
      ]);
      if (storedDatabase === undefined || storedItem === undefined) return {};
      const [database, item] = await Promise.all([
        codec.openDatabase(storedDatabase),
        codec.openItem(storedItem),
      ]);
      if (item.currentRevisionId !== command.baseRevisionId) {
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
      const entryRows = await db.databaseEntries
        .where("databaseId")
        .equals(command.databaseId)
        .toArray();
      const entryValues: EntryValues[] = [];
      for (const row of entryRows) {
        entryValues.push((await codec.openDatabaseEntry(row)).values);
      }
      const impact = await previewDefinitionImpact({
        baseRevisionId: command.baseRevisionId,
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
      return {
        revisionId,
        item: await codec.sealItem({ ...item, currentRevisionId: revisionId }),
        database: await codec.sealDatabase({
          itemId: command.databaseId,
          definitionVersion: database.definitionVersion + 1,
          definition: candidate.value,
        }),
      };
    }

    case "database.entry.create": {
      const storedDatabase = await db.databases.get(command.databaseId);
      if (storedDatabase === undefined) return {};
      const database = await codec.openDatabase(storedDatabase);
      const structured = await normalizeStructuredCommandValues(db, database.definition, command);
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({
          id: command.id,
          kind: "page",
          name: command.title,
          lifecycle: "active",
          currentRevisionId: revisionId,
          trashedAt: null,
          purgeAfter: null,
          favourite: false,
          offlineIntent: false,
          localAvailability: "present",
          pageDocument: command.document ?? {
            format: "myownnotion.document+json",
            formatVersion: 1,
            body: {},
          },
          file: null,
        }),
        databaseEntry: await codec.sealDatabaseEntry({
          entryItemId: command.id,
          databaseId: command.databaseId,
          valueVersion: 1,
          availability: "present",
          values: structured.values,
        }),
        relationTargets: structured.relationTargets,
      };
    }

    case "database.entry.values.replace": {
      const [storedDatabase, storedEntry, storedItem] = await Promise.all([
        db.databases.get(command.databaseId),
        db.databaseEntries.get(command.entryId),
        db.items.get(command.entryId),
      ]);
      if (storedDatabase === undefined) {
        throw new LocalValidationError("database.not-found", "Database is not available locally");
      }
      if (storedEntry === undefined || storedItem === undefined) return {};
      const [database, entry, item] = await Promise.all([
        codec.openDatabase(storedDatabase),
        codec.openDatabaseEntry(storedEntry),
        codec.openItem(storedItem),
      ]);
      if (entry.databaseId !== command.databaseId) {
        throw new LocalValidationError(
          "database.entry-not-found",
          "Database entry is not available locally",
        );
      }
      if (item.currentRevisionId !== command.baseRevisionId) {
        throw new LocalValidationError(
          "revision.stale-base",
          "Database entry changed since values were prepared",
        );
      }
      const structured = await normalizeStructuredCommandValues(db, database.definition, command);
      const revisionId = generateUuidV7();
      return {
        revisionId,
        item: await codec.sealItem({ ...item, currentRevisionId: revisionId }),
        databaseEntry: await codec.sealDatabaseEntry({
          ...entry,
          valueVersion: entry.valueVersion + 1,
          values: { ...structured.values, preserved: entry.values.preserved },
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
      if (
        command.type === "item.convert" &&
        command.targetKind === "folder" &&
        ((await db.databases.get(command.itemId)) !== undefined ||
          (await db.databaseEntries.get(command.itemId)) !== undefined)
      ) {
        throw new LocalValidationError(
          "database.page-required",
          "A database host or entry must remain a page",
        );
      }
      // Reopened, edited, resealed. A partial update is not available: the
      // envelope binds the whole row's identity, so a new title cannot be
      // written without re-deriving the record it belongs to.
      if (
        command.type === "item.convert" &&
        command.targetKind === "folder" &&
        !command.confirmedDestruction &&
        holdsEditorialContent(opened.pageDocument?.body)
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
              pageDocument: command.targetKind === "folder" ? null : opened.pageDocument,
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
): Promise<Uuid[]> {
  switch (command.type) {
    case "database.create": {
      if (
        (await db.items.get(command.id)) !== undefined ||
        (await db.databases.get(command.id)) !== undefined
      ) {
        throw new LocalValidationError("database.membership-conflict", "Database already exists");
      }
      if (command.placement.parentItemId !== null) {
        const parent = await db.items.get(command.placement.parentItemId);
        if (parent === undefined || parent.lifecycle !== "active" || parent.kind === "file") {
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
      const revisionId = await writeLocalRevision(db, command.id, [], now, prepared.revisionId);
      await db.items.add(prepared.item);
      await db.placements.add({
        id: command.placement.id,
        itemId: command.id,
        kind: "hierarchy",
        parentItemId: command.placement.parentItemId,
        parentKey: parentKeyOf(command.placement.parentItemId),
        positionKey: command.placement.positionKey,
      });
      await db.databases.add(prepared.database);
      return [revisionId];
    }

    case "database.definition.replace": {
      const item = await db.items.get(command.databaseId);
      if (item === undefined || (await db.databases.get(command.databaseId)) === undefined) {
        throw new LocalValidationError("database.not-found", "Database is not available locally");
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
        command.databaseId,
        [item.currentRevisionId],
        now,
        prepared.revisionId,
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
        (await db.databaseEntries.get(command.id)) !== undefined
      ) {
        throw new LocalValidationError(
          "database.membership-conflict",
          "Page already has a database membership",
        );
      }
      if (command.placement.parentItemId !== null) {
        const parent = await db.items.get(command.placement.parentItemId);
        if (parent === undefined || parent.lifecycle !== "active" || parent.kind === "file") {
          throw new LocalValidationError("item.not-found", "Parent is not an active container");
        }
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
      const revisionId = await writeLocalRevision(db, command.id, [], now, prepared.revisionId);
      await db.items.add(prepared.item);
      await db.placements.add({
        id: command.placement.id,
        itemId: command.id,
        kind: "hierarchy",
        parentItemId: command.placement.parentItemId,
        parentKey: parentKeyOf(command.placement.parentItemId),
        positionKey: command.placement.positionKey,
      });
      await db.databaseEntries.add(prepared.databaseEntry);
      await reconcileLocalDatabaseRelationships(db, {
        databaseId: command.databaseId,
        entryId: command.id,
        relationTargets: prepared.relationTargets,
      });
      return [revisionId];
    }

    case "database.entry.values.replace": {
      const item = await db.items.get(command.entryId);
      if (item === undefined || (await db.databaseEntries.get(command.entryId)) === undefined) {
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
        [item.currentRevisionId],
        now,
        prepared.revisionId,
      );
      await db.items.put(prepared.item);
      await db.databaseEntries.put(prepared.databaseEntry);
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
      const revisionId = await writeLocalRevision(db, command.id, [], now, prepared.revisionId);
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
    case "item.rename": {
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
      }
      return [revisionId];
    }

    case "page.document.replace": {
      const item = await db.items.get(command.itemId);
      if (item === undefined || item.kind !== "page") {
        throw new LocalValidationError("item.not-found", "Page is not available locally");
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
      );
      await db.items.put(prepared.item);
      await reconcileLocalPageLinks(db, command.itemId, command.pageLinkTargetIds ?? []);
      return [revisionId];
    }

    case "document.resolve-conflict": {
      const item = await db.items.get(command.itemId);
      if (item === undefined || item.kind !== "page") {
        throw new LocalValidationError("item.not-found", "Page is not available locally");
      }
      if (prepared.item === undefined || prepared.revisionId === undefined) {
        throw new LocalValidationError("item.not-found", "The write was not prepared");
      }
      // Both parents locally too, so the projection tells the same story about
      // this revision as the server will. A local revision with one parent would
      // make the device's own history disagree with the workspace's about the
      // one entry an owner is most likely to go looking for.
      const revisionId = await writeLocalRevision(
        db,
        command.itemId,
        [...command.resolvedRevisionIds],
        now,
        prepared.revisionId,
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
      if (command.relationType === INTERNAL_PAGE_LINK_RELATION_TYPE) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Internal page links must be managed through the page document",
        );
      }
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
      if (relationship.relationType === INTERNAL_PAGE_LINK_RELATION_TYPE) {
        throw new LocalValidationError(
          "validation.invalid-payload",
          "Internal page links must be removed by editing the page document",
        );
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
