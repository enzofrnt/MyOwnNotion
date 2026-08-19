import { type DomainResult, err, normalizeDisplayName, ok } from "../content/types.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import type {
  DatabaseDefinition,
  DatabaseProperty,
  DatabaseView,
  DefinitionImpact,
  DefinitionImpactReason,
  EntryValues,
  NonRelationPropertyValue,
  PropertyOption,
  TaskRoleMapping,
} from "./types.ts";

function invalidDefinition(fields: readonly string[]): DomainResult<DatabaseDefinition> {
  return err("validation.invalid-payload", "Database definition is invalid", {
    invalidFields: fields.map((field) => ({ field, code: "invalid" })),
  });
}

function validPositionKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 255;
}

function duplicateIds(ids: readonly unknown[]): boolean {
  return ids.some((id) => !isUuid(id)) || new Set(ids).size !== ids.length;
}

function normalizeOption(option: PropertyOption): PropertyOption | null {
  const label = normalizeDisplayName(option.label);
  if (
    !isUuid(option.id) ||
    !label.ok ||
    !validPositionKey(option.positionKey) ||
    !/^[a-z][a-z0-9-]*$/.test(option.tone) ||
    (option.state !== "active" && option.state !== "retired")
  ) {
    return null;
  }
  return { ...option, label: label.value };
}

function normalizeProperty(property: DatabaseProperty): DatabaseProperty | null {
  const name = normalizeDisplayName(property.name);
  if (
    !isUuid(property.id) ||
    !name.ok ||
    !validPositionKey(property.positionKey) ||
    (property.state !== "active" && property.state !== "retired")
  ) {
    return null;
  }
  if (property.type === "title" && property.state !== "active") return null;
  if (
    property.type === "date" &&
    property.config.mode !== "date" &&
    property.config.mode !== "instant"
  ) {
    return null;
  }
  if (
    property.type === "relation" &&
    property.config.cardinality !== "one" &&
    property.config.cardinality !== "many"
  ) {
    return null;
  }
  if (
    property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
  ) {
    if (duplicateIds(property.config.options.map((option) => option.id))) return null;
    const options = property.config.options.map(normalizeOption);
    if (options.some((option) => option === null)) return null;
    return { ...property, name: name.value, config: { options: options as PropertyOption[] } };
  }
  return { ...property, name: name.value };
}

function normalizeView(view: DatabaseView): DatabaseView | null {
  const name = normalizeDisplayName(view.name);
  if (
    !isUuid(view.id) ||
    !name.ok ||
    !validPositionKey(view.positionKey) ||
    (view.state !== "active" && view.state !== "retired") ||
    (view.filter.mode !== "all" && view.filter.mode !== "any") ||
    duplicateIds(view.filter.criteria.map((criterion) => criterion.id)) ||
    view.properties.some(
      (presentation) =>
        !isUuid(presentation.propertyId) ||
        !validPositionKey(presentation.positionKey) ||
        (presentation.width !== undefined &&
          (!Number.isInteger(presentation.width) ||
            presentation.width < 80 ||
            presentation.width > 800)),
    ) ||
    new Set(view.properties.map((presentation) => presentation.propertyId)).size !==
      view.properties.length
  ) {
    return null;
  }
  return { ...view, name: name.value };
}

function propertyById(
  properties: readonly DatabaseProperty[],
  propertyId: Uuid | null,
): DatabaseProperty | undefined {
  return propertyId === null
    ? undefined
    : properties.find((property) => property.id === propertyId);
}

function validTaskRoles(
  roles: TaskRoleMapping | null,
  properties: readonly DatabaseProperty[],
): boolean {
  if (roles === null) return true;
  const status = propertyById(properties, roles.statusPropertyId);
  const dueDate = propertyById(properties, roles.dueDatePropertyId);
  const priority = propertyById(properties, roles.priorityPropertyId);
  return (
    status?.state === "active" &&
    (status.type === "status" || status.type === "select") &&
    (roles.dueDatePropertyId === null ||
      (dueDate?.state === "active" && dueDate.type === "date")) &&
    (roles.priorityPropertyId === null ||
      (priority?.state === "active" && (priority.type === "status" || priority.type === "select")))
  );
}

