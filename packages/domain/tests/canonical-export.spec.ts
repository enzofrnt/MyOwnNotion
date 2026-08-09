/**
 * Canonical export manifest construction and validation (T086, FR-023/FR-025).
 *
 * The manifest is deterministic so adapters can digest it, represents trashed
 * items completely with their deletion time and recovery deadline, and its
 * independent validator must actually detect every kind of incompleteness
 * (SC-005/SC-007).
 */

import {
  buildCanonicalExport,
  CANONICAL_EXPORT_FORMAT,
  CANONICAL_EXPORT_VERSION,
  canonicalExportString,
  type ExportedItem,
  generateUuidV7,
  type Placement,
  type Relationship,
  type RevisionHeader,
  type Uuid,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const workspaceId = generateUuidV7();
const EXPORTED_AT = "2026-08-09T12:00:00.000Z";

function placement(itemId: Uuid, parentItemId: Uuid | null, id = generateUuidV7()): Placement {
  return {
    id,
    workspaceId,
    itemId,
    itemKind: "page",
    kind: "hierarchy",
    parentItemId,
    positionKey: "V",
    removedAt: null,
  };
}

function item(overrides: Partial<ExportedItem> = {}): ExportedItem {
  const id = overrides.id ?? generateUuidV7();
  return {
    id,
    workspaceId,
    kind: "page",
    name: "Page",
    lifecycle: "active",
    trashedAt: null,
    purgeAfter: null,
    currentRevisionId: generateUuidV7(),
    pageDocument: null,
    file: null,
    placements: [placement(id, null)],
    ...overrides,
  };
}

function revisionFor(itemId: Uuid, id: Uuid, parentRevisionIds: Uuid[] = []): RevisionHeader {
  return {
    id,
    itemId,
    mutationId: generateUuidV7(),
    parentRevisionIds,
    acceptedAt: EXPORTED_AT,
  };
}

function relationshipBetween(
  source: Uuid,
  target: Uuid,
  createdRevisionId: Uuid,
): Relationship & { createdRevisionId: Uuid; removedRevisionId: Uuid | null } {
  return {
    id: generateUuidV7(),
    workspaceId,
    sourceItemId: source,
    targetItemId: target,
    relationType: "link:references",
    metadata: {},
    createdRevisionId,
    removedRevisionId: null,
  };
}

/** A complete, internally consistent fixture that must validate cleanly. */
function consistentFixture() {
  const first = item({ name: "First" });
  const second = item({ name: "Second" });
  const revisions = [
    revisionFor(first.id, first.currentRevisionId),
    revisionFor(second.id, second.currentRevisionId),
  ];
  return buildCanonicalExport({
    workspaceId,
    schemaVersion: 1,
    exportedAt: EXPORTED_AT,
    changeCursor: "seq:2",
    items: [first, second],
    relationships: [relationshipBetween(first.id, second.id, first.currentRevisionId)],
    revisions,
  });
}

describe("buildCanonicalExport", () => {
  it("stamps the documented format and version", () => {
    const manifest = consistentFixture();
    expect(manifest.format).toBe(CANONICAL_EXPORT_FORMAT);
    expect(manifest.formatVersion).toBe(CANONICAL_EXPORT_VERSION);
    expect(manifest.workspaceId).toBe(workspaceId);
    expect(manifest.changeCursor).toBe("seq:2");
  });

  it("sorts items, relationships, and revisions by identity for determinism", () => {
    const high = item({ id: "ffffffff-ffff-7fff-8fff-ffffffffffff" as Uuid });
    const low = item({ id: "00000000-0000-7000-8000-000000000000" as Uuid });
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [high, low],
      relationships: [],
      revisions: [],
    });
    expect(manifest.items.map((entry) => entry.id)).toEqual([low.id, high.id]);
  });

  it("sorts the placements of a multiply placed file", () => {
    const fileId = generateUuidV7();
    const high = placement(fileId, null, "ffffffff-ffff-7fff-8fff-ffffffffffff" as Uuid);
    const low = placement(fileId, null, "00000000-0000-7000-8000-000000000000" as Uuid);
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [item({ id: fileId, kind: "file", placements: [high, low] })],
      relationships: [],
      revisions: [],
    });
    expect(manifest.items[0]?.placements.map((entry) => entry.id)).toEqual([low.id, high.id]);
    expect(manifest.counts.placements).toBe(2);
  });

  it("counts active and trashed items separately", () => {
    const active = item({ lifecycle: "active" });
    const trashed = item({
      lifecycle: "trashed",
      trashedAt: EXPORTED_AT,
      purgeAfter: "2026-09-08T12:00:00.000Z",
    });
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [active, trashed],
      relationships: [],
      revisions: [],
    });
    expect(manifest.counts).toMatchObject({
      items: 2,
      activeItems: 1,
      trashedItems: 1,
      relationships: 0,
      revisions: 0,
    });
  });

  it("represents a trashed item with its deadline so backups stay complete", () => {
    const trashed = item({
      lifecycle: "trashed",
      trashedAt: EXPORTED_AT,
      purgeAfter: "2026-09-08T12:00:00.000Z",
    });
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [trashed],
      relationships: [],
      revisions: [revisionFor(trashed.id, trashed.currentRevisionId)],
    });
    expect(manifest.items[0]?.trashedAt).toBe(EXPORTED_AT);
    expect(manifest.items[0]?.purgeAfter).toBe("2026-09-08T12:00:00.000Z");
    expect(validateCanonicalExport(manifest)).toEqual([]);
  });
});

