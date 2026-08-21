import { validatePageDocument } from "../content/hierarchy.ts";
import { isValidPositionKey } from "../content/position-key.ts";
import {
  type DomainResult,
  err,
  normalizeDisplayName,
  ok,
  type PageDocument,
} from "../content/types.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import { validateDatabaseDefinition } from "./schema.ts";
import type { DatabaseDefinition, NonRelationPropertyValue, RelationTargets } from "./types.ts";
import { normalizeCivilDate, normalizeDecimal, normalizeInstant } from "./values.ts";

export const DATABASE_COMMAND_TYPES = [
  "database.create",
  "database.definition.replace",
  "database.definition.resolve-conflict",
  "database.entry.create",
  "database.entry.values.replace",
  "database.entry.values.resolve-conflict",
] as const;

export type DatabaseCommandType = (typeof DATABASE_COMMAND_TYPES)[number];

export interface DatabasePlacementInput {
  readonly id: Uuid;
  readonly parentItemId: Uuid | null;
  readonly positionKey: string;
}

export interface DatabaseImpactConfirmation {
  readonly digest: string;
  readonly decision: "preserve-incompatible" | "discard-confirmed";
}

export type DatabaseMutationCommand =
  | {
      readonly type: "database.create";
      readonly id: Uuid;
      readonly name: string;
      readonly placement: DatabasePlacementInput;
      readonly titlePropertyId: Uuid;
      readonly titlePropertyName?: string;
      readonly initialViewId: Uuid;
      readonly initialViewName: string;
    }
  | {
      readonly type: "database.definition.replace";
      readonly databaseId: Uuid;
      readonly baseRevisionId: Uuid;
      readonly definition: DatabaseDefinition;
      readonly impactConfirmation?: DatabaseImpactConfirmation;
    }
  | {
      readonly type: "database.definition.resolve-conflict";
      readonly databaseId: Uuid;
      readonly resolvedRevisionIds: readonly [Uuid, Uuid];
      readonly definition: DatabaseDefinition;
      readonly impactConfirmation?: DatabaseImpactConfirmation;
    }
  | {
      readonly type: "database.entry.create";
      readonly databaseId: Uuid;
      readonly id: Uuid;
      readonly title: string;
      readonly placement: DatabasePlacementInput;
      readonly document?: PageDocument;
      readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
      readonly relationTargets: RelationTargets;
    }
  | {
      readonly type: "database.entry.values.replace";
      readonly databaseId: Uuid;
      readonly entryId: Uuid;
      readonly baseRevisionId: Uuid;
      readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
      readonly relationTargets: RelationTargets;
    }
  | {
      readonly type: "database.entry.values.resolve-conflict";
      readonly databaseId: Uuid;
      readonly entryId: Uuid;
      readonly resolvedRevisionIds: readonly [Uuid, Uuid];
      readonly values: Readonly<Record<Uuid, NonRelationPropertyValue>>;
      readonly relationTargets: RelationTargets;
    };

/** The identical minimal schema used by server and optimistic projection. */
export function createInitialDatabaseDefinition(
  command: Extract<DatabaseMutationCommand, { type: "database.create" }>,
): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: command.id,
    properties: [
      {
        id: command.titlePropertyId,
        name: command.titlePropertyName ?? "Title",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
    ],
    views: [
      {
        id: command.initialViewId,
        name: command.initialViewName,
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [{ propertyId: command.titlePropertyId, visible: true, positionKey: "a" }],
        filter: { mode: "all", criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles: null,
  };
}

type Payload = Readonly<Record<string, unknown>>;

function invalid<T = DatabaseMutationCommand>(): DomainResult<T> {
  return err("validation.invalid-payload", "Database mutation payload is invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
  );
}

function parsePlacement(value: unknown): DatabasePlacementInput | null {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "parentItemId", "positionKey"])) {
    return null;
  }
  const parentItemId = value["parentItemId"];
  const positionKey = value["positionKey"];
  return isUuid(value["id"]) &&
    (parentItemId === null || isUuid(parentItemId)) &&
    typeof positionKey === "string" &&
    isValidPositionKey(positionKey)
    ? {
        id: value["id"],
        parentItemId: parentItemId as Uuid | null,
        positionKey,
      }
    : null;
}

function parseDocument(value: unknown): PageDocument | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["format", "formatVersion", "body"]) ||
    value["format"] !== "myownnotion.document+json" ||
    typeof value["formatVersion"] !== "number" ||
    !isRecord(value["body"])
  ) {
    return null;
  }
  const validated = validatePageDocument({
    format: value["format"],
    formatVersion: value["formatVersion"],
    body: value["body"],
  });
  return validated.ok ? validated.value : null;
}

