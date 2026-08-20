import type { Uuid } from "../ids/uuid.ts";
import { validateDatabaseDefinition } from "./schema.ts";
import type {
  DatabaseDefinition,
  DatabaseMergeConflict,
  DatabaseMergeConflictReason,
  DatabaseMergeOutcome,
  DatabaseProperty,
  EntryValues,
  NonRelationPropertyValue,
  PreservedValue,
  RelationTargets,
} from "./types.ts";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifiedArray(
  value: readonly unknown[],
): value is ReadonlyArray<Record<string, unknown> & { id: string }> {
  return value.every((item) => isRecord(item) && typeof item["id"] === "string");
}

function conflict(
  conflicts: DatabaseMergeConflict[],
  path: string,
  reason: DatabaseMergeConflictReason,
): void {
  const stablePath = path.replace(/^(values\.[^.]+)\..+$/, "$1");
  if (
    !conflicts.some((candidate) => candidate.path === stablePath && candidate.reason === reason)
  ) {
    conflicts.push({ path: stablePath, reason });
  }
}

function childPath(path: string, child: string): string {
  return path.length === 0 ? child : `${path}.${child}`;
}

function mergeIdentifiedArray(
  ancestor: ReadonlyArray<Record<string, unknown> & { id: string }>,
  local: ReadonlyArray<Record<string, unknown> & { id: string }>,
  remote: ReadonlyArray<Record<string, unknown> & { id: string }>,
  path: string,
  conflicts: DatabaseMergeConflict[],
): unknown[] {
  const ancestorById = new Map(ancestor.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = [
    ...new Set([
      ...local.map((item) => item.id),
      ...remote.map((item) => item.id),
      ...ancestor.map((item) => item.id),
    ]),
  ];
  const merged = new Map<string, unknown>();
  for (const id of ids) {
    const result = mergeNode(
      ancestorById.get(id),
      localById.get(id),
      remoteById.get(id),
      childPath(path, id),
      conflicts,
    );
    if (result !== undefined) merged.set(id, result);
  }
  const ordered = [...local.map((item) => item.id), ...remote.map((item) => item.id)].filter(
    (id, index, all) => all.indexOf(id) === index && merged.has(id),
  );
  return ordered.map((id) => merged.get(id));
}

function mergeNode(
  ancestor: unknown,
  local: unknown,
  remote: unknown,
  path: string,
  conflicts: DatabaseMergeConflict[],
): unknown {
  if (same(local, remote)) return local;
  if (same(local, ancestor)) return remote;
  if (same(remote, ancestor)) return local;

  if (ancestor !== undefined && (local === undefined || remote === undefined)) {
    conflict(conflicts, path, "delete-edit");
    return local ?? remote;
  }
  if (Array.isArray(ancestor) && Array.isArray(local) && Array.isArray(remote)) {
    if (isIdentifiedArray(ancestor) && isIdentifiedArray(local) && isIdentifiedArray(remote)) {
      return mergeIdentifiedArray(ancestor, local, remote, path, conflicts);
    }
    conflict(conflicts, path, "divergent-edit");
    return local;
  }
  if (isRecord(ancestor) && isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(ancestor), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = mergeNode(
        ancestor[key],
        local[key],
        remote[key],
        childPath(path, key),
        conflicts,
      );
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  conflict(conflicts, path, "divergent-edit");
  return local;
}

export function mergeDatabaseDefinitions(
  ancestor: DatabaseDefinition,
  local: DatabaseDefinition,
  remote: DatabaseDefinition,
): DatabaseMergeOutcome<DatabaseDefinition> {
  const conflicts: DatabaseMergeConflict[] = [];
  const value = mergeNode(ancestor, local, remote, "", conflicts) as DatabaseDefinition;
  if (conflicts.length === 0 && !validateDatabaseDefinition(value).ok) {
    conflict(conflicts, "definition", "divergent-edit");
  }
  return conflicts.length === 0
    ? { kind: "merged", value }
    : { kind: "needs-owner", conflicts, ancestor, local, remote };
}

function propertiesById(definition: DatabaseDefinition): ReadonlyMap<Uuid, DatabaseProperty> {
  return new Map(definition.properties.map((property) => [property.id, property]));
}

function changed(
  left: NonRelationPropertyValue | undefined,
  right: NonRelationPropertyValue | undefined,
): boolean {
  return !same(left, right);
}

function typeOf(
  properties: ReadonlyMap<Uuid, DatabaseProperty>,
  propertyId: Uuid,
): string | undefined {
  return properties.get(propertyId)?.type;
}

function mergePreserved(
  ancestor: readonly PreservedValue[],
  local: readonly PreservedValue[],
  remote: readonly PreservedValue[],
  conflicts: DatabaseMergeConflict[],
): readonly PreservedValue[] {
  const key = (value: PreservedValue) => `${value.propertyId}/${value.preservedAtRevisionId}`;
  const toRecord = (values: readonly PreservedValue[]) =>
    Object.fromEntries(values.map((value) => [key(value), value]));
  return Object.values(
    mergeNode(
      toRecord(ancestor),
      toRecord(local),
      toRecord(remote),
      "preserved",
      conflicts,
    ) as Record<string, PreservedValue>,
  ).sort((left, right) => key(left).localeCompare(key(right)));
}

export interface MergeEntryValuesInput {
  readonly ancestor: EntryValues;
  readonly local: EntryValues;
  readonly remote: EntryValues;
  readonly ancestorDefinition?: DatabaseDefinition;
  readonly localDefinition?: DatabaseDefinition;
  readonly remoteDefinition?: DatabaseDefinition;
}

export function mergeEntryValues(input: MergeEntryValuesInput): DatabaseMergeOutcome<EntryValues> {
  const { ancestor, local, remote } = input;
  const conflicts: DatabaseMergeConflict[] = [];
  const providedDefinitions = [
    input.ancestorDefinition,
    input.localDefinition,
    input.remoteDefinition,
  ].filter((definition) => definition !== undefined);
  if (providedDefinitions.length > 0 && providedDefinitions.length !== 3) {
    conflict(conflicts, "definition", "definition-missing");
  } else if (
    input.ancestorDefinition !== undefined &&
    input.localDefinition !== undefined &&
    input.remoteDefinition !== undefined
  ) {
    const ancestorProperties = propertiesById(input.ancestorDefinition);
    const localProperties = propertiesById(input.localDefinition);
    const remoteProperties = propertiesById(input.remoteDefinition);
    const propertyIds = new Set<Uuid>([
      ...(Object.keys(ancestor.values) as Uuid[]),
      ...(Object.keys(local.values) as Uuid[]),
      ...(Object.keys(remote.values) as Uuid[]),
    ]);
    for (const propertyId of propertyIds) {
      const ancestorType = typeOf(ancestorProperties, propertyId);
      const localType = typeOf(localProperties, propertyId);
      const remoteType = typeOf(remoteProperties, propertyId);
      const localTypeChanged = localType !== ancestorType;
      const remoteTypeChanged = remoteType !== ancestorType;
      if (
        (localTypeChanged && changed(ancestor.values[propertyId], remote.values[propertyId])) ||
        (remoteTypeChanged && changed(ancestor.values[propertyId], local.values[propertyId]))
      ) {
        conflict(conflicts, `values.${propertyId}`, "type-value-incompatible");
      }
    }
  }

  const values = mergeNode(
    ancestor.values,
    local.values,
    remote.values,
    "values",
    conflicts,
  ) as EntryValues["values"];
  const preserved = mergePreserved(
    ancestor.preserved,
    local.preserved,
    remote.preserved,
    conflicts,
  );
  const identity = mergeNode(
    {
      format: ancestor.format,
      formatVersion: ancestor.formatVersion,
      databaseId: ancestor.databaseId,
      entryId: ancestor.entryId,
    },
    {
      format: local.format,
      formatVersion: local.formatVersion,
      databaseId: local.databaseId,
      entryId: local.entryId,
    },
    {
      format: remote.format,
      formatVersion: remote.formatVersion,
      databaseId: remote.databaseId,
      entryId: remote.entryId,
    },
    "identity",
    conflicts,
  ) as Pick<EntryValues, "format" | "formatVersion" | "databaseId" | "entryId">;
  const value: EntryValues = { ...identity, values, preserved };
  return conflicts.length === 0
    ? { kind: "merged", value }
    : { kind: "needs-owner", conflicts, ancestor, local, remote };
}

/** Three-way merge for relation properties, keyed by stable property identity. */
export function mergeRelationTargets(
  ancestor: RelationTargets,
  local: RelationTargets,
  remote: RelationTargets,
): DatabaseMergeOutcome<RelationTargets> {
  const conflicts: DatabaseMergeConflict[] = [];
  const value = mergeNode(ancestor, local, remote, "relations", conflicts) as RelationTargets;
  return conflicts.length === 0
    ? { kind: "merged", value }
    : { kind: "needs-owner", conflicts, ancestor, local, remote };
}
