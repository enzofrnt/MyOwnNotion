/**
 * The encrypted-read cutover (T097 completion, US6, FR-011, FR-014, FR-028).
 *
 * Until now the protected envelopes were written and never read back by the
 * routes: an item's title came from the plaintext column, and the sealed copy
 * sat beside it proving nothing. This is the step that makes the encryption
 * load-bearing — after it, a corrupted envelope changes what a route returns,
 * which is the only condition under which "the data is encrypted" means
 * anything to a reader.
 *
 * Three rules, and the order between them is the whole design.
 *
 * **The envelope wins when it exists.** Not "when the migration says it
 * should" — when it is there. A flag can be stale, half-applied, or restored
 * from a backup taken mid-migration; the row either has a sealed copy or it
 * does not.
 *
 * **The plaintext column is a fallback, not an equal.** An installation that
 * has never been migrated still works, and reads its own columns. That is what
 * makes the migration safe to start: nothing breaks before it finishes.
 *
 * **A scrubbed column with no envelope is a refusal.** After the scrub the
 * column holds a placeholder, so falling back to it would serve U+FFFD as a
 * title — a record that looks present and empty rather than one that is
 * missing. Refusing is worse for the request and far better for the owner,
 * who needs to know the difference between "gone" and "unreadable right now".
 */

import {
  type Database,
  type DatabaseEntryRecord,
  type DatabaseProjectionEntryRecord,
  type DatabasePropertyRelationshipRecord,
  type DatabaseRecord,
  type ItemReadModel,
  listDatabasePropertyRelationships,
  type RelationshipListing,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  SCRUBBED_PLACEHOLDER,
  type Transaction,
} from "@myownnotion/database";
import type { DatabaseDefinition, EntryValues, RelationTargets, Uuid } from "@myownnotion/domain";
import { isProtectedPayload } from "./canonical-payloads.ts";
import type { ProtectedContent } from "./protected-content.ts";

export class ProtectedContentUnavailableError extends Error {
  constructor(readonly itemId: string) {
    // No detail about why. The caller maps this to `protected_read_failed`,
    // and naming the failed check is a decryption oracle.
    super("protected content is unavailable");
    this.name = "ProtectedContentUnavailableError";
  }
}

/**
 * Replaces payload fields with their sealed versions where those exist.
 *
 * Takes the models the reader produced rather than reading again: the
 * placements, the lifecycle, and the revision lineage are already correct and
 * are not protected. Only the payloads change.
 */
export function purgedItemTombstone(model: ItemReadModel): ItemReadModel {
  return {
    ...model,
    name: "Élément supprimé",
    icon: null,
    pageDocument: null,
    file: null,
    favourite: false,
    offlineIntent: false,
    placements: [],
  };
}

