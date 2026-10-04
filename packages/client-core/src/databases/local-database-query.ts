import type { DatabaseQueryDto, DatabaseQueryPageDto } from "@myownnotion/contracts";
import { presentDatabaseQuery } from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DatabaseQueryEntry,
  evaluateDatabaseView,
  type NonRelationPropertyValue,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";

export interface LocalDatabaseQueryEntry {
  readonly entryId: Uuid;
  readonly revisionId: Uuid;
  readonly title: string;
  readonly availability: "present" | "offloaded" | "never-fetched";
  readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
  readonly relationTargets: RelationTargets;
}

export interface LocalDatabaseQuerySource {
  readonly databaseId: Uuid;
  readonly definitionRevisionId: Uuid;
  readonly definition: DatabaseDefinition;
  readonly generation: number;
  readonly expectedCount: number;
  readonly entries: readonly LocalDatabaseQueryEntry[];
}

export class LocalDatabaseQueryError extends Error {
  constructor(
    readonly code: "database.invalid-view" | "database.invalid-cursor" | "database.cursor-stale",
  ) {
    super("Local database query cannot be executed");
    this.name = "LocalDatabaseQueryError";
  }
}

interface LocalCursor {
  readonly version: 1;
  readonly databaseId: Uuid;
  readonly viewId: Uuid;
  readonly definitionRevisionId: Uuid;
  readonly generation: number;
  readonly offset: number;
  readonly afterEntryId: Uuid;
}

function encodeCursor(cursor: LocalCursor): string {
  const value = [
    cursor.version,
    cursor.databaseId,
    cursor.viewId,
    cursor.definitionRevisionId,
    cursor.generation,
    cursor.offset,
    cursor.afterEntryId,
  ].join(".");
  return `local.${value}`;
}

function decodeCursor(
  cursor: string,
  source: LocalDatabaseQuerySource,
  viewId: Uuid,
  rows: readonly DatabaseQueryEntry[],
): number {
  const parts = cursor.split(".");
  if (parts.length !== 8 || parts[0] !== "local" || parts[1] !== "1") {
    throw new LocalDatabaseQueryError("database.invalid-cursor");
  }
  const offset = Number(parts[6]);
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new LocalDatabaseQueryError("database.invalid-cursor");
  }
  if (
    parts[2] !== source.databaseId ||
    parts[3] !== viewId ||
    parts[4] !== source.definitionRevisionId ||
    Number(parts[5]) !== source.generation ||
    rows[offset - 1]?.entryId !== parts[7]
  ) {
    throw new LocalDatabaseQueryError("database.cursor-stale");
  }
  return offset;
}

export function queryLocalDatabase(
  source: LocalDatabaseQuerySource,
  request: DatabaseQueryDto,
): DatabaseQueryPageDto {
  const view = source.definition.views.find(
    (candidate) => candidate.id === request.viewId && candidate.state === "active",
  );
  if (view === undefined) throw new LocalDatabaseQueryError("database.invalid-view");
  const availableEntries = source.entries.filter(({ availability }) => availability === "present");
  const limit = request.limit ?? 100;
  const evaluated = evaluateDatabaseView(
    source.definition,
    request.viewId as Uuid,
    availableEntries,
    {
      ...(request.cursor === undefined && view.group === null ? { maxRows: limit } : {}),
    },
  );
  if (!evaluated.ok) throw new LocalDatabaseQueryError("database.invalid-view");
  const rows = evaluated.value.rows as readonly LocalDatabaseQueryEntry[];
  const offset =
    request.cursor === undefined
      ? 0
      : decodeCursor(request.cursor, source, request.viewId as Uuid, rows);
  const pageRows = rows.slice(offset, offset + limit);
  const coverage =
    availableEntries.length === source.expectedCount &&
    source.entries.every(({ availability }) => availability === "present")
      ? "complete"
      : "partial";
  const nextOffset = offset + pageRows.length;
  const last = pageRows.at(-1);
  return {
    databaseId: source.databaseId,
    viewId: request.viewId,
    definitionRevisionId: source.definitionRevisionId,
    generation: source.generation,
    coverage,
    availableCount: availableEntries.length,
    expectedCount: source.expectedCount,
    ...presentDatabaseQuery({
      definition: source.definition,
      view,
      entries: pageRows,
      groups: evaluated.value.groups,
      includeGroups: coverage !== "partial",
    }),
    nextCursor:
      nextOffset < evaluated.value.totalCount && last !== undefined
        ? encodeCursor({
            version: 1,
            databaseId: source.databaseId,
            viewId: request.viewId as Uuid,
            definitionRevisionId: source.definitionRevisionId,
            generation: source.generation,
            offset: nextOffset,
            afterEntryId: last.entryId,
          })
        : null,
  };
}
