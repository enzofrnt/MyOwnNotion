import type { DatabaseQueryPageDto } from "@myownnotion/contracts";
import {
  computeRollupValue,
  type DatabaseDefinition,
  type DatabaseProperty,
  type RollupEntry,
  type Uuid,
} from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";

export interface LocalRollupContext {
  readonly entries: ReadonlyMap<Uuid, RollupEntry>;
  readonly propertiesById: ReadonlyMap<Uuid, DatabaseProperty>;
  readonly options: readonly { readonly id: Uuid; readonly name: string; readonly type: string }[];
}

/** Build the related-entry context once per local projection for rollups and target options. */
export async function loadLocalRollupContext(
  service: LocalContentService,
): Promise<LocalRollupContext> {
  const databases = await service.listDatabases();
  const sourceIds = new Set<Uuid>();
  for (const database of databases) {
    sourceIds.add(database.itemId);
    if (database.sourceId !== undefined) sourceIds.add(database.sourceId);
  }
  const entries = new Map<Uuid, RollupEntry>();
  const propertiesById = new Map<Uuid, DatabaseProperty>();
  for (const sourceId of sourceIds) {
    const source = await service.getDatabase(sourceId);
    if (source === null) continue;
    for (const property of source.definition.properties) {
      if (property.state === "active") propertiesById.set(property.id, property);
    }
    const rows = await service.listDatabaseEntries(source.itemId);
    const ids = rows.map((row) => row.entryItemId);
    if (ids.length === 0) continue;
    const [items, relations] = await Promise.all([
      service.getItems(ids),
      service.getDatabaseEntryRelations(source.itemId, ids),
    ]);
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const row of rows) {
      const item = byId.get(row.entryItemId);
      if (item === undefined || item.lifecycle !== "active") continue;
      entries.set(row.entryItemId, {
        title: item.name,
        values: row.values.values,
        relationTargets: relations.get(row.entryItemId) ?? {},
        ...(row.entryNumber === undefined ? {} : { entryNumber: row.entryNumber }),
        ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
        ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
      });
    }
  }
  return {
    entries,
    propertiesById,
    options: [...propertiesById.values()]
      .filter(
        (property) =>
          property.type !== "relation" && property.type !== "rollup" && property.type !== "formula",
      )
      .map((property) => ({ id: property.id, name: property.name, type: property.type })),
  };
}

/** Attach computed values and target metadata to a local query page. */
export function withLocalRollups(
  page: DatabaseQueryPageDto,
  definition: DatabaseDefinition,
  context: LocalRollupContext,
): DatabaseQueryPageDto {
  const rollups = definition.properties.filter(
    (property): property is Extract<DatabaseProperty, { type: "rollup" }> =>
      property.state === "active" && property.type === "rollup",
  );
  if (rollups.length === 0) return page;
  const rows = page.rows.map((row) => {
    const entry = context.entries.get(row.entryId as Uuid);
    if (entry === undefined) return row;
    const rollupValues: Record<string, string | number | null> = {};
    for (const property of rollups) {
      const targetProperty =
        property.config.targetPropertyId === undefined
          ? undefined
          : context.propertiesById.get(property.config.targetPropertyId);
      const value = computeRollupValue(property, entry, targetProperty, context.entries);
      if (value !== null) rollupValues[property.id] = value;
    }
    return Object.keys(rollupValues).length === 0 ? row : { ...row, rollupValues };
  });
  return {
    ...page,
    rows,
    rollupProperties: context.options.map((option) => ({
      id: option.id as string,
      name: option.name,
      type: option.type,
    })),
  };
}