export async function resolveProtectedContent(
  executor: Database | Transaction,
  models: readonly ItemReadModel[],
  content: ProtectedContent | undefined,
  options: {
    readonly allowLegacyPlaintextPlaceholder?: boolean;
    readonly allowLegacyPlaintextPayload?: boolean;
  } = {},
): Promise<ItemReadModel[]> {
  if (content === undefined) {
    // No key hierarchy configured. An installation in that state has no
    // envelopes either, so its columns are the only copy and returning them is
    // correct rather than a fallback.
    return models.map((model) =>
      model.lifecycle === "purged" ? purgedItemTombstone(model) : model,
    );
  }

  const live = models.filter((model) => model.lifecycle !== "purged");
  // Keep transaction queries sequential while sharing one key lookup per batch.
  const presentations = await content.readItemPresentations(
    executor,
    live.map((model) => model.id),
  );
  const bodies = await content.readPageBodies<Record<string, unknown>>(
    executor,
    live.filter((model) => model.pageDocument !== null).map((model) => model.id),
  );
  const resolved: ItemReadModel[] = [];
  for (const model of models) {
    if (model.lifecycle === "purged") {
      resolved.push(purgedItemTombstone(model));
      continue;
    }
    const sealedPresentation = presentations.get(model.id) ?? null;
    // What is sealed is the document's *body*, not the envelope around it.
    // The format and its version are structural — they say how to parse the
    // body, not what it says — and they stay readable for the same reason the
    // hierarchy does. Assigning the sealed value over the whole document
    // produces a record with no format, which fails serialization rather than
    // returning wrong content, but only because the contract happens to
    // require the field.
    const sealedBody = model.pageDocument === null ? null : (bodies.get(model.id) ?? null);

    if (
      sealedPresentation === null &&
      model.name === SCRUBBED_PLACEHOLDER &&
      options.allowLegacyPlaintextPlaceholder !== true
    ) {
      // The plaintext was scrubbed and the envelope is gone. Serving the
      // placeholder would present an empty title as content; this is the one
      // case where refusing is the honest answer.
      throw new ProtectedContentUnavailableError(model.id);
    }
    if (
      sealedBody === null &&
      isProtectedPayload(model.pageDocument?.body) &&
      options.allowLegacyPlaintextPayload !== true
    ) {
      throw new ProtectedContentUnavailableError(model.id);
    }
    const fileMetadata =
      model.file === null
        ? null
        : await content.readFileMetadata(executor, { kind: "file", id: model.id });
    if (
      model.file?.originalName === SCRUBBED_PLACEHOLDER &&
      fileMetadata === null &&
      options.allowLegacyPlaintextPlaceholder !== true
    )
      throw new ProtectedContentUnavailableError(model.id);

    resolved.push({
      ...model,
      name: sealedPresentation?.name ?? model.name,
      icon: sealedPresentation === null ? model.icon : sealedPresentation.icon,
      file:
        model.file === null || fileMetadata === null
          ? model.file
          : { ...model.file, ...fileMetadata },
      pageDocument:
        model.pageDocument === null || sealedBody === null
          ? model.pageDocument
          : { ...model.pageDocument, body: sealedBody },
    });
  }
  return resolved;
}

export async function resolveDatabaseDefinition(
  executor: Database | Transaction,
  record: DatabaseRecord,
  content: ProtectedContent | undefined,
): Promise<DatabaseDefinition> {
  const sealed = await content?.readDatabaseDefinition(
    executor,
    record.databaseId,
    record.definitionVersion,
  );
  const fallback = await readCurrentDatabaseDefinition(executor, record.databaseId);
  const definition = sealed ?? fallback;
  if (definition === null) throw new ProtectedContentUnavailableError(record.databaseId);
  if (definition.name !== undefined) return definition;
  const revision =
    record.definitionRevisionId === null
      ? null
      : await content?.readRevisionSnapshot<Record<string, unknown>>(
          executor,
          record.definitionRevisionId,
        );
  const name = revision?.["name"];
  return typeof name === "string" && name.trim() !== "" ? { ...definition, name } : definition;
}

export async function resolveDatabaseEntryValues(
  executor: Database | Transaction,
  record: DatabaseEntryRecord,
  content: ProtectedContent | undefined,
): Promise<EntryValues> {
  const sealed = await content?.readDatabaseEntryValues(
    executor,
    record.entryId,
    record.valueVersion,
  );
  const fallback = await readCurrentDatabaseEntryValues(executor, record.entryId);
  const values = sealed ?? fallback;
  if (values === null) throw new ProtectedContentUnavailableError(record.entryId);
  return values;
}

