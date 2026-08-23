import {
  type BlockDocumentV3,
  extractSearchableDocumentText,
  extractSearchableDocumentTextV3,
  extractSearchablePropertyText,
  readDocumentBody,
  type SearchDocument,
  type SearchPathSegment,
  type SearchPropertyText,
  type Uuid,
} from "@myownnotion/domain";
import type { LocalDatabaseRepository } from "../databases/local-database-repository.ts";
import type { LocalRepository, ProjectedItem } from "../local-store/local-repository.ts";
import type { EncryptedPageOperationLog } from "../page-sync/encrypted-update-log.ts";

export type LocalSearchSyncState = "synchronized" | "pending" | "conflict";

export interface LocalSearchEntry {
  readonly document: SearchDocument;
  readonly path: readonly SearchPathSegment[];
  readonly localAvailability: ProjectedItem["localAvailability"];
  readonly syncState: LocalSearchSyncState;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function chosenPlacement(item: ProjectedItem) {
  return [...item.placements].sort((left, right) => {
    const byKind = Number(left.kind !== "hierarchy") - Number(right.kind !== "hierarchy");
    if (byKind !== 0) {
      return byKind;
    }
    const byPosition = compareText(left.positionKey, right.positionKey);
    return byPosition !== 0 ? byPosition : compareText(left.id, right.id);
  })[0];
}

function currentPath(item: ProjectedItem, active: ReadonlyMap<Uuid, ProjectedItem>) {
  const path: SearchPathSegment[] = [];
  const visited = new Set<Uuid>();
  let current: ProjectedItem | undefined = item;
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift({ itemId: current.id, title: current.name });
    const parentItemId: Uuid | null = chosenPlacement(current)?.parentItemId ?? null;
    current = parentItemId === null ? undefined : active.get(parentItemId);
  }
  return path;
}

interface OperationalSearchState {
  readonly document: BlockDocumentV3 | null;
  readonly pending: boolean;
  readonly conflict: boolean;
}

function bodyTextOf(item: ProjectedItem, operationalDocument: BlockDocumentV3 | null): string {
  if (item.kind !== "page" || item.localAvailability !== "present" || item.pageDocument === null) {
    return operationalDocument === null ? "" : extractSearchableDocumentTextV3(operationalDocument);
  }
  if (operationalDocument !== null) return extractSearchableDocumentTextV3(operationalDocument);
  const read = readDocumentBody(item.pageDocument.body);
  if (read.kind !== "blocks") {
    return "";
  }
  if (!read.result.ok) {
    throw new Error("Local page document cannot be indexed safely");
  }
  return extractSearchableDocumentText(read.result.document);
}

export class LocalSearchSource {
  readonly #repository: LocalRepository;
  readonly #databases: LocalDatabaseRepository | undefined;
  readonly #pageOperations: EncryptedPageOperationLog | undefined;

  constructor(
    repository: LocalRepository,
    databases?: LocalDatabaseRepository,
    pageOperations?: EncryptedPageOperationLog,
  ) {
    this.#repository = repository;
    this.#databases = databases;
    this.#pageOperations = pageOperations;
  }