export function validateDatabaseDefinition(
  definition: DatabaseDefinition,
): DomainResult<DatabaseDefinition> {
  const invalidFields: string[] = [];
  if (
    definition.format !== "myownnotion.database-definition+json" ||
    definition.formatVersion !== 1
  )
    invalidFields.push("format");
  if (!isUuid(definition.databaseId)) invalidFields.push("databaseId");
  if (duplicateIds(definition.properties.map((property) => property.id))) {
    invalidFields.push("properties");
  }
  if (duplicateIds(definition.views.map((view) => view.id))) invalidFields.push("views");

  const properties = definition.properties.map(normalizeProperty);
  if (properties.some((property) => property === null)) invalidFields.push("properties");
  const normalizedProperties = properties.filter(
    (property): property is DatabaseProperty => property !== null,
  );
  if (
    normalizedProperties.filter(
      (property) => property.type === "title" && property.state === "active",
    ).length !== 1
  )
    invalidFields.push("properties.title");

  const views = definition.views.map(normalizeView);
  if (views.some((view) => view === null)) invalidFields.push("views");
  const normalizedViews = views.filter((view): view is DatabaseView => view !== null);
  if (!normalizedViews.some((view) => view.state === "active")) invalidFields.push("views.active");
  if (!validTaskRoles(definition.taskRoles, normalizedProperties)) invalidFields.push("taskRoles");

  if (invalidFields.length > 0) return invalidDefinition([...new Set(invalidFields)]);
  return ok({
    ...definition,
    properties: normalizedProperties,
    views: normalizedViews,
  });
}

function optionIds(property: DatabaseProperty): readonly Uuid[] {
  return property.type === "status" ||
    property.type === "select" ||
    property.type === "multi-select"
    ? property.config.options
        .filter((option) => option.state === "active")
        .map((option) => option.id)
    : [];
}

function valueUsesOption(value: NonRelationPropertyValue, retired: ReadonlySet<Uuid>): boolean {
  if (value.kind === "status" || value.kind === "select") return retired.has(value.optionId);
  return value.kind === "multi-select" && value.optionIds.some((optionId) => retired.has(optionId));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function previewDefinitionImpact(input: {
  readonly baseRevisionId: Uuid;
  readonly current: DatabaseDefinition;
  readonly candidate: DatabaseDefinition;
  readonly entries: readonly EntryValues[];
}): Promise<DefinitionImpact> {
  const current = validateDatabaseDefinition(input.current);
  const candidate = validateDatabaseDefinition(input.candidate);
  if (!current.ok || !candidate.ok || current.value.databaseId !== candidate.value.databaseId) {
    throw new TypeError("invalid database definition impact input");
  }

  const candidateProperties = new Map(
    candidate.value.properties.map((property) => [property.id, property]),
  );
  const destructiveProperties = new Set<Uuid>();
  const retiredOptions = new Map<Uuid, ReadonlySet<Uuid>>();
  const reasons = new Set<DefinitionImpactReason>();

  for (const property of current.value.properties) {
    const next = candidateProperties.get(property.id);
    if (property.state === "active" && (next === undefined || next.state === "retired")) {
      destructiveProperties.add(property.id);
      reasons.add("property-retired");
    } else if (next !== undefined && property.type !== next.type) {
      destructiveProperties.add(property.id);
      reasons.add("property-type-changed");
    }
    if (next !== undefined) {
      const nextActiveOptions = new Set(optionIds(next));
      const retired = optionIds(property).filter((optionId) => !nextActiveOptions.has(optionId));
      if (retired.length > 0) {
        retiredOptions.set(property.id, new Set(retired));
        reasons.add("option-retired");
      }
    }
  }
  if (canonicalJson(current.value.taskRoles) !== canonicalJson(candidate.value.taskRoles)) {
    reasons.add("task-role-invalidated");
  }

  const affectedPairs = new Set<string>();
  const affectedEntries = new Set<Uuid>();
  for (const entry of input.entries) {
    for (const [propertyId, value] of Object.entries(entry.values) as Array<
      [Uuid, NonRelationPropertyValue]
    >) {
      const retired = retiredOptions.get(propertyId);
      if (
        destructiveProperties.has(propertyId) ||
        (retired !== undefined && valueUsesOption(value, retired))
      ) {
        affectedPairs.add(`${entry.entryId}/${propertyId}`);
        affectedEntries.add(entry.entryId);
      }
    }
  }

  const orderedReasons = [
    "property-retired",
    "property-type-changed",
    "option-retired",
    "task-role-invalidated",
  ].filter((reason): reason is DefinitionImpactReason =>
    reasons.has(reason as DefinitionImpactReason),
  );
  const digestInput = {
    databaseId: current.value.databaseId,
    baseRevisionId: input.baseRevisionId,
    candidate: candidate.value,
    touchedPropertyIds: [...destructiveProperties].sort(),
    retiredOptionIds: [...retiredOptions.entries()]
      .map(([propertyId, ids]) => [propertyId, [...ids].sort()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    affectedPairs: [...affectedPairs].sort(),
  };

  return {
    destructive: reasons.size > 0,
    affectedEntryCount: affectedEntries.size,
    affectedValueCount: affectedPairs.size,
    reasons: orderedReasons,
    impactDigest: await sha256Hex(canonicalJson(digestInput)),
  };
}
