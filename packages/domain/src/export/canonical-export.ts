/**
 * Versioned canonical export and backup-input manifest (T086, FR-023/FR-025).
 *
 * The export is a documented, durable representation of the complete
 * canonical workspace — including items still inside their 30-day trash
 * window with their deletion time, recovery deadline, and lineage. The
 * manifest is deterministic: the same canonical state serializes to the same
 * canonical string, so adapters can digest and independently validate it.
 */

import { validatePageDocument } from "../content/hierarchy.ts";
import { isValidPositionKey } from "../content/position-key.ts";
import { isValidRelationType } from "../content/relationships.ts";
import {
  type CanonicalItem,
  isProtectedContentPayload,
  type PageDocument,
  type Placement,
  type Relationship,
} from "../content/types.ts";
import { validateDatabaseDefinition } from "../databases/schema.ts";
import type { DatabaseDefinition, EntryValues } from "../databases/types.ts";
import {
  normalizeCivilDate,
  normalizeDecimal,
  normalizeInstant,
  normalizePropertyValue,
} from "../databases/values.ts";
import { validatePageDocumentEnvelopeV3 } from "../document/validate.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { RevisionHeader } from "../revisions/types.ts";

export const CANONICAL_EXPORT_FORMAT = "myownnotion.export+json";
export const CANONICAL_EXPORT_VERSION = 2;

export interface ExportedItem extends CanonicalItem {
  /** Per-installation choices needed to reproduce the owner's workspace. */
  readonly favourite: boolean;
  readonly offlineIntent: boolean;
  readonly pageDocument: PageDocument | null;
  readonly file: {
    readonly mediaType: string;
    readonly originalName: string;
    readonly byteLength: number;
    readonly sha256: string;
  } | null;
  readonly placements: ReadonlyArray<Placement>;
}

export interface ExportedDatabase {
  readonly databaseId: Uuid;
  readonly definitionRevisionId?: Uuid;
  readonly definitionVersion: number;
  readonly definition: DatabaseDefinition;
}

export interface ExportedDatabaseEntry {
  readonly entryId: Uuid;
  readonly databaseId: Uuid;
  readonly valueVersion: number;
  readonly addedRevisionId: Uuid;
  readonly values: EntryValues;
}

export interface CanonicalExportManifest {
  readonly format: typeof CANONICAL_EXPORT_FORMAT;
  readonly formatVersion: typeof CANONICAL_EXPORT_VERSION;
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly changeCursor: string;
  readonly items: ReadonlyArray<ExportedItem>;
  readonly databases: ReadonlyArray<ExportedDatabase>;
  readonly databaseEntries: ReadonlyArray<ExportedDatabaseEntry>;
  readonly relationships: ReadonlyArray<
    Relationship & {
      readonly createdRevisionId: Uuid;
      readonly removedRevisionId: Uuid | null;
    }
  >;
  readonly revisions: ReadonlyArray<RevisionHeader>;
  readonly counts: {
    readonly items: number;
    readonly activeItems: number;
    readonly trashedItems: number;
    readonly placements: number;
    readonly relationships: number;
    readonly revisions: number;
    readonly databases: number;
    readonly databaseEntries: number;
  };
}

export type LegacyCanonicalExportManifest = Omit<
  CanonicalExportManifest,
  "formatVersion" | "databases" | "databaseEntries" | "counts"
> & {
  readonly formatVersion: 1;
  readonly counts: Omit<CanonicalExportManifest["counts"], "databases" | "databaseEntries">;
};

export type AnyCanonicalExportManifest = CanonicalExportManifest | LegacyCanonicalExportManifest;

export interface BuildExportInput {
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly changeCursor: string;
  readonly items: ReadonlyArray<ExportedItem>;
  /** Optional only so pre-009 callers can build an empty structured projection. */
  readonly databases?: ReadonlyArray<ExportedDatabase>;
  readonly databaseEntries?: ReadonlyArray<ExportedDatabaseEntry>;
  readonly relationships: ReadonlyArray<
    Relationship & {
      readonly createdRevisionId: Uuid;
      readonly removedRevisionId: Uuid | null;
    }
  >;
  readonly revisions: ReadonlyArray<RevisionHeader>;
}