  /**
   * Reads the editable authority used by an open page, not its older workspace
   * projection. A page can hold locally durable operational updates (or an
   * unconverted offline branch) while `items.sealedPageBody` still describes
   * the last consolidated revision. Searching that older row would make the
   * owner's newest words disappear precisely while offline.
   */
  async #operationalState(
    items: readonly ProjectedItem[],
  ): Promise<ReadonlyMap<Uuid, OperationalSearchState>> {
    const operations = this.#pageOperations;
    if (operations === undefined) return new Map();

    const pageIds = items
      .filter(
        (item): item is ProjectedItem & { readonly kind: "page" } =>
          item.kind === "page" && item.localAvailability === "present",
      )
      .map(({ id }) => id);
    const [updateRows, ambiguityRows, entries] = await Promise.all([
      operations.db.pageOperationUpdates.toArray(),
      operations.db.pageAmbiguities.where("status").equals("open").toArray(),
      Promise.all(
        pageIds.map(async (pageId) => {
          const [state, branch] = await Promise.all([
            operations.getState(pageId),
            operations.getLegacyBranch(pageId),
          ]);
          const branchUserEdits =
            branch !== null &&
            branch.status !== "converted" &&
            branch.branch.semanticTransactions.length >
              (branch.branch.bootstrapTransactionId === undefined ? 0 : 1);
          return {
            pageId,
            document:
              state?.projection?.document ??
              (branch !== null && branch.status !== "converted"
                ? branch.branch.localDocument
                : null),
            branchUserEdits,
          };
        }),
      ),
    ]);
    const pendingPageIds = new Set(
      updateRows.filter(({ status }) => status !== "accepted").map(({ pageId }) => pageId),
    );
    const conflictPageIds = new Set(ambiguityRows.map(({ pageId }) => pageId));

    return new Map(
      entries.map(({ pageId, document, branchUserEdits }) => [
        pageId,
        {
          document,
          pending: branchUserEdits || pendingPageIds.has(pageId),
          conflict: conflictPageIds.has(pageId),
        },
      ]),
    );
  }

  async #propertyText(
    active: ReadonlyMap<Uuid, ProjectedItem>,
  ): Promise<ReadonlyMap<Uuid, readonly SearchPropertyText[]>> {
    if (this.#databases === undefined) return new Map();
    const storedEntries = await this.#databases.db.databaseEntries.toArray();
    const definitionByDatabase = new Map<
      Uuid,
      Awaited<ReturnType<LocalDatabaseRepository["getDatabase"]>>
    >();
    const properties = new Map<Uuid, readonly SearchPropertyText[]>();
    for (const storedEntry of storedEntries) {
      const item = active.get(storedEntry.entryItemId);
      if (
        item === undefined ||
        item.localAvailability !== "present" ||
        storedEntry.availability !== "present"
      ) {
        properties.set(storedEntry.entryItemId, []);
        continue;
      }
      let database = definitionByDatabase.get(storedEntry.databaseId);
      if (database === undefined) {
        database = await this.#databases.getDatabase(storedEntry.databaseId);
        definitionByDatabase.set(storedEntry.databaseId, database);
      }
      const entry = await this.#databases.getEntry(storedEntry.entryItemId);
      properties.set(
        storedEntry.entryItemId,
        database === null || entry === null
          ? []
          : extractSearchablePropertyText(database.definition, entry.values),
      );
    }
    return properties;
  }

  async list(sourceVersion: number): Promise<LocalSearchEntry[]> {
    const items = await this.#repository.listItems("active");
    const active = new Map(items.map((item) => [item.id, item]));
    const [headers, outbox, conflicts, propertyText, operational] = await Promise.all([
      this.#repository.db.revisionHeaders.where("local").equals(1).toArray(),
      this.#repository.db.outbox.toArray(),
      this.#repository.db.conflicts.toArray(),
      this.#propertyText(active),
      this.#operationalState(items),
    ]);
    const itemByRevision = new Map(headers.map((header) => [header.id, header.itemId]));
    const pendingItemIds = new Set(
      outbox.flatMap((row) =>
        row.localRevisionIds.flatMap((revisionId) => {
          const itemId = itemByRevision.get(revisionId);
          return itemId === undefined ? [] : [itemId];
        }),
      ),
    );
    const conflictItemIds = new Set(
      conflicts.flatMap((row) =>
        row.localRevisionIds.flatMap((revisionId) => {
          const itemId = itemByRevision.get(revisionId);
          return itemId === undefined ? [] : [itemId];
        }),
      ),
    );

    return items
      .map((item): LocalSearchEntry => {
        const operation = operational.get(item.id);
        const syncState =
          conflictItemIds.has(item.id) || operation?.conflict === true
            ? "conflict"
            : pendingItemIds.has(item.id) || operation?.pending === true
              ? "pending"
              : "synchronized";
        return {
          document: {
            itemId: item.id,
            revisionId: item.currentRevisionId,
            sourceVersion,
            kind: item.kind,
            title: item.name,
            bodyText: bodyTextOf(item, operation?.document ?? null),
            properties: propertyText.get(item.id) ?? [],
            conflict: syncState === "conflict",
          },
          path: currentPath(item, active),
          localAvailability: item.localAvailability,
          syncState,
        };
      })
      .sort((left, right) => compareText(left.document.itemId, right.document.itemId));
  }

  async read(itemIds: readonly Uuid[], sourceVersion: number): Promise<LocalSearchEntry[]> {
    const requested = new Set(itemIds);
    if (this.#databases !== undefined && itemIds.length > 0) {
      const dependentEntries = await this.#databases.db.databaseEntries
        .where("databaseId")
        .anyOf(itemIds)
        .toArray();
      for (const entry of dependentEntries) requested.add(entry.entryItemId);
    }
    return (await this.list(sourceVersion)).filter(({ document }) =>
      requested.has(document.itemId),
    );
  }

  async activeDescendantIds(rootItemId: Uuid): Promise<Uuid[]> {
    const items = await this.#repository.listItems("active");
    const active = new Map(items.map((item) => [item.id, item]));
    if (!active.has(rootItemId)) {
      return [];
    }
    const descendants = new Set<Uuid>([rootItemId]);
    let added = true;
    while (added) {
      added = false;
      for (const item of items) {
        if (
          !descendants.has(item.id) &&
          item.placements.some(
            (placement) =>
              placement.kind === "hierarchy" &&
              placement.parentItemId !== null &&
              descendants.has(placement.parentItemId),
          )
        ) {
          descendants.add(item.id);
          added = true;
        }
      }
    }
    return [...descendants].sort(compareText);
  }
}
