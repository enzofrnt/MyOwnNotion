import type {
  DatabaseDefinition,
  DatabaseQueryEntry,
  DatabaseView,
  EvaluatedDatabaseGroup,
  NonRelationPropertyValue,
  Uuid,
} from "@myownnotion/domain";
import type { DatabaseQueryPageDto } from "./content-api.ts";

type QueryRowValue = DatabaseQueryPageDto["rows"][number]["values"][string];
function responseValue(value: NonRelationPropertyValue): QueryRowValue {
  if (value.kind === "multi-select") {
    return { kind: "multi-select", optionIds: [...value.optionIds] };
  }
  return { ...value } as QueryRowValue;
}
function groupLabel(definition: DatabaseDefinition, propertyId: Uuid, groupId: string): string {
  if (groupId === "missing") return "Sans valeur";
  if (groupId === "checked") return "Coché";
  if (groupId === "unchecked") return "Non coché";
  const property = definition.properties.find(({ id }) => id === propertyId);
  if (property?.type !== "status" && property?.type !== "select") return groupId;
  return property.config.options.find(({ id }) => id === groupId)?.label ?? "Option indisponible";
}

/** DTO projection shared by canonical and local query adapters. No cursor or coverage policy. */
export function presentDatabaseQuery(input: {
  readonly definition: DatabaseDefinition;
  readonly view: DatabaseView;
  readonly entries: readonly (DatabaseQueryEntry & { readonly revisionId: Uuid })[];
  readonly groups: readonly EvaluatedDatabaseGroup[];
  readonly includeGroups: boolean;
}): Pick<DatabaseQueryPageDto, "rows" | "groups"> {
  const visiblePropertyIds = new Set(
    input.view.properties.filter(({ visible }) => visible).map(({ propertyId }) => propertyId),
  );
  const entryGroups = new Map<Uuid, string>();
  for (const group of input.groups)
    for (const entryId of group.entryIds) entryGroups.set(entryId, group.id);
  return {
    rows: input.entries.map((entry) => ({
      entryId: entry.entryId,
      revisionId: entry.revisionId,
      title: entry.title,
      values: Object.fromEntries(
        Object.entries(entry.values)
          .filter(([propertyId]) => visiblePropertyIds.has(propertyId as Uuid))
          .map(([propertyId, value]) => [propertyId, responseValue(value)]),
      ),
      relationTargets: Object.fromEntries(
        Object.entries(entry.relationTargets)
          .filter(([propertyId]) => visiblePropertyIds.has(propertyId as Uuid))
          .map(([propertyId, targetIds]) => [propertyId, [...targetIds]]),
      ),
      groupId: entryGroups.get(entry.entryId) ?? null,
    })),
    groups:
      !input.includeGroups || input.view.group === null
        ? []
        : input.groups.map((group) => ({
            id: group.id,
            label: groupLabel(input.definition, input.view.group?.propertyId as Uuid, group.id),
            count: group.entryIds.length,
          })),
  };
}
