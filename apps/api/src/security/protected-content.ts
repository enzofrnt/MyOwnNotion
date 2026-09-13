/**
 * Protecting feature-001 payloads (T057, feature 002).
 *
 * The bridge between the encryption machinery and the content the application
 * actually stores. It names the payload-bearing fields, one entity type each,
 * and seals them into authenticated envelopes. Secured mutation, page-state
 * and restore boundaries resolve these values before constructing snapshots,
 * then neutralize readable canonical copies in the same transaction (025).
 *
 * Historical columns remain a compatibility fallback until the verified storage
 * transition processes them. A neutralized field without its protected envelope
 * is unavailable; callers must never return the marker as owner content.
 */

import type { Database, Transaction } from "@myownnotion/database";
import {
  type DatabaseDefinition,
  type EntryValues,
  type ProtectedFileIdentity,
  type ProtectedFileManifest,
  readProtectedFileManifest,
} from "@myownnotion/domain";
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
  databaseDefinition: "database.definition",
  databaseEntryValues: "database.entry-values",
  exportManifest: "export.manifest",
  fileMetadata: "file.metadata",
  fileContentManifest: "file.content-manifest",
  uploadMetadata: "file.upload-metadata",
  uploadState: "file.upload-state",
} as const;

export interface ProtectedContentDeps {
  readonly records: ProtectedRecordService;
}

export interface ItemPresentation {
  readonly name: string;
  readonly icon: string | null;
}

export interface FileMetadata {
  readonly originalName: string;
  readonly mediaType: string;
}

function readFileMetadata(value: unknown): FileMetadata {
  if (
    value === null ||
    typeof value !== "object" ||
    !("originalName" in value) ||
    typeof value.originalName !== "string" ||
    !("mediaType" in value) ||
    typeof value.mediaType !== "string"
  )
    throw new Error("Invalid protected file metadata.");
  return { originalName: value.originalName, mediaType: value.mediaType };
}

