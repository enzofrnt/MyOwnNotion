import type { ReplaceEntryValuesRequestDto } from "@myownnotion/contracts";
import type { NonRelationPropertyValue, RelationTargets, Uuid } from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";
import type { DatabaseCellUpdate } from "./table-view.tsx";

/** Keep a property's scalar value and relation targets mutually exclusive. */
export function updatedCellProperties(
  currentValues: Readonly<Record<Uuid, NonRelationPropertyValue>>,
  currentRelations: RelationTargets,
  update: Extract<DatabaseCellUpdate, { kind: "property" }>,
) {
  const values = { ...currentValues };
  const relationTargets = { ...currentRelations };
  if (update.optionMove !== undefined) {
    const current = values[update.propertyId];
    if (current !== undefined && current.kind !== "multi-select")
      throw new Error("La propriété de regroupement a changé.");
    const ids = current?.kind === "multi-select" ? current.optionIds : [];
    const { from, to } = update.optionMove;
    if (from !== "missing" && !ids.includes(from))
      throw new Error("La carte a changé de colonne. Réessayez depuis sa position actuelle.");
    delete relationTargets[update.propertyId];
    if (to === "missing") delete values[update.propertyId];
    else
      values[update.propertyId] = {
        kind: "multi-select",
        optionIds: [...new Set([...ids.filter((id) => id !== from), to])].sort(),
      };
  } else if (update.relationTargets !== undefined) {
    relationTargets[update.propertyId] = update.relationTargets;
    delete values[update.propertyId];
  } else {
    delete relationTargets[update.propertyId];
    if (update.value === undefined) delete values[update.propertyId];
    else values[update.propertyId] = update.value;
  }
  return { values, relationTargets };
}

export async function updateDatabaseCell(
  service: LocalContentService,
  databaseId: Uuid,
  entryId: Uuid,
  update: DatabaseCellUpdate,
  options: { readonly missingItemMessage: string; readonly missingEntryMessage?: string },
): Promise<void> {
  const item = await service.getItem(entryId);
  if (item === null) throw new Error(options.missingItemMessage);
  if (update.kind === "title") {
    const result = await service.mutate("item.rename", { itemId: entryId, name: update.title }, [
      item.currentRevisionId,
    ]);
    if (!result.ok) throw new Error(result.error.title);
    return;
  }
  const entry = await service.getDatabaseEntry(entryId);
  if (entry === null && options.missingEntryMessage !== undefined)
    throw new Error(options.missingEntryMessage);
  const values = { ...(entry?.values.values ?? {}) };
  const relations = await service.getDatabaseEntryRelationTargets(databaseId, entryId);
  const result = await service.replaceDatabaseEntryValues(databaseId, entryId, {
    baseRevisionId: item.currentRevisionId,
    ...updatedCellProperties(values, relations, update),
  } as unknown as ReplaceEntryValuesRequestDto);
  if (!result.ok) throw new Error(result.error.title);
}
