import {
  inverseTargetPropertyPairs,
  ownedSourceIdFromItemId,
  type RelationTargets,
  type Uuid,
} from "@myownnotion/domain";
import type { LocalContentService } from "../../services/local-content.ts";

/**
 * Adds the values of two-way relations whose edges live on the partner side.
 *
 * A pair stores one edge on the entry that owns the property; the other side
 * must therefore be read by target, not by source. Callers merge the result
 * with their outgoing reads so both properties show the same links.
 */
export async function withInverseRelationTargets(input: {
  readonly service: LocalContentService;
  readonly source: {
    readonly itemId: Uuid;
    readonly sourceId?: Uuid | undefined;
    readonly definition: { readonly databaseId: Uuid; readonly properties: readonly unknown[] };
  };
  readonly entryIds: readonly Uuid[];
  readonly relations: ReadonlyMap<Uuid, RelationTargets>;
}): Promise<ReadonlyMap<Uuid, RelationTargets>> {
  const canonicalId = input.source.sourceId ?? ownedSourceIdFromItemId(input.source.itemId);
  const pairs = inverseTargetPropertyPairs(canonicalId, input.source.definition as never);
  if (pairs.length === 0 || input.entryIds.length === 0) return input.relations;
  const merged = new Map<Uuid, Record<string, readonly Uuid[]>>(
    [...input.relations].map(([entryId, targets]) => [entryId, { ...targets }]),
  );
  for (const pair of pairs) {
    const incoming = await input.service.getIncomingDatabaseRelationTargets(
      pair.partnerSourceId,
      pair.partnerPropertyId,
      input.entryIds,
    );
    for (const entryId of input.entryIds) {
      const sources = incoming.get(entryId) ?? [];
      if (sources.length === 0) continue;
      const targets = merged.get(entryId) ?? {};
      targets[pair.propertyId] = [...sources];
      merged.set(entryId, targets);
    }
  }
  return merged;
}
