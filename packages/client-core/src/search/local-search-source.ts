import {
  extractSearchableDocumentText,
  readDocumentBody,
  type SearchDocument,
  type SearchPathSegment,
  type Uuid,
} from "@myownnotion/domain";
import type { LocalRepository, ProjectedItem } from "../local-store/local-repository.ts";

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

function bodyTextOf(item: ProjectedItem): string {
  if (item.kind !== "page" || item.localAvailability !== "present" || item.pageDocument === null) {
    return "";
  }
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

  constructor(repository: LocalRepository) {
    this.#repository = repository;
  }

  async list(sourceVersion: number): Promise<LocalSearchEntry[]> {
    const items = await this.#repository.listItems("active");
    const active = new Map(items.map((item) => [item.id, item]));
    const [headers, outbox, conflicts] = await Promise.all([
      this.#repository.db.revisionHeaders.where("local").equals(1).toArray(),
      this.#repository.db.outbox.toArray(),
      this.#repository.db.conflicts.toArray(),
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
        const syncState = conflictItemIds.has(item.id)
          ? "conflict"
          : pendingItemIds.has(item.id)
            ? "pending"
            : "synchronized";
        return {
          document: {
            itemId: item.id,
            revisionId: item.currentRevisionId,
            sourceVersion,
            kind: item.kind,
            title: item.name,
            bodyText: bodyTextOf(item),
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