describe("canonicalExportString", () => {
  it("serializes the same state to the same string regardless of key order", () => {
    const manifest = consistentFixture();
    // Re-create the manifest object with its top-level keys reversed.
    const reordered = Object.fromEntries(Object.entries(manifest).reverse()) as typeof manifest;
    expect(canonicalExportString(reordered)).toBe(canonicalExportString(manifest));
  });

  it("produces parseable JSON with sorted keys", () => {
    const serialized = canonicalExportString(consistentFixture());
    const parsed = JSON.parse(serialized) as { format: string };
    expect(parsed.format).toBe(CANONICAL_EXPORT_FORMAT);
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });
});

describe("validateCanonicalExport", () => {
  it("reports no issues for a complete manifest", () => {
    expect(validateCanonicalExport(consistentFixture())).toEqual([]);
  });

  it("detects a mismatched item count", () => {
    const manifest = { ...consistentFixture() };
    const broken = { ...manifest, counts: { ...manifest.counts, items: 99 } };
    expect(validateCanonicalExport(broken).map((issue) => issue.code)).toContain("counts.items");
  });

  it("detects a mismatched relationship count", () => {
    const manifest = consistentFixture();
    const broken = { ...manifest, counts: { ...manifest.counts, relationships: 99 } };
    expect(validateCanonicalExport(broken).map((issue) => issue.code)).toContain(
      "counts.relationships",
    );
  });

  it("detects a mismatched revision count", () => {
    const manifest = consistentFixture();
    const broken = { ...manifest, counts: { ...manifest.counts, revisions: 99 } };
    expect(validateCanonicalExport(broken).map((issue) => issue.code)).toContain(
      "counts.revisions",
    );
  });

  it("detects an item whose current revision was not exported", () => {
    const orphan = item();
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [orphan],
      relationships: [],
      revisions: [], // the item's revision is missing
    });
    expect(validateCanonicalExport(manifest).map((issue) => issue.code)).toContain(
      "item.revision-missing",
    );
  });

  it("detects a trashed item missing its recovery metadata", () => {
    const trashed = item({ lifecycle: "trashed", trashedAt: null, purgeAfter: null });
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [trashed],
      relationships: [],
      revisions: [revisionFor(trashed.id, trashed.currentRevisionId)],
    });
    expect(validateCanonicalExport(manifest).map((issue) => issue.code)).toContain(
      "item.trash-metadata-missing",
    );
  });

  it("detects a placement whose parent was not exported", () => {
    const orphanId = generateUuidV7();
    const orphan = item({
      id: orphanId,
      placements: [placement(orphanId, generateUuidV7())], // parent never exported
    });
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [orphan],
      relationships: [],
      revisions: [revisionFor(orphan.id, orphan.currentRevisionId)],
    });
    expect(validateCanonicalExport(manifest).map((issue) => issue.code)).toContain(
      "placement.parent-missing",
    );
  });

  it("detects a relationship endpoint that was not exported", () => {
    const source = item();
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [source],
      relationships: [relationshipBetween(source.id, generateUuidV7(), source.currentRevisionId)],
      revisions: [revisionFor(source.id, source.currentRevisionId)],
    });
    expect(validateCanonicalExport(manifest).map((issue) => issue.code)).toContain(
      "relationship.endpoint-missing",
    );
  });

  it("detects a revision whose parent was not exported", () => {
    const only = item();
    const manifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [only],
      relationships: [],
      revisions: [revisionFor(only.id, only.currentRevisionId, [generateUuidV7()])],
    });
    expect(validateCanonicalExport(manifest).map((issue) => issue.code)).toContain(
      "revision.parent-missing",
    );
  });
});