export async function resolveDatabaseRelationTargets(
  executor: Database | Transaction,
  input: {
    readonly databaseId: Uuid;
    readonly entryId: Uuid;
    readonly content: ProtectedContent | undefined;
  },
): Promise<RelationTargets> {
  const relationships = await listDatabasePropertyRelationships(executor, input.entryId);
  const targets = new Map<Uuid, Uuid[]>();
  for (const relationship of relationships) {
    const sealed = await input.content?.readRelationshipMetadata<Record<string, unknown>>(
      executor,
      relationship.id,
    );
    const metadata = sealed ?? relationship.metadata;
    if (metadata["databaseId"] !== input.databaseId || typeof metadata["propertyId"] !== "string") {
      continue;
    }
    const propertyId = metadata["propertyId"] as Uuid;
    const propertyTargets = targets.get(propertyId) ?? [];
    propertyTargets.push(relationship.targetItemId);
    targets.set(propertyId, propertyTargets);
  }
  return Object.fromEntries(
    [...targets].map(([propertyId, propertyTargets]) => [propertyId, propertyTargets.sort()]),
  ) as RelationTargets;
}

/** Opens protected relationship metadata while preserving structural fields. */
export async function resolveProtectedRelationships(
  executor: Database | Transaction,
  relationships: readonly RelationshipListing[],
  content: ProtectedContent | undefined,
): Promise<RelationshipListing[]> {
  if (content === undefined) return [...relationships];
  const metadataById = await content.readRelationshipMetadataMany<Record<string, unknown>>(
    executor,
    relationships.map((relationship) => relationship.id),
  );
  const resolved: RelationshipListing[] = [];
  for (const relationship of relationships) {
    const metadata = metadataById.get(relationship.id) ?? null;
    if (metadata === null && isProtectedPayload(relationship.metadata))
      throw new ProtectedContentUnavailableError(relationship.id);
    resolved.push({ ...relationship, metadata: metadata ?? relationship.metadata });
  }
  return resolved;
}

/** Opens only fields used by database views, with exact canonical value versions. */
export async function resolveDatabaseProjectionEntries(
  executor: Database | Transaction,
  databaseId: Uuid,
  records: readonly DatabaseProjectionEntryRecord[],
  relationships: readonly (DatabasePropertyRelationshipRecord & { readonly sourceItemId: Uuid })[],
  content: ProtectedContent | undefined,
) {
  const [names, values, metadata] = await Promise.all([
    content?.readItemNames(
      executor,
      records.map((record) => record.entryId),
    ) ?? new Map<string, string>(),
    content?.readDatabaseEntryValuesMany(executor, records) ?? new Map<string, EntryValues>(),
    content?.readRelationshipMetadataMany<Readonly<Record<string, unknown>>>(
      executor,
      relationships.map((relationship) => relationship.id),
    ) ?? new Map<string, Readonly<Record<string, unknown>>>(),
  ]);
  const targetsByEntry = new Map<Uuid, Map<Uuid, Uuid[]>>();
  for (const relationship of relationships) {
    const value = metadata.get(relationship.id) ?? relationship.metadata;
    if (isProtectedPayload(value)) throw new ProtectedContentUnavailableError(relationship.id);
    if (value["databaseId"] !== databaseId || typeof value["propertyId"] !== "string") continue;
    const propertyId = value["propertyId"] as Uuid;
    const byProperty = targetsByEntry.get(relationship.sourceItemId) ?? new Map<Uuid, Uuid[]>();
    const targets = byProperty.get(propertyId) ?? [];
    targets.push(relationship.targetItemId);
    byProperty.set(propertyId, targets);
    targetsByEntry.set(relationship.sourceItemId, byProperty);
  }
  return records.map((record) => {
    const title = names.get(record.entryId) ?? record.storedName;
    const entryValues = values.get(record.entryId) ?? record.storedValues;
    if (title === SCRUBBED_PLACEHOLDER || entryValues === null || isProtectedPayload(entryValues))
      throw new ProtectedContentUnavailableError(record.entryId);
    return {
      entryId: record.entryId,
      revisionId: record.revisionId,
      title,
      values: entryValues.values,
      relationTargets: Object.fromEntries(
        [...(targetsByEntry.get(record.entryId) ?? [])].map(([propertyId, targets]) => [
          propertyId,
          targets.sort(),
        ]),
      ) as RelationTargets,
    };
  });
}
