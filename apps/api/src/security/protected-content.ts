/**
 * Protecting feature-001 payloads (T057, feature 002).
 *
 * The bridge between the encryption machinery and the content the application
 * actually stores. It names the payload-bearing fields, one entity type each,
 * and provides the dual write the migration story depends on.
 *
 * **Dual write, on purpose.** Every protected payload is written twice for
 * now: once into the feature-001 column as before, and once as an envelope.
 * The plaintext column is scrubbed later, by the migration phase, only after a
 * verified cutover. Encrypting in place instead would mean a single deploy
 * where every existing row becomes unreadable if anything is wrong with the
 * key — and there would be no copy left to recover from. Writing both costs
 * storage and buys the ability to stop.
 *
 * **Reads prefer the envelope.** Once an envelope exists it is the truth,
 * because it is what a rotation and a later scrub will keep. The plaintext
 * column is a fallback for rows written before this landed, and it disappears
 * when the migration scrubs them.
 */

import type { Database, Transaction } from "@myownnotion/database";
import type { ProtectedRecordService } from "./protected-record-service.ts";

/**
 * The entity types this feature seals, one per payload-bearing field.
 *
 * Separate types rather than one per table: the AAD binds the type, so a
 * page's body can never be opened as its title even though both belong to the
 * same entity id.
 */
export const PROTECTED_ENTITY_TYPES = {
  itemName: "item.name",
  pageBody: "page.body",
  revisionSnapshot: "revision.snapshot",
  relationshipMetadata: "relationship.metadata",
} as const;

export interface ProtectedContentDeps {
  readonly records: ProtectedRecordService;
}

/**
 * Seals and opens the feature-001 payloads.
 *
 * Everything here is JSON in and JSON out, because that is what the callers
 * hold. The envelope stores bytes; the encoding is this module's business and
 * nothing above it needs to know.
 */
export class ProtectedContent {
  readonly #deps: ProtectedContentDeps;

  constructor(deps: ProtectedContentDeps) {
    this.#deps = deps;
  }

  async #write(
    executor: Database | Transaction,
    entityType: string,
    entityId: string,
    recordVersion: number,
    value: unknown,
  ): Promise<void> {
    const encoded = new Uint8Array(Buffer.from(JSON.stringify(value), "utf8"));
    await this.#deps.records.write(executor, {
      entityType,
      entityId,
      recordVersion,
      payload: encoded,
    });
  }

  async #read<T>(
    executor: Database | Transaction,
    entityType: string,
    entityId: string,
    recordVersion?: number,
  ): Promise<T | null> {
    const opened = await this.#deps.records.read(executor, {
      entityType,
      entityId,
      ...(recordVersion === undefined ? {} : { recordVersion }),
    });
    if (opened === null) {
      return null;
    }
    return JSON.parse(Buffer.from(opened).toString("utf8")) as T;
  }

  /** Seals an item's name. The title is the most exposed field in a dump. */
  async writeItemName(
    executor: Database | Transaction,
    input: { itemId: string; recordVersion: number; name: string },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.itemName,
      input.itemId,
      input.recordVersion,
      input.name,
    );
  }

  async readItemName(executor: Database | Transaction, itemId: string): Promise<string | null> {
    return await this.#read<string>(executor, PROTECTED_ENTITY_TYPES.itemName, itemId);
  }

  /** Seals a page's document body. */
  async writePageBody(
    executor: Database | Transaction,
    input: { pageId: string; recordVersion: number; body: unknown },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.pageBody,
      input.pageId,
      input.recordVersion,
      input.body,
    );
  }

  async readPageBody<T>(
    executor: Database | Transaction,
    pageId: string,
    recordVersion?: number,
  ): Promise<T | null> {
    return await this.#read<T>(executor, PROTECTED_ENTITY_TYPES.pageBody, pageId, recordVersion);
  }

  /**
   * Seals a relationship's metadata.
   *
   * FR-011 names "sensitive properties and relationships" explicitly. The
   * endpoints and the relation type stay readable — the graph has to be
   * traversable without a key, exactly as the hierarchy is — but the metadata
   * is a free-form note the owner wrote about *why* two items are related,
   * which is often more revealing than either item's title.
   */
  async writeRelationshipMetadata(
    executor: Database | Transaction,
    input: { relationshipId: string; recordVersion: number; metadata: unknown },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.relationshipMetadata,
      input.relationshipId,
      input.recordVersion,
      input.metadata,
    );
  }

  async readRelationshipMetadata<T>(
    executor: Database | Transaction,
    relationshipId: string,
    recordVersion?: number,
  ): Promise<T | null> {
    return await this.#read<T>(
      executor,
      PROTECTED_ENTITY_TYPES.relationshipMetadata,
      relationshipId,
      recordVersion,
    );
  }

  /**
   * Seals a revision snapshot.
   *
   * The snapshot is the whole record as it stood, so it is the field that
   * makes history readable — and the one that would let someone with the
   * database reconstruct everything a scrub of the current rows was meant to
   * remove.
   */
  async writeRevisionSnapshot(
    executor: Database | Transaction,
    input: { revisionId: string; snapshot: unknown },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.revisionSnapshot,
      input.revisionId,
      // A revision is immutable, so its snapshot has exactly one version.
      1,
      input.snapshot,
    );
  }

  async readRevisionSnapshot<T>(
    executor: Database | Transaction,
    revisionId: string,
  ): Promise<T | null> {
    return await this.#read<T>(executor, PROTECTED_ENTITY_TYPES.revisionSnapshot, revisionId);
  }
}