function sortById<T extends { readonly id: string }>(entries: ReadonlyArray<T>): T[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sortByKey<T>(entries: ReadonlyArray<T>, key: (entry: T) => string): T[] {
  return [...entries].sort((left, right) => key(left).localeCompare(key(right)));
}

export function buildCanonicalExport(input: BuildExportInput): CanonicalExportManifest {
  // Purged items carry neutral structural tombstones so retained journal owners
  // resolve during restore. Their names, documents, files and placements are absent.
  const items = sortById(input.items).map((item) => ({
    ...item,
    placements: [...item.placements].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }));
  const relationships = sortById(input.relationships);
  const revisions = sortById(input.revisions);
  const databases = sortByKey(input.databases ?? [], (database) => database.databaseId);
  const databaseEntries = sortByKey(input.databaseEntries ?? [], (entry) => entry.entryId);
  return {
    format: CANONICAL_EXPORT_FORMAT,
    formatVersion: CANONICAL_EXPORT_VERSION,
    workspaceId: input.workspaceId,
    schemaVersion: input.schemaVersion,
    exportedAt: input.exportedAt,
    changeCursor: input.changeCursor,
    items,
    databases,
    databaseEntries,
    relationships,
    revisions,
    counts: {
      items: items.length,
      activeItems: items.filter((item) => item.lifecycle === "active").length,
      trashedItems: items.filter((item) => item.lifecycle === "trashed").length,
      placements: items.reduce((total, item) => total + item.placements.length, 0),
      relationships: relationships.length,
      revisions: revisions.length,
      databases: databases.length,
      databaseEntries: databaseEntries.length,
    },
  };
}

/** Deterministic serialization used for digests and independent validation. */
export function canonicalExportString(manifest: CanonicalExportManifest): string {
  return JSON.stringify(manifest, stableKeyOrder);
}

/** Stable structured subset used by backup manifests for an independent digest. */
export function canonicalStructuredDataString(
  manifest: Pick<CanonicalExportManifest, "databases" | "databaseEntries">,
): string {
  return JSON.stringify(
    { databases: manifest.databases, databaseEntries: manifest.databaseEntries },
    stableKeyOrder,
  );
}

function stableKeyOrder(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

export interface ExportValidationIssue {
  readonly code: string;
  readonly detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIdentifier(value: unknown): value is string {
  return isUuid(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

const DATABASE_PROPERTY_TYPES_SET = new Set([
  "title",
  "text",
  "number",
  "date",
  "status",
  "select",
  "multi-select",
  "checkbox",
  "relation",
]);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(value).every((key) => expected.has(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validEntryPropertyValue(value: unknown): boolean {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  switch (value["kind"]) {
    case "text":
      return hasExactKeys(value, ["kind", "value"]) && typeof value["value"] === "string";
    case "number":
      return (
        hasExactKeys(value, ["kind", "decimal"]) &&
        typeof value["decimal"] === "string" &&
        normalizeDecimal(value["decimal"]).ok
      );
    case "date":
      return (
        hasExactKeys(value, ["kind", "date"]) &&
        typeof value["date"] === "string" &&
        normalizeCivilDate(value["date"]).ok
      );
    case "instant":
      return (
        hasExactKeys(value, ["kind", "instant"]) &&
        typeof value["instant"] === "string" &&
        normalizeInstant(value["instant"]).ok
      );
    case "status":
    case "select":
      return hasExactKeys(value, ["kind", "optionId"]) && isIdentifier(value["optionId"]);
    case "multi-select":
      return (
        hasExactKeys(value, ["kind", "optionIds"]) &&
        Array.isArray(value["optionIds"]) &&
        value["optionIds"].every(isIdentifier) &&
        new Set(value["optionIds"]).size === value["optionIds"].length
      );
    case "checkbox":
      return hasExactKeys(value, ["kind", "checked"]) && typeof value["checked"] === "boolean";
    default:
      return false;
  }
}

function validPreservedValue(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["propertyId", "sourceType", "value", "preservedAtRevisionId", "reason"]) &&
    isIdentifier(value["propertyId"]) &&
    typeof value["sourceType"] === "string" &&
    DATABASE_PROPERTY_TYPES_SET.has(value["sourceType"]) &&
    isIdentifier(value["preservedAtRevisionId"]) &&
    ["incompatible-conversion", "retired-property", "retired-option"].includes(
      String(value["reason"]),
    )
  );
}

function shapeIssue(code: string, detail: string): ExportValidationIssue {
  return { code: `shape.${code}`, detail };
}

function validateCanonicalShape(value: unknown): ExportValidationIssue[] {
  if (!isRecord(value)) return [shapeIssue("manifest", "Canonical export must be an object")];
  const issues: ExportValidationIssue[] = [];
  if (value["format"] !== CANONICAL_EXPORT_FORMAT)
    issues.push(shapeIssue("manifest", "Canonical export has an unsupported format"));
  const isLegacy = value["formatVersion"] === 1;
  const isCurrent = value["formatVersion"] === CANONICAL_EXPORT_VERSION;
  if (!isLegacy && !isCurrent)
    issues.push(shapeIssue("manifest", "Canonical export has an unsupported version"));
  for (const field of ["workspaceId", "exportedAt"] as const) {
    if (!isNonEmptyString(value[field]))
      issues.push(shapeIssue("manifest", `${field} is required`));
  }
  if (!isTimestamp(value["exportedAt"]))
    issues.push(shapeIssue("manifest", "exportedAt must be an RFC3339 timestamp"));
  if (typeof value["changeCursor"] !== "string")
    issues.push(shapeIssue("manifest", "changeCursor is required"));
  if (!isIdentifier(value["workspaceId"]))
    issues.push(shapeIssue("manifest", "workspaceId must be a UUID"));
  if (!isNonNegativeInteger(value["schemaVersion"]))
    issues.push(shapeIssue("manifest", "schemaVersion must be a non-negative integer"));
  const requiredArrays = isCurrent
    ? ["items", "databases", "databaseEntries", "relationships", "revisions"]
    : ["items", "relationships", "revisions"];
  for (const field of requiredArrays) {
    if (!Array.isArray(value[field]))
      issues.push(shapeIssue("manifest", `${field} must be an array`));
  }
  const counts = value["counts"];
  if (!isRecord(counts)) {
    issues.push(shapeIssue("counts", "counts must be an object"));
  } else {
    const requiredCounts = isCurrent
      ? [
          "items",
          "activeItems",
          "trashedItems",
          "placements",
          "relationships",
          "revisions",
          "databases",
          "databaseEntries",
        ]
      : ["items", "activeItems", "trashedItems", "placements", "relationships", "revisions"];
    for (const field of requiredCounts) {
      if (!isNonNegativeInteger(counts[field]))
        issues.push(shapeIssue("counts", `${field} must be a non-negative integer`));
    }
  }
  if (issues.length > 0) return issues;

  const items = value["items"] as unknown[];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      issues.push(shapeIssue("item", `items[${index}] must be an object`));
      continue;
    }
    const icon = item["icon"];
    const iconValid =
      isLegacy
        ? icon === undefined ||
          icon === null ||
          (typeof icon === "string" && icon.length >= 1 && icon.length <= 64)
        : icon === null ||
          (typeof icon === "string" && icon.length >= 1 && icon.length <= 64);
    if (
      !isIdentifier(item["id"]) ||
      !isIdentifier(item["workspaceId"]) ||
      !["page", "folder", "file"].includes(String(item["kind"])) ||
      !(
        typeof item["name"] === "string" &&
        item["name"].length >= 1 &&
        item["name"].length <= 512
      ) ||
      !iconValid ||
      (item["kind"] === "file" && icon !== null && icon !== undefined) ||
      !["active", "trashed", "purged"].includes(String(item["lifecycle"])) ||
      !(item["trashedAt"] === null || isTimestamp(item["trashedAt"])) ||
      !(item["purgeAfter"] === null || isTimestamp(item["purgeAfter"])) ||
      !isIdentifier(item["currentRevisionId"]) ||
      typeof item["favourite"] !== "boolean" ||
      typeof item["offlineIntent"] !== "boolean" ||
      !Array.isArray(item["placements"])
    ) {
      issues.push(shapeIssue("item", `items[${index}] is incomplete`));
      continue;
    }
    const pageDocument = item["pageDocument"];
    if (
      pageDocument !== null &&
      (!isRecord(pageDocument) ||
        !isNonEmptyString(pageDocument["format"]) ||
        !isNonNegativeInteger(pageDocument["formatVersion"]) ||
        !isRecord(pageDocument["body"]))
    ) {
      issues.push(shapeIssue("item", `items[${index}].pageDocument is invalid`));
    } else if (pageDocument !== null && !isProtectedContentPayload(pageDocument["body"])) {
      const pageDocumentValid =
        pageDocument["formatVersion"] === 3
          ? validatePageDocumentEnvelopeV3(pageDocument).ok
          : validatePageDocument(pageDocument as unknown as PageDocument).ok;
      if (!pageDocumentValid) {
        issues.push(shapeIssue("item", `items[${index}].pageDocument is not supported`));
      }
    }
    const file = item["file"];
    if (
      file !== null &&
      (!isRecord(file) ||
        !isNonEmptyString(file["mediaType"]) ||
        !isNonEmptyString(file["originalName"]) ||
        !isNonNegativeInteger(file["byteLength"]) ||
        typeof file["sha256"] !== "string" ||
        !/^[0-9a-f]{64}$/.test(file["sha256"]))
    ) {
      issues.push(shapeIssue("item", `items[${index}].file is invalid`));
    }
    if (
      (item["kind"] !== "file" && file !== null) ||
      (item["kind"] === "file" && item["lifecycle"] !== "purged" && file === null) ||
      (item["lifecycle"] === "purged" &&
        (file !== null || pageDocument !== null || (item["placements"] as unknown[]).length > 0))
    ) {
      issues.push(shapeIssue("item", `items[${index}] has inconsistent file or tombstone state`));
    }
    for (const [placementIndex, placement] of (item["placements"] as unknown[]).entries()) {
      if (
        !isRecord(placement) ||
        !isIdentifier(placement["id"]) ||
        !isIdentifier(placement["workspaceId"]) ||
        !isIdentifier(placement["itemId"]) ||
        typeof placement["itemIsFile"] !== "boolean" ||
        !["hierarchy", "attachment"].includes(String(placement["kind"])) ||
        !(placement["parentItemId"] === null || isIdentifier(placement["parentItemId"])) ||
        typeof placement["positionKey"] !== "string" ||
        !isValidPositionKey(placement["positionKey"]) ||
        placement["itemIsFile"] !== (item["kind"] === "file") ||
        (placement["kind"] === "attachment" && placement["parentItemId"] === null) ||
        !(placement["removedAt"] === null || isTimestamp(placement["removedAt"]))
      ) {
        issues.push(shapeIssue("item", `items[${index}].placements[${placementIndex}] is invalid`));
      }
    }
  }

  const revisions = value["revisions"] as unknown[];
  for (const [index, revision] of revisions.entries()) {
    if (
      !isRecord(revision) ||
      !isIdentifier(revision["id"]) ||
      !isIdentifier(revision["itemId"]) ||
      !isIdentifier(revision["mutationId"]) ||
      !Array.isArray(revision["parentRevisionIds"]) ||
      !(revision["parentRevisionIds"] as unknown[]).every(isIdentifier) ||
      !isTimestamp(revision["acceptedAt"]) ||
      !(
        revision["authoredByDeviceId"] === undefined ||
        revision["authoredByDeviceId"] === null ||
        isIdentifier(revision["authoredByDeviceId"])
      ) ||
      new Set(revision["parentRevisionIds"] as unknown[]).size !==
        (revision["parentRevisionIds"] as unknown[]).length
    ) {
      issues.push(shapeIssue("revision", `revisions[${index}] is incomplete`));
    }
  }

  const relationships = value["relationships"] as unknown[];
  for (const [index, relationship] of relationships.entries()) {
    if (
      !isRecord(relationship) ||
      !isIdentifier(relationship["id"]) ||
      !isIdentifier(relationship["workspaceId"]) ||
      !isIdentifier(relationship["sourceItemId"]) ||
      !isIdentifier(relationship["targetItemId"]) ||
      typeof relationship["relationType"] !== "string" ||
      !isValidRelationType(relationship["relationType"]) ||
      !isRecord(relationship["metadata"]) ||
      !isIdentifier(relationship["createdRevisionId"]) ||
      !(
        relationship["removedRevisionId"] === null ||
        isIdentifier(relationship["removedRevisionId"])
      )
    ) {
      issues.push(shapeIssue("relationship", `relationships[${index}] is incomplete`));
    }
  }

  const databases = (Array.isArray(value["databases"]) ? value["databases"] : []) as unknown[];
  for (const [index, database] of isCurrent ? databases.entries() : []) {
    const definition = isRecord(database) ? database["definition"] : undefined;
    if (
      !isRecord(database) ||
      !isIdentifier(database["databaseId"]) ||
      !isNonNegativeInteger(database["definitionVersion"]) ||
      !(
        database["definitionRevisionId"] === undefined ||
        isIdentifier(database["definitionRevisionId"])
      ) ||
      !isRecord(definition) ||
      !isNonEmptyString(definition["format"]) ||
      !isNonNegativeInteger(definition["formatVersion"]) ||
      !isIdentifier(definition["databaseId"]) ||
      !Array.isArray(definition["properties"]) ||
      !Array.isArray(definition["views"]) ||
      !(definition["taskRoles"] === null || isRecord(definition["taskRoles"]))
    ) {
      issues.push(shapeIssue("database", `databases[${index}] is incomplete`));
    } else {
      try {
        if (!validateDatabaseDefinition(definition as unknown as DatabaseDefinition).ok) {
          issues.push(shapeIssue("database", `databases[${index}].definition is invalid`));
        }
      } catch {
        issues.push(shapeIssue("database", `databases[${index}].definition is invalid`));
      }
    }
  }

  const entries = (
    Array.isArray(value["databaseEntries"]) ? value["databaseEntries"] : []
  ) as unknown[];
  for (const [index, entry] of isCurrent ? entries.entries() : []) {
    const values = isRecord(entry) ? entry["values"] : undefined;
    if (
      !isRecord(entry) ||
      !isIdentifier(entry["entryId"]) ||
      !isIdentifier(entry["databaseId"]) ||
      !isNonNegativeInteger(entry["valueVersion"]) ||
      !isIdentifier(entry["addedRevisionId"]) ||
      !isRecord(values) ||
      values["format"] !== "myownnotion.database-entry-values+json" ||
      values["formatVersion"] !== 1 ||
      !isIdentifier(values["databaseId"]) ||
      !isIdentifier(values["entryId"]) ||
      !isRecord(values["values"]) ||
      !Array.isArray(values["preserved"]) ||
      !(values["preserved"] as unknown[]).every(validPreservedValue)
    ) {
      issues.push(shapeIssue("database-entry", `databaseEntries[${index}] is incomplete`));
    } else {
      for (const [propertyId, propertyValue] of Object.entries(
        values["values"] as Record<string, unknown>,
      )) {
        if (!isIdentifier(propertyId) || !validEntryPropertyValue(propertyValue)) {
          issues.push(shapeIssue("database-entry", `databaseEntries[${index}].values is invalid`));
          break;
        }
      }
    }
  }
  return issues;
}

/**
 * Independent completeness validation (SC-005): every placement parent and
 * relationship endpoint must resolve to an exported item or be explicitly
 * diagnosable, and counts must match the actual arrays.
 */
export function validateCanonicalExport(
  manifest: AnyCanonicalExportManifest,
): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = validateCanonicalShape(manifest);
  if (issues.length > 0) return issues;
  const databases = "databases" in manifest ? manifest.databases : [];
  const databaseEntries = "databaseEntries" in manifest ? manifest.databaseEntries : [];
  const duplicateCodes: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["item.duplicate", manifest.items.map((item) => item.id)],
    ["revision.duplicate", manifest.revisions.map((revision) => revision.id)],
    ["relationship.duplicate", manifest.relationships.map((relationship) => relationship.id)],
    [
      "placement.duplicate",
      manifest.items.flatMap((item) => item.placements.map((placement) => placement.id)),
    ],
  ];
  for (const [code, ids] of duplicateCodes) {
    if (new Set(ids).size !== ids.length)
      issues.push({
        code,
        detail: `Canonical export contains duplicate ${code.split(".")[0]} IDs`,
      });
  }
  const itemIds = new Set(manifest.items.map((item) => item.id));
  const itemsById = new Map(manifest.items.map((item) => [item.id, item]));
  const revisionIds = new Set(manifest.revisions.map((revision) => revision.id));

  if (manifest.counts.items !== manifest.items.length) {
    issues.push({ code: "counts.items", detail: "Item count does not match items array" });
  }
  if (manifest.counts.relationships !== manifest.relationships.length) {
    issues.push({
      code: "counts.relationships",
      detail: "Relationship count does not match array",
    });
  }
  if (manifest.counts.revisions !== manifest.revisions.length) {
    issues.push({ code: "counts.revisions", detail: "Revision count does not match array" });
  }
  const expectedActiveItems = manifest.items.filter((item) => item.lifecycle === "active").length;
  const expectedTrashedItems = manifest.items.filter((item) => item.lifecycle === "trashed").length;
  const expectedPlacements = manifest.items.reduce(
    (total, item) => total + item.placements.length,
    0,
  );
  if (manifest.counts.activeItems !== expectedActiveItems)
    issues.push({ code: "counts.active-items", detail: "Active item count does not match items" });
  if (manifest.counts.trashedItems !== expectedTrashedItems)
    issues.push({
      code: "counts.trashed-items",
      detail: "Trashed item count does not match items",
    });
  if (manifest.counts.placements !== expectedPlacements)
    issues.push({ code: "counts.placements", detail: "Placement count does not match items" });
  if ("databases" in manifest && manifest.counts.databases !== databases.length) {
    issues.push({ code: "counts.databases", detail: "Database count does not match array" });
  }
  if ("databaseEntries" in manifest && manifest.counts.databaseEntries !== databaseEntries.length) {
    issues.push({
      code: "counts.database-entries",
      detail: "Database entry count does not match array",
    });
  }

  for (const item of manifest.items) {
    if (item.workspaceId !== manifest.workspaceId) {
      issues.push({
        code: "item.workspace-mismatch",
        detail: `Item ${item.id} belongs to another workspace`,
      });
    }
    if (!revisionIds.has(item.currentRevisionId)) {
      issues.push({
        code: "item.revision-missing",
        detail: `Item ${item.id} references missing revision ${item.currentRevisionId}`,
      });
    }
    const currentRevision = manifest.revisions.find(
      (revision) => revision.id === item.currentRevisionId,
    );
    if (currentRevision !== undefined && currentRevision.itemId !== item.id) {
      issues.push({
        code: "item.revision-item-mismatch",
        detail: `Item ${item.id} names a revision owned by ${currentRevision.itemId}`,
      });
    }
    for (const placement of item.placements) {
      if (placement.workspaceId !== manifest.workspaceId) {
        issues.push({
          code: "placement.workspace-mismatch",
          detail: `Placement ${placement.id} belongs to another workspace`,
        });
      }
      if (placement.itemId !== item.id) {
        issues.push({
          code: "placement.item-mismatch",
          detail: `Placement ${placement.id} names item ${placement.itemId} instead of ${item.id}`,
        });
      }
    }
    if (item.lifecycle === "trashed" && (item.trashedAt === null || item.purgeAfter === null)) {
      issues.push({
        code: "item.trash-metadata-missing",
        detail: `Trashed item ${item.id} lacks deletion time or recovery deadline`,
      });
    }
    for (const placement of item.placements) {
      if (placement.parentItemId !== null && !itemIds.has(placement.parentItemId)) {
        issues.push({
          code: "placement.parent-missing",
          detail: `Placement ${placement.id} references missing parent ${placement.parentItemId}`,
        });
      }
      if (placement.parentItemId !== null) {
        const parent = itemsById.get(placement.parentItemId);
        if (parent !== undefined) {
          if (placement.kind === "attachment" && parent.kind !== "page") {
            issues.push({
              code: "placement.attachment-parent-kind",
              detail: `Attachment ${placement.id} must be owned by a page`,
            });
          }
          if (placement.kind === "hierarchy" && parent.kind === "file") {
            issues.push({
              code: "placement.hierarchy-parent-kind",
              detail: `Hierarchy placement ${placement.id} cannot be owned by a file`,
            });
          }
        }
      }
    }
    if (
      item.kind !== "file" &&
      item.placements.filter((placement) => placement.kind === "hierarchy").length > 1
    ) {
      issues.push({
        code: "placement.hierarchy-duplicate",
        detail: `Item ${item.id} has more than one hierarchy placement`,
      });
    }
  }

  for (const relationship of manifest.relationships) {
    if (relationship.workspaceId !== manifest.workspaceId) {
      issues.push({
        code: "relationship.workspace-mismatch",
        detail: `Relationship ${relationship.id} belongs to another workspace`,
      });
    }
    for (const endpoint of [relationship.sourceItemId, relationship.targetItemId]) {
      if (!itemIds.has(endpoint)) {
        issues.push({
          code: "relationship.endpoint-missing",
          detail: `Relationship ${relationship.id} references missing item ${endpoint}`,
        });
      }
    }
    if (!revisionIds.has(relationship.createdRevisionId)) {
      issues.push({
        code: "relationship.revision-missing",
        detail: `Relationship ${relationship.id} references missing creation revision`,
      });
    }
    const createdRevision = manifest.revisions.find(
      (revision) => revision.id === relationship.createdRevisionId,
    );
    if (createdRevision !== undefined && createdRevision.itemId !== relationship.sourceItemId) {
      issues.push({
        code: "relationship.revision-owner-mismatch",
        detail: `Relationship ${relationship.id} creation revision belongs to another item`,
      });
    }
    if (
      relationship.removedRevisionId !== null &&
      !revisionIds.has(relationship.removedRevisionId)
    ) {
      issues.push({
        code: "relationship.revision-missing",
        detail: `Relationship ${relationship.id} references missing removal revision`,
      });
    }
    const removedRevision = manifest.revisions.find(
      (revision) => revision.id === relationship.removedRevisionId,
    );
    if (removedRevision !== undefined && removedRevision.itemId !== relationship.sourceItemId) {
      issues.push({
        code: "relationship.revision-owner-mismatch",
        detail: `Relationship ${relationship.id} removal revision belongs to another item`,
      });
    }
  }

  const databaseIds = new Set<Uuid>();
  for (const database of databases) {
    if (databaseIds.has(database.databaseId)) {
      issues.push({
        code: "database.duplicate",
        detail: `Database ${database.databaseId} is listed more than once`,
      });
    }
    databaseIds.add(database.databaseId);
    if (!itemIds.has(database.databaseId)) {
      issues.push({
        code: "database.item-missing",
        detail: `Database ${database.databaseId} has no exported host page`,
      });
    }
    if (
      database.definitionRevisionId !== undefined &&
      !revisionIds.has(database.definitionRevisionId)
    )
      issues.push({
        code: "database.revision-missing",
        detail: "Database source revision is missing",
      });
    const definitionRevision = manifest.revisions.find(
      (revision) => revision.id === database.definitionRevisionId,
    );
    if (definitionRevision !== undefined && definitionRevision.itemId !== database.databaseId) {
      issues.push({
        code: "database.revision-owner-mismatch",
        detail: `Database ${database.databaseId} source revision belongs to another item`,
      });
    }
    if (database.definition.databaseId !== database.databaseId) {
      issues.push({
        code: "database.definition-identity",
        detail: `Database ${database.databaseId} carries a mismatched definition`,
      });
    }
  }
  const databasesById = new Map(databases.map((database) => [database.databaseId, database]));

  const entryIds = new Set<Uuid>();
  for (const entry of databaseEntries) {
    if (entryIds.has(entry.entryId)) {
      issues.push({
        code: "database-entry.duplicate",
        detail: `Database entry ${entry.entryId} is listed more than once`,
      });
    }
    entryIds.add(entry.entryId);
    if (!itemIds.has(entry.entryId)) {
      issues.push({
        code: "database-entry.item-missing",
        detail: `Database entry ${entry.entryId} has no exported page`,
      });
    }
    if (!databaseIds.has(entry.databaseId)) {
      issues.push({
        code: "database-entry.database-missing",
        detail: `Database entry ${entry.entryId} references missing database ${entry.databaseId}`,
      });
    }
    if (!revisionIds.has(entry.addedRevisionId)) {
      issues.push({
        code: "database-entry.revision-missing",
        detail: `Database entry ${entry.entryId} references missing revision ${entry.addedRevisionId}`,
      });
    }
    const addedRevision = manifest.revisions.find(
      (revision) => revision.id === entry.addedRevisionId,
    );
    if (addedRevision !== undefined && addedRevision.itemId !== entry.entryId) {
      issues.push({
        code: "database-entry.revision-owner-mismatch",
        detail: `Database entry ${entry.entryId} added revision belongs to another item`,
      });
    }
    if (entry.values.entryId !== entry.entryId || entry.values.databaseId !== entry.databaseId) {
      issues.push({
        code: "database-entry.values-identity",
        detail: `Database entry ${entry.entryId} carries mismatched values`,
      });
    }
    const database = databasesById.get(entry.databaseId);
    if (database !== undefined) {
      for (const [propertyId, value] of Object.entries(entry.values.values)) {
        const property = database.definition.properties.find(
          (candidate) => candidate.id === propertyId,
        );
        if (
          property === undefined ||
          !normalizePropertyValue(property, value, { intent: "decode" }).ok
        ) {
          issues.push({
            code: "database-entry.value-invalid",
            detail: `Database entry ${entry.entryId} contains a value incompatible with its definition`,
          });
        }
      }
      for (const preserved of entry.values.preserved) {
        if (
          !database.definition.properties.some((property) => property.id === preserved.propertyId)
        ) {
          issues.push({
            code: "database-entry.preserved-property-missing",
            detail: `Database entry ${entry.entryId} preserves an unknown property`,
          });
        }
      }
    }
  }

  for (const revision of manifest.revisions) {
    if (!itemIds.has(revision.itemId)) {
      issues.push({
        code: "revision.item-missing",
        detail: `Revision ${revision.id} references missing item ${revision.itemId}`,
      });
    }
    for (const parent of revision.parentRevisionIds) {
      if (!revisionIds.has(parent)) {
        issues.push({
          code: "revision.parent-missing",
          detail: `Revision ${revision.id} references missing parent ${parent}`,
        });
      }
      const parentRevision = manifest.revisions.find((candidate) => candidate.id === parent);
      if (parentRevision !== undefined && parentRevision.itemId !== revision.itemId) {
        issues.push({
          code: "revision.parent-owner-mismatch",
          detail: `Revision ${revision.id} has a parent owned by another item`,
        });
      }
    }
  }

  return issues;
}
