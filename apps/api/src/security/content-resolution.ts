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
  type DatabaseRecord,
  type ItemReadModel,
  listDatabasePropertyRelationships,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  SCRUBBED_PLACEHOLDER,
  type Transaction,
} from "@myownnotion/database";
import type { DatabaseDefinition, EntryValues, RelationTargets, Uuid } from "@myownnotion/domain";
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
export async function resolveProtectedContent(
  executor: Database | Transaction,
  models: readonly ItemReadModel[],
  content: ProtectedContent | undefined,
): Promise<ItemReadModel[]> {
  if (content === undefined) {
    // No key hierarchy configured. An installation in that state has no
    // envelopes either, so its columns are the only copy and returning them is
    // correct rather than a fallback.
    return [...models];
  }

  const resolved: ItemReadModel[] = [];
  for (const model of models) {
    const sealedName = await content.readItemName(executor, model.id);
    // What is sealed is the document's *body*, not the envelope around it.
    // The format and its version are structural — they say how to parse the
    // body, not what it says — and they stay readable for the same reason the
    // hierarchy does. Assigning the sealed value over the whole document
    // produces a record with no format, which fails serialization rather than
    // returning wrong content, but only because the contract happens to
    // require the field.
    const sealedBody =
      model.pageDocument === null
        ? null
        : await content.readPageBody<Record<string, unknown>>(executor, model.id);

    if (sealedName === null && model.name === SCRUBBED_PLACEHOLDER) {
      // The plaintext was scrubbed and the envelope is gone. Serving the
      // placeholder would present an empty title as content; this is the one
      // case where refusing is the honest answer.
      throw new ProtectedContentUnavailableError(model.id);
    }

    resolved.push({
      ...model,
      name: sealedName ?? model.name,
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
  return definition;
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