function parsePropertyValue(value: unknown): NonRelationPropertyValue | null {
  if (!isRecord(value) || typeof value["kind"] !== "string") return null;
  switch (value["kind"]) {
    case "text":
      return hasExactKeys(value, ["kind", "value"]) && typeof value["value"] === "string"
        ? { kind: "text", value: value["value"] }
        : null;
    case "number": {
      if (!hasExactKeys(value, ["kind", "decimal"]) || typeof value["decimal"] !== "string") {
        return null;
      }
      const decimal = normalizeDecimal(value["decimal"]);
      return decimal.ok ? { kind: "number", decimal: decimal.value } : null;
    }
    case "date": {
      if (!hasExactKeys(value, ["kind", "date"]) || typeof value["date"] !== "string") {
        return null;
      }
      const date = normalizeCivilDate(value["date"]);
      return date.ok ? { kind: "date", date: date.value } : null;
    }
    case "instant": {
      if (!hasExactKeys(value, ["kind", "instant"]) || typeof value["instant"] !== "string") {
        return null;
      }
      const instant = normalizeInstant(value["instant"]);
      return instant.ok ? { kind: "instant", instant: instant.value } : null;
    }
    case "status":
    case "select":
      return hasExactKeys(value, ["kind", "optionId"]) && isUuid(value["optionId"])
        ? { kind: value["kind"], optionId: value["optionId"] }
        : null;
    case "multi-select": {
      if (
        !hasExactKeys(value, ["kind", "optionIds"]) ||
        !Array.isArray(value["optionIds"]) ||
        !value["optionIds"].every(isUuid) ||
        new Set(value["optionIds"]).size !== value["optionIds"].length
      ) {
        return null;
      }
      return { kind: "multi-select", optionIds: [...value["optionIds"]].sort() };
    }
    case "checkbox":
      return hasExactKeys(value, ["kind", "checked"]) && typeof value["checked"] === "boolean"
        ? { kind: "checkbox", checked: value["checked"] }
        : null;
    default:
      return null;
  }
}

function parseValues(value: unknown): Readonly<Record<Uuid, NonRelationPropertyValue>> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([propertyId]) => !isUuid(propertyId))) return null;
  const normalized: Record<string, NonRelationPropertyValue> = {};
  for (const [propertyId, raw] of entries) {
    const parsed = parsePropertyValue(raw);
    if (parsed === null) return null;
    normalized[propertyId] = parsed;
  }
  return normalized as Readonly<Record<Uuid, NonRelationPropertyValue>>;
}

function parseRelationTargets(value: unknown): RelationTargets | null {
  if (!isRecord(value)) return null;
  const normalized: Record<string, readonly Uuid[]> = {};
  for (const [propertyId, rawTargets] of Object.entries(value)) {
    if (
      !isUuid(propertyId) ||
      !Array.isArray(rawTargets) ||
      !rawTargets.every(isUuid) ||
      new Set(rawTargets).size !== rawTargets.length
    ) {
      return null;
    }
    normalized[propertyId] = [...rawTargets].sort();
  }
  return normalized as RelationTargets;
}

function parseDefinition(value: unknown, databaseId: Uuid): DatabaseDefinition | null {
  if (!isRecord(value) || !Array.isArray(value["properties"]) || !Array.isArray(value["views"])) {
    return null;
  }
  try {
    const result = validateDatabaseDefinition(value as unknown as DatabaseDefinition);
    return result.ok && result.value.databaseId === databaseId ? result.value : null;
  } catch {
    return null;
  }
}

function parseImpactConfirmation(value: unknown): DatabaseImpactConfirmation | null {
  if (!isRecord(value) || !hasExactKeys(value, ["digest", "decision"])) return null;
  const decision = value["decision"];
  return typeof value["digest"] === "string" &&
    /^[a-f0-9]{64}$/.test(value["digest"]) &&
    (decision === "preserve-incompatible" || decision === "discard-confirmed")
    ? { digest: value["digest"], decision }
    : null;
}

function parseResolvedRevisionIds(value: unknown): readonly [Uuid, Uuid] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isUuid(value[0]) ||
    !isUuid(value[1]) ||
    value[0] === value[1]
  ) {
    return null;
  }
  return [value[0], value[1]];
}

