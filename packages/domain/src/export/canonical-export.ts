/**
 * Versioned canonical export and backup-input manifest (T086, FR-023/FR-025).
 *
 * The export is a documented, durable representation of the complete
 * canonical workspace — including items still inside their 30-day trash
 * window with their deletion time, recovery deadline, and lineage. The
 * manifest is deterministic: the same canonical state serializes to the same
 * canonical string, so adapters can digest and independently validate it.
 */

import type { CanonicalItem, PageDocument, Placement, Relationship } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";
import type { RevisionHeader } from "../revisions/types.ts";

export const CANONICAL_EXPORT_FORMAT = "myownnotion.export+json";
export const CANONICAL_EXPORT_VERSION = 1;

export interface ExportedItem extends CanonicalItem {
  readonly pageDocument: PageDocument | null;
  readonly file: {
    readonly mediaType: string;
    readonly originalName: string;
    readonly byteLength: number;
    readonly sha256: string;
  } | null;
  readonly placements: ReadonlyArray<Placement>;
}

export interface CanonicalExportManifest {
  readonly format: typeof CANONICAL_EXPORT_FORMAT;
  readonly formatVersion: typeof CANONICAL_EXPORT_VERSION;
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly changeCursor: string;
  readonly items: ReadonlyArray<ExportedItem>;
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
  };
}

export interface BuildExportInput {
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly changeCursor: string;
  readonly items: ReadonlyArray<ExportedItem>;
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

export function buildCanonicalExport(input: BuildExportInput): CanonicalExportManifest {
  // Purged items are represented only through revision headers and lifecycle
  // diagnostics; active and trashed items are exported completely (FR-025).
  const items = sortById(input.items).map((item) => ({
    ...item,
    placements: [...item.placements].sort((a, b) => (a.id < b.id ? -1 : 1)),
  }));
  const relationships = sortById(input.relationships);
  const revisions = sortById(input.revisions);
  return {
    format: CANONICAL_EXPORT_FORMAT,
    formatVersion: CANONICAL_EXPORT_VERSION,
    workspaceId: input.workspaceId,
    schemaVersion: input.schemaVersion,
    exportedAt: input.exportedAt,
    changeCursor: input.changeCursor,
    items,
    relationships,
    revisions,
    counts: {
      items: items.length,
      activeItems: items.filter((item) => item.lifecycle === "active").length,
      trashedItems: items.filter((item) => item.lifecycle === "trashed").length,
      placements: items.reduce((total, item) => total + item.placements.length, 0),
      relationships: relationships.length,
      revisions: revisions.length,
    },
  };
}

/** Deterministic serialization used for digests and independent validation. */
export function canonicalExportString(manifest: CanonicalExportManifest): string {
  return JSON.stringify(manifest, stableKeyOrder);
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

/**
 * Independent completeness validation (SC-005): every placement parent and
 * relationship endpoint must resolve to an exported item or be explicitly
 * diagnosable, and counts must match the actual arrays.
 */
export function validateCanonicalExport(
  manifest: CanonicalExportManifest,
): ExportValidationIssue[] {
  const issues: ExportValidationIssue[] = [];
  const itemIds = new Set(manifest.items.map((item) => item.id));
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

  for (const item of manifest.items) {
    if (!revisionIds.has(item.currentRevisionId)) {
      issues.push({
        code: "item.revision-missing",
        detail: `Item ${item.id} references missing revision ${item.currentRevisionId}`,
      });
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
    }
  }

  for (const relationship of manifest.relationships) {
    for (const endpoint of [relationship.sourceItemId, relationship.targetItemId]) {
      if (!itemIds.has(endpoint)) {
        issues.push({
          code: "relationship.endpoint-missing",
          detail: `Relationship ${relationship.id} references missing item ${endpoint}`,
        });
      }
    }
  }

  for (const revision of manifest.revisions) {
    for (const parent of revision.parentRevisionIds) {
      if (!revisionIds.has(parent)) {
        issues.push({
          code: "revision.parent-missing",
          detail: `Revision ${revision.id} references missing parent ${parent}`,
        });
      }
    }
  }

  return issues;
}
