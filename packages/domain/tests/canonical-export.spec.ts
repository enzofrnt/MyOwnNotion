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
    itemIsFile: false,
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
    icon: null,
    lifecycle: "active",
    trashedAt: null,
    purgeAfter: null,
    currentRevisionId: generateUuidV7(),
    favourite: false,
    offlineIntent: false,
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 1,
      body: {},
    },
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

function structuredFixture() {
  const host = item({ name: "Database host" });
  const entry = item({ name: "Entry" });
  const titlePropertyId = generateUuidV7();
  const viewId = generateUuidV7();
  return buildCanonicalExport({
    workspaceId,
    schemaVersion: 1,
    exportedAt: EXPORTED_AT,
    changeCursor: "seq:4",
    items: [host, entry],
    databases: [
      {
        databaseId: host.id,
        definitionVersion: 2,
        definition: {
          format: "myownnotion.database-definition+json",
          formatVersion: 1,
          databaseId: host.id,
          properties: [
            {
              id: titlePropertyId,
              name: "Title",
              type: "title",
              positionKey: "a",
              state: "active",
              config: {},
            },
          ],
          views: [
            {
              id: viewId,
              name: "Table",
              type: "table",
              positionKey: "a",
              state: "active",
              properties: [{ propertyId: titlePropertyId, visible: true, positionKey: "a" }],
              filter: { mode: "all", criteria: [] },
              sorts: [],
              group: null,
              options: { density: "comfortable", freezeTitle: true },
            },
          ],
          taskRoles: null,
        },
      },
    ],
    databaseEntries: [
      {
        entryId: entry.id,
        databaseId: host.id,
        valueVersion: 1,
        addedRevisionId: entry.currentRevisionId,
        values: {
          format: "myownnotion.database-entry-values+json",
          formatVersion: 1,
          databaseId: host.id,
          entryId: entry.id,
          values: {},
          preserved: [],
        },
      },
    ],
    relationships: [],
    revisions: [
      revisionFor(host.id, host.currentRevisionId),
      revisionFor(entry.id, entry.currentRevisionId),
    ],
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

  it("sorts and counts structured databases and entries", () => {
    const manifest = structuredFixture();
    expect(manifest.counts).toMatchObject({ databases: 1, databaseEntries: 1 });
    expect(validateCanonicalExport(manifest)).toEqual([]);
  });

  it("accepts the historical V1 canonical shape without structured records", () => {
    const current = structuredFixture();
    const { databases: _databases, databaseEntries: _entries, counts, ...legacy } = current;
    const v1 = {
      ...legacy,
      formatVersion: 1,
      counts: {
        items: counts.items,
        activeItems: counts.activeItems,
        trashedItems: counts.trashedItems,
        placements: counts.placements,
        relationships: counts.relationships,
        revisions: counts.revisions,
      },
    };
    expect(validateCanonicalExport(v1 as never)).toEqual([]);
  });

  it("accepts a historical V1 item whose icon field was not exported", () => {
    const current = consistentFixture();
    const { databases: _databases, databaseEntries: _entries, counts, ...legacy } = current;
    const v1 = {
      ...legacy,
      formatVersion: 1,
      items: current.items.map((entry) => {
        const withoutIcon = { ...entry } as Record<string, unknown>;
        delete withoutIcon["icon"];
        return withoutIcon;
      }),
      counts: {
        items: counts.items,
        activeItems: counts.activeItems,
        trashedItems: counts.trashedItems,
        placements: counts.placements,
        relationships: counts.relationships,
        revisions: counts.revisions,
      },
    };
    expect(validateCanonicalExport(v1 as never)).toEqual([]);
  });

  it("keeps the icon field mandatory for V2 canonical exports", () => {
    const current = consistentFixture();
    const v2 = {
      ...current,
      items: current.items.map((entry) => {
        const withoutIcon = { ...entry } as Record<string, unknown>;
        delete withoutIcon["icon"];
        return withoutIcon;
      }),
    };
    expect(validateCanonicalExport(v2 as never).map((issue) => issue.code)).toContain("shape.item");
  });

  it("rejects item, placement and relationship values that violate storage constraints", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const relationship = manifest.relationships[0];
    if (first === undefined || relationship === undefined) throw new Error("fixture missing");
    const invalidItem = {
      ...manifest,
      items: [
        {
          ...first,
          kind: "page",
          name: "x".repeat(513),
          icon: "x".repeat(65),
          placements: [{ ...first.placements[0], positionKey: "x".repeat(256) }],
        },
        ...manifest.items.slice(1),
      ],
    };
    expect(validateCanonicalExport(invalidItem as never).map((issue) => issue.code)).toContain(
      "shape.item",
    );
    const invalidRelationship = {
      ...manifest,
      relationships: [{ ...relationship, relationType: "invalid" }],
    };
    expect(
      validateCanonicalExport(invalidRelationship as never).map((issue) => issue.code),
    ).toContain("shape.relationship");
  });

  it("rejects an attachment owned by a non-page and duplicate hierarchy placement", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const second = manifest.items[1];
    if (first === undefined || second === undefined) throw new Error("fixture missing");
    const invalid = {
      ...manifest,
      items: manifest.items.map((item) =>
        item.id === first.id
          ? {
              ...item,
              kind: "file",
              pageDocument: null,
              file: {
                mediaType: "text/plain",
                originalName: "file.txt",
                byteLength: 0,
                sha256: "0".repeat(64),
              },
              placements: [
                {
                  ...item.placements[0],
                  kind: "attachment",
                  itemIsFile: true,
                  parentItemId: second.id,
                },
                {
                  ...item.placements[0],
                  id: generateUuidV7(),
                  kind: "hierarchy",
                  itemIsFile: true,
                },
              ],
            }
          : item.id === second.id
            ? { ...item, kind: "folder", pageDocument: null }
            : item,
      ),
    };
    const codes = validateCanonicalExport(invalid as never).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["placement.attachment-parent-kind"]));
  });

  it("rejects removed placements and invalid active placement cardinality", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    if (first === undefined) throw new Error("fixture missing");
    const removed = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id
          ? { ...entry, placements: [{ ...entry.placements[0], removedAt: EXPORTED_AT }] }
          : entry,
      ),
    };
    expect(validateCanonicalExport(removed as never).map((issue) => issue.code)).toContain(
      "shape.item",
    );

    const orphaned = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id ? { ...entry, placements: [] } : entry,
      ),
    };
    expect(validateCanonicalExport(orphaned as never).map((issue) => issue.code)).toContain(
      "placement.cardinality",
    );

    const file = item({
      kind: "file",
      pageDocument: null,
      file: {
        mediaType: "text/plain",
        originalName: "file.txt",
        byteLength: 0,
        sha256: "0".repeat(64),
      },
      placements: [],
    });
    const fileManifest = buildCanonicalExport({
      workspaceId,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      changeCursor: "",
      items: [file],
      relationships: [],
      revisions: [revisionFor(file.id, file.currentRevisionId)],
    });
    expect(validateCanonicalExport(fileManifest).map((issue) => issue.code)).toContain(
      "placement.cardinality",
    );
  });

  it("keeps page documents limited to pages and preserves lifecycle nullability", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    if (first === undefined) throw new Error("fixture missing");
    const missingPageDocument = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id ? { ...entry, pageDocument: null } : entry,
      ),
    };
    expect(
      validateCanonicalExport(missingPageDocument as never).map((issue) => issue.code),
    ).toContain("shape.item");

    const folderDocument = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id ? { ...entry, kind: "folder", pageDocument: null } : entry,
      ),
    };
    expect(validateCanonicalExport(folderDocument as never)).toEqual([]);

    const withFolderDocument = {
      ...folderDocument,
      items: folderDocument.items.map((entry) =>
        entry.id === first.id ? { ...entry, pageDocument: first.pageDocument } : entry,
      ),
    };
    expect(
      validateCanonicalExport(withFolderDocument as never).map((issue) => issue.code),
    ).toContain("shape.item");

    const purged = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id
          ? {
              ...entry,
              lifecycle: "purged",
              pageDocument: null,
              file: null,
              placements: [],
            }
          : entry,
      ),
      counts: { ...manifest.counts, activeItems: 1, placements: 1 },
    };
    expect(validateCanonicalExport(purged as never)).toEqual([]);
  });

  it("rejects an attachment on a non-file item", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const second = manifest.items[1];
    if (first === undefined || second === undefined) throw new Error("fixture missing");
    const invalid = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id
          ? {
              ...entry,
              placements: [
                {
                  ...entry.placements[0],
                  kind: "attachment",
                  parentItemId: second.id,
                },
              ],
            }
          : entry,
      ),
    };
    expect(validateCanonicalExport(invalid as never).map((issue) => issue.code)).toContain(
      "shape.item",
    );
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

  it("rejects cycles in the item hierarchy", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const second = manifest.items[1];
    if (first === undefined || second === undefined) throw new Error("fixture missing");
    const cyclic = {
      ...manifest,
      items: manifest.items.map((entry) =>
        entry.id === first.id
          ? {
              ...entry,
              placements: [{ ...entry.placements[0], parentItemId: second.id }],
            }
          : entry.id === second.id
            ? {
                ...entry,
                placements: [{ ...entry.placements[0], parentItemId: first.id }],
              }
            : entry,
      ),
    };
    expect(validateCanonicalExport(cyclic as never).map((issue) => issue.code)).toContain(
      "placement.hierarchy-cycle",
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

  it("rejects cycles in revision lineage", () => {
    const manifest = consistentFixture();
    const firstRevision = manifest.revisions[0];
    if (firstRevision === undefined) throw new Error("fixture missing revision");
    const secondRevisionId = generateUuidV7();
    const cyclic = {
      ...manifest,
      revisions: [
        ...manifest.revisions.map((revision) =>
          revision.id === firstRevision.id
            ? { ...revision, parentRevisionIds: [secondRevisionId] }
            : revision,
        ),
        {
          ...firstRevision,
          id: secondRevisionId,
          parentRevisionIds: [firstRevision.id],
        },
      ],
      counts: { ...manifest.counts, revisions: manifest.counts.revisions + 1 },
    };
    expect(validateCanonicalExport(cyclic).map((issue) => issue.code)).toContain("revision.cycle");
  });

  it("detects structured count and identity mismatches", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const broken = {
      ...manifest,
      databases: [
        {
          ...database,
          definition: { ...database.definition, databaseId: generateUuidV7() },
        },
      ],
      databaseEntries: [
        {
          ...entry,
          databaseId: generateUuidV7(),
          values: { ...entry.values, entryId: generateUuidV7() },
        },
      ],
      counts: { ...manifest.counts, databaseEntries: 99 },
    };
    const codes = validateCanonicalExport(broken).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "counts.database-entries",
        "database.definition-identity",
        "database-entry.database-missing",
        "database-entry.values-identity",
      ]),
    );
  });

  it("requires database hosts and entries to be pages and forbids self-entry", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");

    const hostFolder = {
      ...manifest,
      items: manifest.items.map((item) =>
        item.id === database.databaseId ? { ...item, kind: "folder", pageDocument: null } : item,
      ),
    };
    expect(validateCanonicalExport(hostFolder as never).map((issue) => issue.code)).toContain(
      "database.host-kind",
    );

    const entryFolder = {
      ...manifest,
      items: manifest.items.map((item) =>
        item.id === entry.entryId ? { ...item, kind: "folder", pageDocument: null } : item,
      ),
    };
    expect(validateCanonicalExport(entryFolder as never).map((issue) => issue.code)).toContain(
      "database-entry.item-kind",
    );

    const selfEntry = {
      ...manifest,
      databaseEntries: [
        {
          ...entry,
          entryId: database.databaseId,
          values: { ...entry.values, entryId: database.databaseId },
        },
      ],
    };
    expect(validateCanonicalExport(selfEntry as never).map((issue) => issue.code)).toContain(
      "database-entry.self",
    );
  });

  it.each([
    [
      "item",
      (manifest: ReturnType<typeof consistentFixture>) => ({
        ...manifest,
        items: [
          {
            id: manifest.items[0]?.id,
            currentRevisionId: manifest.items[0]?.currentRevisionId,
            placements: [],
          },
        ],
      }),
    ],
    [
      "revision",
      (manifest: ReturnType<typeof consistentFixture>) => ({
        ...manifest,
        revisions: [{ ...manifest.revisions[0], parentRevisionIds: undefined }],
      }),
    ],
    [
      "relationship",
      (manifest: ReturnType<typeof consistentFixture>) => ({
        ...manifest,
        relationships: [{ ...manifest.relationships[0], metadata: undefined }],
      }),
    ],
  ] as const)("rejects an under-specified %s before graph checks", (_kind, buildBroken) => {
    const broken = buildBroken(consistentFixture());
    expect(validateCanonicalExport(broken as never).map((issue) => issue.code)).toContain(
      `shape.${_kind}`,
    );
  });

  it("rejects under-specified database definitions and entries", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const broken = {
      ...manifest,
      databases: [{ ...database, definition: undefined }],
      databaseEntries: [{ ...entry, values: undefined }],
    };
    const codes = validateCanonicalExport(broken as never).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["shape.database", "shape.database-entry"]));
  });

  it("rejects malformed nested database properties, views and values", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const broken = {
      ...manifest,
      databases: [
        {
          ...database,
          definition: {
            ...database.definition,
            properties: [{ ...database.definition.properties[0], name: "" }],
            views: [{ ...database.definition.views[0], name: "" }],
          },
        },
      ],
      databaseEntries: [
        {
          ...entry,
          values: { ...entry.values, values: { [generateUuidV7()]: { kind: "text" } } },
        },
      ],
    };
    const codes = validateCanonicalExport(broken as never).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["shape.database", "shape.database-entry"]));
  });

  it("rejects duplicate identities and invalid timestamps", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const revision = manifest.revisions[0];
    if (first === undefined || revision === undefined) throw new Error("fixture missing");
    const duplicate = {
      ...manifest,
      items: [{ ...first, currentRevisionId: revision.id }, { ...first }],
      revisions: [revision, ...manifest.revisions],
    };
    const duplicateCodes = validateCanonicalExport(duplicate as never).map((issue) => issue.code);
    expect(duplicateCodes).toEqual(
      expect.arrayContaining(["item.duplicate", "revision.duplicate"]),
    );
    const invalidTimestamp = {
      ...manifest,
      revisions: [{ ...revision, acceptedAt: "not-a-timestamp" }, ...manifest.revisions.slice(1)],
    };
    expect(validateCanonicalExport(invalidTimestamp as never).map((issue) => issue.code)).toContain(
      "shape.revision",
    );
  });

  it("rejects invalid export timestamps, workspaces, kinds and preserved values", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const broken = {
      ...manifest,
      exportedAt: "2026-08-09",
      items: [{ ...manifest.items[0], workspaceId: generateUuidV7(), kind: "evil" }],
      databases: [{ ...database, definitionRevisionId: "not-a-uuid" }],
      databaseEntries: [
        {
          ...entry,
          values: {
            ...entry.values,
            preserved: [
              {
                propertyId: generateUuidV7(),
                sourceType: "evil",
                value: null,
                preservedAtRevisionId: "not-a-uuid",
                reason: "unknown",
              },
            ],
            values: {
              [generateUuidV7()]: { kind: "evil", value: true },
            },
          },
        },
      ],
    };
    expect(validateCanonicalExport(broken as never).map((issue) => issue.code)).toContain(
      "shape.manifest",
    );
    const nestedBroken = { ...broken, exportedAt: EXPORTED_AT };
    const nestedCodes = validateCanonicalExport(nestedBroken as never).map((issue) => issue.code);
    expect(nestedCodes).toEqual(
      expect.arrayContaining(["shape.item", "shape.database", "shape.database-entry"]),
    );
  });

  it("rejects lineage references owned by another item and duplicate parents", () => {
    const manifest = consistentFixture();
    const first = manifest.items[0];
    const second = manifest.items[1];
    const firstRevision = manifest.revisions.find((revision) => revision.itemId === first?.id);
    const secondRevision = manifest.revisions.find((revision) => revision.itemId === second?.id);
    if (
      first === undefined ||
      second === undefined ||
      firstRevision === undefined ||
      secondRevision === undefined
    ) {
      throw new Error("fixture missing");
    }
    const duplicateParents = {
      ...manifest,
      revisions: [
        { ...firstRevision, parentRevisionIds: [secondRevision.id, secondRevision.id] },
        ...manifest.revisions.filter((revision) => revision.id !== firstRevision.id),
      ],
    };
    expect(validateCanonicalExport(duplicateParents as never).map((issue) => issue.code)).toContain(
      "shape.revision",
    );
    const broken = {
      ...manifest,
      items: manifest.items.map((item) =>
        item.id === first.id ? { ...item, workspaceId: generateUuidV7() } : item,
      ),
      relationships: [
        {
          ...manifest.relationships[0],
          createdRevisionId: secondRevision.id,
          removedRevisionId: secondRevision.id,
        },
      ],
    };
    const codes = validateCanonicalExport(broken as never).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining(["item.workspace-mismatch", "relationship.revision-owner-mismatch"]),
    );
  });

  it("rejects definition and entry revisions owned by another item", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const revisions = manifest.revisions;
    const databaseRevision = revisions.find((revision) => revision.itemId === entry.entryId);
    const entryRevision = revisions.find((revision) => revision.itemId === database.databaseId);
    if (databaseRevision === undefined || entryRevision === undefined)
      throw new Error("fixture missing revision");
    const broken = {
      ...manifest,
      databases: [{ ...database, definitionRevisionId: databaseRevision.id }],
      databaseEntries: [{ ...entry, addedRevisionId: entryRevision.id }],
    };
    const codes = validateCanonicalExport(broken as never).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "database.revision-owner-mismatch",
        "database-entry.revision-owner-mismatch",
      ]),
    );
  });

  it("rejects non-canonical entry envelopes and values outside their definition", () => {
    const manifest = structuredFixture();
    const database = manifest.databases[0];
    const entry = manifest.databaseEntries[0];
    if (database === undefined || entry === undefined) throw new Error("fixture missing");
    const textPropertyId = generateUuidV7();
    const numberPropertyId = generateUuidV7();
    const broken = {
      ...manifest,
      databases: [
        {
          ...database,
          definition: {
            ...database.definition,
            properties: [
              ...database.definition.properties,
              {
                id: textPropertyId,
                name: "Text",
                type: "text",
                positionKey: "b",
                state: "active",
                config: {},
              },
              {
                id: numberPropertyId,
                name: "Number",
                type: "number",
                positionKey: "c",
                state: "active",
                config: {},
              },
            ],
          },
        },
      ],
      databaseEntries: [
        {
          ...entry,
          values: {
            ...entry.values,
            format: "evil",
            formatVersion: 2,
            values: {
              [numberPropertyId]: { kind: "number", decimal: "not-a-number" },
            },
            preserved: [{ propertyId: textPropertyId, reason: "retired-property" }],
          },
        },
      ],
    };
    expect(validateCanonicalExport(broken as never).map((issue) => issue.code)).toContain(
      "shape.database-entry",
    );

    const malformedValue = {
      ...broken,
      databaseEntries: [
        {
          ...entry,
          values: {
            ...entry.values,
            values: {
              [generateUuidV7()]: { kind: "text", value: "unknown property" },
            },
            preserved: [],
          },
        },
      ],
    };
    expect(validateCanonicalExport(malformedValue as never).map((issue) => issue.code)).toContain(
      "database-entry.value-invalid",
    );
  });
});
