import type {
  ReplaceDefinitionRequestDto,
  ReplaceEntryValuesRequestDto,
} from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  type DefinitionImpact,
  jsonValuesEqual,
  type NonRelationPropertyValue,
  type PropertyOption,
  previewDefinitionImpact,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";
import type { EntryValueChanges } from "./use-entry-autosave.ts";

export type EditEntryDefinition = (
  edit: (current: DatabaseDefinition) => DatabaseDefinition,
  confirmed?: boolean,
) => Promise<DatabaseDefinition>;
export class EntrySchemaImpact extends Error {
  constructor(readonly impact: DefinitionImpact) {
    super("Cette modification affecte les valeurs de la source.");
  }
}

/** Apply only changed fields to the newest revision; unrelated writes survive. */
export async function saveEntryPropertyChanges(
  service: LocalContentService,
  databaseId: Uuid,
  entryId: Uuid,
  values: Readonly<Record<Uuid, NonRelationPropertyValue>>,
  relations: RelationTargets,
  changes: EntryValueChanges,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [item, row, currentRelations] = await Promise.all([
      service.getItem(entryId),
      service.getDatabaseEntry(entryId),
      service.getDatabaseEntryRelationTargets(databaseId, entryId),
    ]);
    if (item === null || row === null)
      throw new Error("Cette entrée n’est pas disponible sur cet appareil.");
    const nextValues = { ...row.values.values };
    const nextRelations = { ...currentRelations };
    for (const id of changes.propertyIds) {
      // An echo of our own write is harmless. A divergent edit of the same
      // property must not be overwritten by an autosave from a stale page.
      const valueUnchanged = jsonValuesEqual(
        nextValues[id] ?? null,
        changes.previousValues[id] ?? null,
      );
      const relationUnchanged = jsonValuesEqual(
        nextRelations[id] ?? [],
        changes.previousRelations[id] ?? [],
      );
      const alreadyWritten =
        jsonValuesEqual(nextValues[id] ?? null, values[id] ?? null) &&
        jsonValuesEqual(nextRelations[id] ?? [], relations[id] ?? []);
      if ((!valueUnchanged || !relationUnchanged) && !alreadyWritten)
        throw new Error("Cette propriété a changé ailleurs. Votre saisie est conservée.");
      delete nextValues[id];
      delete nextRelations[id];
      if (values[id] !== undefined) nextValues[id] = values[id];
      if (relations[id] !== undefined) nextRelations[id] = [...relations[id]];
    }
    const result = await service.replaceDatabaseEntryValues(databaseId, entryId, {
      baseRevisionId: item.currentRevisionId,
      values: nextValues,
      relationTargets: nextRelations,
    } as unknown as ReplaceEntryValuesRequestDto);
    if (result.ok) return;
    if (result.error.code !== "revision.stale-base") throw new Error(result.error.title);
  }
  throw new Error("La page a changé pendant l’enregistrement. Réessayez.");
}

export async function editEntrySourceDefinition(
  service: LocalContentService,
  databaseId: Uuid,
  edit: (definition: DatabaseDefinition) => DatabaseDefinition,
  confirmed = false,
): Promise<DatabaseDefinition> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = await service.getDatabase(databaseId);
    if (source === null) throw new Error("La source n’est pas disponible sur cet appareil.");
    const item = await service.getItem(source.itemId);
    const revision = source.definitionRevisionId ?? item?.currentRevisionId;
    if (revision === undefined) throw new Error("La source n’est pas disponible sur cet appareil.");
    const candidate = edit(source.definition);
    const entries = await service.listDatabaseEntries(databaseId);
    if (entries.some((row) => row.availability !== "present"))
      throw new Error("Chargez les valeurs de cette source avant de modifier ses propriétés.");
    const impact = await previewDefinitionImpact({
      baseRevisionId: revision,
      current: source.definition,
      candidate,
      entries: entries.map((row) => row.values),
    });
    if (impact.destructive && !confirmed) throw new EntrySchemaImpact(impact);
    const result = await service.replaceDatabaseDefinition(source.itemId, {
      baseRevisionId: revision,
      ...(source.sourceId === undefined ? {} : { sourceId: source.sourceId }),
      definition: candidate,
      ...(impact.destructive
        ? { impactConfirmation: { digest: impact.impactDigest, decision: "preserve-incompatible" } }
        : {}),
    } as unknown as ReplaceDefinitionRequestDto);
    if (result.ok) return candidate;
    if (
      result.error.code !== "revision.stale-base" &&
      result.error.code !== "database.impact-stale"
    )
      throw new Error(result.error.title);
  }
  throw new Error("La source a changé pendant l’enregistrement. Réessayez.");
}

export function replaceEntryPropertyOptions(
  definition: DatabaseDefinition,
  id: Uuid,
  options: readonly PropertyOption[],
): DatabaseDefinition {
  return {
    ...definition,
    properties: definition.properties.map((p) =>
      p.id === id && (p.type === "select" || p.type === "status" || p.type === "multi-select")
        ? { ...p, config: { options } }
        : p,
    ),
  };
}

/** Merge the option fields actually edited, preserving newer unrelated edits. */
export function mergeChoiceOptionEdits(
  current: readonly PropertyOption[],
  baseline: readonly PropertyOption[],
  candidate: readonly PropertyOption[],
): readonly PropertyOption[] {
  const next = [...current];
  for (const option of candidate) {
    const previous = baseline.find((o) => o.id === option.id);
    const index = next.findIndex((o) => o.id === option.id);
    if (previous === undefined) {
      if (index < 0) next.push(option);
      continue;
    }
    if (index < 0) throw new Error("Cette option n’est plus disponible.");
    const patch: Partial<PropertyOption> = {};
    for (const field of ["label", "tone", "state", "positionKey"] as const)
      if (option[field] !== previous[field]) Object.assign(patch, { [field]: option[field] });
    next[index] = { ...next[index], ...patch } as PropertyOption;
  }
  return next;
}