function normalizeItemPresentation(value: string | ItemPresentation): ItemPresentation {
  return typeof value === "string" ? { name: value, icon: null } : value;
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

  async writeFileMetadata(
    executor: Database | Transaction,
    input: { kind: "file" | "upload"; id: string; recordVersion: number; metadata: FileMetadata },
  ): Promise<void> {
    await this.#write(
      executor,
      input.kind === "file"
        ? PROTECTED_ENTITY_TYPES.fileMetadata
        : PROTECTED_ENTITY_TYPES.uploadMetadata,
      input.id,
      input.recordVersion,
      readFileMetadata(input.metadata),
    );
  }

  async readFileMetadata(
    executor: Database | Transaction,
    input: { kind: "file" | "upload"; id: string; recordVersion?: number },
  ): Promise<FileMetadata | null> {
    const value = await this.#read<unknown>(
      executor,
      input.kind === "file"
        ? PROTECTED_ENTITY_TYPES.fileMetadata
        : PROTECTED_ENTITY_TYPES.uploadMetadata,
      input.id,
      input.recordVersion,
    );
    return value === null ? null : readFileMetadata(value);
  }

  async writeFileManifest(
    executor: Database | Transaction,
    manifest: ProtectedFileManifest,
  ): Promise<void> {
    const checked = readProtectedFileManifest(manifest, manifest);
    await this.#write(
      executor,
      checked.kind === "content"
        ? PROTECTED_ENTITY_TYPES.fileContentManifest
        : PROTECTED_ENTITY_TYPES.uploadState,
      checked.id,
      checked.recordVersion,
      checked,
    );
  }

  async readFileManifest(
    executor: Database | Transaction,
    expected: ProtectedFileIdentity,
  ): Promise<ProtectedFileManifest | null> {
    const value = await this.#read<unknown>(
      executor,
      expected.kind === "content"
        ? PROTECTED_ENTITY_TYPES.fileContentManifest
        : PROTECTED_ENTITY_TYPES.uploadState,
      expected.id,
      expected.recordVersion,
    );
    return value === null ? null : readProtectedFileManifest(value, expected);
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

  async #readMany<T>(
    executor: Database | Transaction,
    entityType: string,
    entityIds: readonly string[],
    recordVersions?: ReadonlyMap<string, number>,
  ): Promise<ReadonlyMap<string, T>> {
    if (entityIds.length === 0) {
      return new Map();
    }
    const opened = await this.#deps.records.readMany(executor, {
      entityType,
      entityIds,
      ...(recordVersions === undefined ? {} : { recordVersions }),
    });
    return new Map(
      [...opened].map(([entityId, value]) => [
        entityId,
        JSON.parse(Buffer.from(value).toString("utf8")) as T,
      ]),
    );
  }

  /** Seals an item's name. The title is the most exposed field in a dump. */
  async writeItemPresentation(
    executor: Database | Transaction,
    input: { itemId: string; recordVersion: number; name: string; icon: string | null },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.itemName,
      input.itemId,
      input.recordVersion,
      { name: input.name, icon: input.icon } satisfies ItemPresentation,
    );
  }

  async writeItemName(
    executor: Database | Transaction,
    input: { itemId: string; recordVersion: number; name: string; icon?: string | null },
  ): Promise<void> {
    const current = await this.readItemPresentation(executor, input.itemId);
    await this.writeItemPresentation(executor, {
      itemId: input.itemId,
      recordVersion: input.recordVersion,
      name: input.name,
      icon: input.icon === undefined ? (current?.icon ?? null) : input.icon,
    });
  }

  async readItemPresentation(
    executor: Database | Transaction,
    itemId: string,
  ): Promise<ItemPresentation | null> {
    const value = await this.#read<string | ItemPresentation>(
      executor,
      PROTECTED_ENTITY_TYPES.itemName,
      itemId,
    );
    return value === null ? null : normalizeItemPresentation(value);
  }

  async readItemName(executor: Database | Transaction, itemId: string): Promise<string | null> {
    return (await this.readItemPresentation(executor, itemId))?.name ?? null;
  }

  async readItemPresentations(
    executor: Database | Transaction,
    itemIds: readonly string[],
  ): Promise<ReadonlyMap<string, ItemPresentation>> {
    const values = await this.#readMany<string | ItemPresentation>(
      executor,
      PROTECTED_ENTITY_TYPES.itemName,
      itemIds,
    );
    return new Map(
      [...values].map(([itemId, value]) => [itemId, normalizeItemPresentation(value)]),
    );
  }

  async readItemNames(
    executor: Database | Transaction,
    itemIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const values = await this.#readMany<string | ItemPresentation>(
      executor,
      PROTECTED_ENTITY_TYPES.itemName,
      itemIds,
    );
    return new Map(
      [...values].map(([itemId, value]) => [itemId, normalizeItemPresentation(value).name]),
    );
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

  async readPageBodies<T>(
    executor: Database | Transaction,
    pageIds: readonly string[],
  ): Promise<ReadonlyMap<string, T>> {
    return await this.#readMany<T>(executor, PROTECTED_ENTITY_TYPES.pageBody, pageIds);
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

  async readRelationshipMetadataMany<T>(
    executor: Database | Transaction,
    relationshipIds: readonly string[],
  ): Promise<ReadonlyMap<string, T>> {
    return await this.#readMany<T>(
      executor,
      PROTECTED_ENTITY_TYPES.relationshipMetadata,
      relationshipIds,
    );
  }

  async readDatabaseEntryValuesMany(
    executor: Database | Transaction,
    entries: readonly { entryId: string; valueVersion: number }[],
  ): Promise<ReadonlyMap<string, EntryValues>> {
    return await this.#readMany<EntryValues>(
      executor,
      PROTECTED_ENTITY_TYPES.databaseEntryValues,
      entries.map((entry) => entry.entryId),
      new Map(entries.map((entry) => [entry.entryId, entry.valueVersion])),
    );
  }

  /** Seals a database schema, its views and task-role mapping. */
  async writeDatabaseDefinition(
    executor: Database | Transaction,
    input: { databaseId: string; definitionVersion: number; definition: DatabaseDefinition },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.databaseDefinition,
      input.databaseId,
      input.definitionVersion,
      input.definition,
    );
  }

  async readDatabaseDefinition(
    executor: Database | Transaction,
    databaseId: string,
    definitionVersion?: number,
  ): Promise<DatabaseDefinition | null> {
    return await this.#read<DatabaseDefinition>(
      executor,
      PROTECTED_ENTITY_TYPES.databaseDefinition,
      databaseId,
      definitionVersion,
    );
  }

  /** Seals one entry's non-relational property values. */
  async writeDatabaseEntryValues(
    executor: Database | Transaction,
    input: { entryId: string; valueVersion: number; values: EntryValues },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.databaseEntryValues,
      input.entryId,
      input.valueVersion,
      input.values,
    );
  }

  async readDatabaseEntryValues(
    executor: Database | Transaction,
    entryId: string,
    valueVersion?: number,
  ): Promise<EntryValues | null> {
    return await this.#read<EntryValues>(
      executor,
      PROTECTED_ENTITY_TYPES.databaseEntryValues,
      entryId,
      valueVersion,
    );
  }

  /**
   * Seals the owner-authorized export while it waits to be downloaded.
   *
   * The artifact is intentionally plaintext at the authenticated response
   * boundary, but leaving that same manifest in the exports table would make
   * every title, property, view and value readable in a PostgreSQL dump.
   */
  async writeExportManifest(
    executor: Database | Transaction,
    input: { exportId: string; manifest: unknown },
  ): Promise<void> {
    await this.#write(
      executor,
      PROTECTED_ENTITY_TYPES.exportManifest,
      input.exportId,
      1,
      input.manifest,
    );
  }

  async readExportManifest<T>(
    executor: Database | Transaction,
    exportId: string,
  ): Promise<T | null> {
    return await this.#read<T>(executor, PROTECTED_ENTITY_TYPES.exportManifest, exportId, 1);
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
