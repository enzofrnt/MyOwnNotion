import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import type {
  DatabaseProperty,
  DerivedValueOptions,
  RelationTargets,
  RollupContext,
  RollupEntry,
  Uuid,
} from "@myownnotion/domain";
import { ownedSourceIdFromItemId } from "@myownnotion/domain";
import { useEffect, useMemo, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

export interface RollupTargetOption {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  /** Source that owns the property, to match it with a relation. */
  readonly sourceId?: string | undefined;
}

export interface LocalRollupContext extends RollupContext {
  readonly options: readonly RollupTargetOption[];
  readonly entrySource: ReadonlyMap<Uuid, Uuid>;
}

/**
 * Build the related-entry context once per local projection.
 *
 * The local corpus may be partial: an entry that was never fetched is unknown,
 * so a rollup reaching it is reported unavailable instead of being computed
 * from the part that happens to be on this device. Archived entries are known
 * and simply left out.
 */
export async function loadLocalRollupContext(
  service: LocalContentService,
): Promise<LocalRollupContext> {
  const databases = await service.listDatabases();
  const owners = new Map(
    (await service.getItems([...new Set(databases.map((database) => database.itemId))])).map(
      (owner) => [owner.id, owner],
    ),
  );
  const sourceIds = new Set<Uuid>();
  for (const database of databases) {
    sourceIds.add(database.sourceId ?? database.itemId);
  }
  const entries = new Map<Uuid, RollupEntry>();
  const entriesBySource = new Map<Uuid, Map<Uuid, RollupEntry>>();
  const entrySource = new Map<Uuid, Uuid>();
  const inactiveEntryIds = new Set<Uuid>();
  const propertiesById = new Map<Uuid, DatabaseProperty>();
  const propertySources = new Map<Uuid, Uuid>();
  const entrySources = new Map<Uuid, Set<Uuid>>();
  const options: RollupTargetOption[] = [];
  const seenSources = new Set<Uuid>();
  for (const sourceId of sourceIds) {
    const source = await service.getDatabase(sourceId);
    if (source === null || owners.get(source.itemId)?.lifecycle !== "active") continue;
    const canonicalSourceId = source.sourceId ?? ownedSourceIdFromItemId(source.itemId);
    if (seenSources.has(canonicalSourceId)) continue;
    seenSources.add(canonicalSourceId);
    const sourceEntries = new Map<Uuid, RollupEntry>();
    entriesBySource.set(canonicalSourceId, sourceEntries);
    for (const property of source.definition.properties) {
      if (property.state !== "active") continue;
      propertiesById.set(property.id, property);
      propertySources.set(property.id, canonicalSourceId);
      if (
        property.type !== "relation" &&
        property.type !== "rollup" &&
        property.type !== "formula"
      ) {
        options.push({
          id: property.id,
          name: property.name,
          type: property.type,
          sourceId: canonicalSourceId,
        });
      }
    }
    const rows = (await service.listDatabaseEntries(source.itemId)).filter(
      (row) =>
        row.sourceId === canonicalSourceId ||
        (row.sourceId === undefined &&
          (source.sourceId === undefined ||
            canonicalSourceId === ownedSourceIdFromItemId(source.itemId))),
    );
    const ids = rows.map((row) => row.entryItemId);
    if (ids.length === 0) continue;
    const [items, relations] = await Promise.all([
      service.getItems(ids),
      service.getDatabaseEntryRelations(source.itemId, ids),
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const row of rows) {
      const item = byId.get(row.entryItemId);
      if (item === undefined) continue;
      entrySource.set(row.entryItemId, canonicalSourceId);
      const memberships = entrySources.get(row.entryItemId) ?? new Set<Uuid>();
      memberships.add(canonicalSourceId);
      entrySources.set(row.entryItemId, memberships);
      if (item.lifecycle !== "active") {
        inactiveEntryIds.add(row.entryItemId);
        continue;
      }
      if (row.availability !== "present") continue;
      const sourceEntry: RollupEntry = {
        title: item.name,
        values: row.values.values,
        relationTargets: relations.get(row.entryItemId) ?? {},
        ...(row.entryNumber === undefined ? {} : { entryNumber: row.entryNumber }),
        ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
        ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
      };
      sourceEntries.set(row.entryItemId, sourceEntry);
      entries.set(row.entryItemId, sourceEntry);
    }
  }
  return {
    entries,
    entriesBySource,
    propertiesById,
    options,
    entrySource,
    inactiveEntryIds,
    propertySources,
    entrySources,
    sourceIds: seenSources,
    missing: "unavailable",
  };
}

/** What the shared resolver needs to compute rollups and formulas locally. */
export function localDerivedOptions(context: LocalRollupContext): DerivedValueOptions {
  return { rollups: context, relationTitle: (id) => context.entries.get(id)?.title };
}

/** Attach the target choices of the configuration panel to a local query page. */
export function withRollupMetadata(
  page: DatabaseQueryPageDto,
  source: {
    readonly properties: readonly DatabaseProperty[];
    readonly entries: readonly { readonly relationTargets: RelationTargets }[];
  },
  context: LocalRollupContext,
): DatabaseQueryPageDto {
  const rollupRelations: Record<string, string[]> = {};
  for (const property of source.properties) {
    if (property.state !== "active" || property.type !== "relation") continue;
    rollupRelations[property.id] =
      property.config.targetSourceId === undefined ? [] : [property.config.targetSourceId];
  }
  return {
    ...page,
    rollupProperties: context.options.map((option) => ({
      id: option.id,
      name: option.name,
      type: option.type,
      ...(option.sourceId === undefined ? {} : { sourceId: option.sourceId }),
    })),
    rollupRelations,
  };
}

/**
 * Related entries for a surface that shows one entry outside a view (side
 * panel, full page). Reloaded when the local projection changes; `undefined`
 * until loaded or when the definition has nothing to compute.
 */
export function useLocalDerivedOptions(
  service: LocalContentService,
  enabled: boolean,
): DerivedValueOptions | undefined {
  const [context, setContext] = useState<LocalRollupContext | null>(null);
  useEffect(() => {
    if (!enabled) {
      setContext(null);
      return;
    }
    let cancelled = false;
    let running = false;
    let again = false;
    const load = (): void => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      void loadLocalRollupContext(service)
        .then((next) => {
          if (!cancelled) setContext(next);
        })
        .catch(() => {
          if (!cancelled) setContext(null);
        })
        .finally(() => {
          running = false;
          if (again && !cancelled) {
            again = false;
            load();
          }
        });
    };
    load();
    const unsubscribe = service.subscribeProjection(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service, enabled]);
  return useMemo(() => (context === null ? undefined : localDerivedOptions(context)), [context]);
}

export function hasDerivedProperties(properties: readonly DatabaseProperty[]): boolean {
  return properties.some(
    (property) =>
      property.state === "active" && (property.type === "rollup" || property.type === "formula"),
  );
}