/** Parses the feature-009 portion of the shared mutation vocabulary. */
export function parseDatabaseMutationCommand(
  commandType: DatabaseCommandType,
  payload: Payload,
): DomainResult<DatabaseMutationCommand> {
  switch (commandType) {
    case "database.create": {
      if (
        !hasExactKeys(
          payload,
          ["id", "name", "placement", "titlePropertyId", "initialViewId", "initialViewName"],
          ["titlePropertyName"],
        ) ||
        !isUuid(payload["id"]) ||
        !isUuid(payload["titlePropertyId"]) ||
        !isUuid(payload["initialViewId"]) ||
        typeof payload["name"] !== "string" ||
        typeof payload["initialViewName"] !== "string" ||
        (payload["titlePropertyName"] !== undefined &&
          typeof payload["titlePropertyName"] !== "string")
      ) {
        return invalid();
      }
      const name = normalizeDisplayName(payload["name"]);
      const titlePropertyName = normalizeDisplayName(payload["titlePropertyName"] ?? "Title");
      const initialViewName = normalizeDisplayName(payload["initialViewName"]);
      const placement = parsePlacement(payload["placement"]);
      if (!name.ok || !titlePropertyName.ok || !initialViewName.ok || placement === null) {
        return invalid();
      }
      return ok({
        type: commandType,
        id: payload["id"],
        name: name.value,
        placement,
        titlePropertyId: payload["titlePropertyId"],
        titlePropertyName: titlePropertyName.value,
        initialViewId: payload["initialViewId"],
        initialViewName: initialViewName.value,
      });
    }
    case "database.definition.replace": {
      if (
        !hasExactKeys(
          payload,
          ["databaseId", "baseRevisionId", "definition"],
          ["impactConfirmation"],
        ) ||
        !isUuid(payload["databaseId"]) ||
        !isUuid(payload["baseRevisionId"])
      ) {
        return invalid();
      }
      const definition = parseDefinition(payload["definition"], payload["databaseId"]);
      if (definition === null) return invalid();
      if (payload["impactConfirmation"] === undefined) {
        return ok({
          type: commandType,
          databaseId: payload["databaseId"],
          baseRevisionId: payload["baseRevisionId"],
          definition,
        });
      }
      const impactConfirmation = parseImpactConfirmation(payload["impactConfirmation"]);
      return impactConfirmation === null
        ? invalid()
        : ok({
            type: commandType,
            databaseId: payload["databaseId"],
            baseRevisionId: payload["baseRevisionId"],
            definition,
            impactConfirmation,
          });
    }
    case "database.definition.resolve-conflict": {
      if (
        !hasExactKeys(
          payload,
          ["databaseId", "resolvedRevisionIds", "definition"],
          ["impactConfirmation"],
        ) ||
        !isUuid(payload["databaseId"])
      ) {
        return invalid();
      }
      const resolvedRevisionIds = parseResolvedRevisionIds(payload["resolvedRevisionIds"]);
      const definition = parseDefinition(payload["definition"], payload["databaseId"]);
      if (resolvedRevisionIds === null || definition === null) return invalid();
      if (payload["impactConfirmation"] === undefined) {
        return ok({
          type: commandType,
          databaseId: payload["databaseId"],
          resolvedRevisionIds,
          definition,
        });
      }
      const impactConfirmation = parseImpactConfirmation(payload["impactConfirmation"]);
      return impactConfirmation === null
        ? invalid()
        : ok({
            type: commandType,
            databaseId: payload["databaseId"],
            resolvedRevisionIds,
            definition,
            impactConfirmation,
          });
    }
    case "database.entry.create": {
      if (
        !hasExactKeys(
          payload,
          ["databaseId", "id", "title", "placement", "values", "relationTargets"],
          ["document"],
        ) ||
        !isUuid(payload["databaseId"]) ||
        !isUuid(payload["id"]) ||
        typeof payload["title"] !== "string"
      ) {
        return invalid();
      }
      const title = normalizeDisplayName(payload["title"]);
      const placement = parsePlacement(payload["placement"]);
      const values = parseValues(payload["values"]);
      const relationTargets = parseRelationTargets(payload["relationTargets"]);
      const document =
        payload["document"] === undefined ? undefined : parseDocument(payload["document"]);
      if (!title.ok || placement === null || values === null || relationTargets === null) {
        return invalid();
      }
      if (document === null) return invalid();
      const command: DatabaseMutationCommand = {
        type: commandType,
        databaseId: payload["databaseId"],
        id: payload["id"],
        title: title.value,
        placement,
        ...(document === undefined ? {} : { document }),
        values,
        relationTargets,
      };
      return ok(command);
    }
    case "database.entry.values.replace": {
      if (
        !hasExactKeys(payload, [
          "databaseId",
          "entryId",
          "baseRevisionId",
          "values",
          "relationTargets",
        ]) ||
        !isUuid(payload["databaseId"]) ||
        !isUuid(payload["entryId"]) ||
        !isUuid(payload["baseRevisionId"])
      ) {
        return invalid();
      }
      const values = parseValues(payload["values"]);
      const relationTargets = parseRelationTargets(payload["relationTargets"]);
      return values === null || relationTargets === null
        ? invalid()
        : ok({
            type: commandType,
            databaseId: payload["databaseId"],
            entryId: payload["entryId"],
            baseRevisionId: payload["baseRevisionId"],
            values,
            relationTargets,
          });
    }
    case "database.entry.values.resolve-conflict": {
      if (
        !hasExactKeys(payload, [
          "databaseId",
          "entryId",
          "resolvedRevisionIds",
          "values",
          "relationTargets",
        ]) ||
        !isUuid(payload["databaseId"]) ||
        !isUuid(payload["entryId"])
      ) {
        return invalid();
      }
      const resolvedRevisionIds = parseResolvedRevisionIds(payload["resolvedRevisionIds"]);
      const values = parseValues(payload["values"]);
      const relationTargets = parseRelationTargets(payload["relationTargets"]);
      return resolvedRevisionIds === null || values === null || relationTargets === null
        ? invalid()
        : ok({
            type: commandType,
            databaseId: payload["databaseId"],
            entryId: payload["entryId"],
            resolvedRevisionIds,
            values,
            relationTargets,
          });
    }
  }
}
