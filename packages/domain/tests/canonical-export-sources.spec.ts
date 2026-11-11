import {
  buildCanonicalExport,
  canonicalExportString,
  type DatabaseDefinition,
  type ExportedItem,
  generateUuidV7,
  ownedSourceIdFromItemId,
  type Uuid,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

function fixture(legacy = false) {
  const workspaceId = generateUuidV7();
  const hostId = generateUuidV7();
  const entryId = generateUuidV7();
  const sourceIds = legacy
    ? [ownedSourceIdFromItemId(hostId)]
    : [generateUuidV7(), generateUuidV7()];
  const timestamp = "2026-11-11T12:00:00.000Z";
  const item = (id: Uuid, host: boolean): ExportedItem => ({
    id,
    workspaceId,
    kind: host && !legacy ? "database" : "page",
    name: "Fixture",
    icon: null,
    lifecycle: "active",
    trashedAt: null,
    purgeAfter: null,
    currentRevisionId: generateUuidV7(),
    favourite: false,
    offlineIntent: false,
    file: null,
    pageDocument:
      host && !legacy ? null : { format: "myownnotion.document+json", formatVersion: 1, body: {} },
    placements: [
      {
        id: generateUuidV7(),
        workspaceId,
        itemId: id,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: host ? null : hostId,
        positionKey: "a",
        removedAt: null,
      },
    ],
  });
  const host = item(hostId, true);
  const entry = item(entryId, false);
  const databases = sourceIds.map((sourceId, index) => {
    const titleId = generateUuidV7();
    const numberId = generateUuidV7();
    const definition: DatabaseDefinition = {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId: hostId,
      properties: [
        {
          id: titleId,
          name: "Title",
          type: "title",
          state: "active",
          positionKey: "a",
          config: {},
        },
        {
          id: numberId,
          name: "Number",
          type: "number",
          state: "active",
          positionKey: "b",
          config: {},
        },
      ],
      views: [
        {
          id: generateUuidV7(),
          name: "Table",
          type: "table",
          state: "active",
          positionKey: index === 0 ? "a" : "b",
          properties: [{ propertyId: titleId, visible: true, positionKey: "a" }],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable", freezeTitle: true },
        },
      ],
      taskRoles: null,
    };
    return {
      databaseId: hostId,
      ...(legacy ? {} : { sourceId }),
      definitionVersion: 1,
      definitionRevisionId: index === 0 ? host.currentRevisionId : generateUuidV7(),
      definition,
    };
  });
  const target = databases.at(-1);
  const number = target?.definition.properties.find((property) => property.type === "number");
  if (target === undefined || number === undefined) throw new Error("Missing fixture");
  return buildCanonicalExport({
    workspaceId,
    schemaVersion: 1,
    exportedAt: timestamp,
    changeCursor: "",
    items: [host, entry],
    databases,
    ...(legacy
      ? {}
      : {
          databasePresentations: [
            {
              containerItemId: hostId,
              presentationRevisionId: host.currentRevisionId,
              presentationVersion: 1,
              presentation: {
                format: "myownnotion.database-presentation+json" as const,
                formatVersion: 1 as const,
                containerItemId: hostId,
                views: databases.flatMap((database, index) =>
                  database.definition.views.map((view) => ({
                    ...view,
                    sourceId: sourceIds[index] as Uuid,
                  })),
                ),
              },
            },
          ],
        }),
    databaseEntries: [
      {
        entryId,
        databaseId: hostId,
        ...(legacy ? {} : { sourceId: sourceIds.at(-1) as Uuid }),
        valueVersion: 1,
        addedRevisionId: entry.currentRevisionId,
        values: {
          format: "myownnotion.database-entry-values+json",
          formatVersion: 1,
          databaseId: hostId,
          entryId,
          values: { [number.id]: { kind: "number", decimal: "20" } },
          preserved: [],
        },
      },
    ],
    relationships: [],
    revisions: [host, entry]
      .map((row) => ({
        id: row.currentRevisionId,
        itemId: row.id,
        mutationId: generateUuidV7(),
        parentRevisionIds: [],
        acceptedAt: timestamp,
      }))
      .concat(
        databases.slice(1).map((database) => ({
          id: database.definitionRevisionId,
          itemId: hostId,
          mutationId: generateUuidV7(),
          parentRevisionIds: [],
          acceptedAt: timestamp,
        })),
      ),
  });
}

const codes = (manifest: ReturnType<typeof fixture>) =>
  validateCanonicalExport(manifest).map((issue) => issue.code);

describe("canonical source identity", () => {
  it("accepts two sources on one host and resolves entry values against the secondary schema", () => {
    expect(validateCanonicalExport(fixture())).toEqual([]);
  });

  it("sorts sources deterministically regardless of their input order", () => {
    const manifest = fixture();
    expect(
      canonicalExportString(
        buildCanonicalExport({ ...manifest, databases: [...manifest.databases].reverse() }),
      ),
    ).toBe(canonicalExportString(manifest));
  });

  it("preserves pre-source exports and rejects genuine legacy duplicates", () => {
    const manifest = fixture(true);
    expect(validateCanonicalExport(manifest)).toEqual([]);
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databases: [...manifest.databases, ...manifest.databases],
        }),
      ),
    ).toContain("database.duplicate");
  });

  it("rejects repeated source identity even under different hosts", () => {
    const manifest = fixture();
    const first = manifest.databases[0];
    const second = manifest.databases[1];
    if (!first?.sourceId || !second) throw new Error("Missing fixture");
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databases: [first, { ...second, databaseId: generateUuidV7(), sourceId: first.sourceId }],
        }),
      ),
    ).toContain("database.duplicate");
  });

  it("rejects the same canonical source listed twice on one host", () => {
    const manifest = fixture();
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databases: [...manifest.databases, ...manifest.databases],
        }),
      ),
    ).toContain("database.duplicate");
  });

  it("does not resolve a source owned by another database", () => {
    const manifest = fixture();
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databaseEntries: manifest.databaseEntries.map((entry) => ({
            ...entry,
            databaseId: generateUuidV7(),
          })),
        }),
      ),
    ).toContain("database-entry.source-mismatch");
  });

  it("rejects a missing source instead of falling back to another schema on the host", () => {
    const manifest = fixture();
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databaseEntries: manifest.databaseEntries.map((entry) => ({
            ...entry,
            sourceId: generateUuidV7(),
          })),
        }),
      ),
    ).toContain("database-entry.source-mismatch");
  });

  it("rejects values belonging to a different source schema", () => {
    const manifest = fixture();
    const other = manifest.databases.find(
      (row) => row.sourceId !== manifest.databaseEntries[0]?.sourceId,
    );
    if (!other?.sourceId) throw new Error("Missing fixture");
    const sourceId = other.sourceId;
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databaseEntries: manifest.databaseEntries.map((entry) => ({
            ...entry,
            sourceId,
          })),
        }),
      ),
    ).toContain("database-entry.value-invalid");
  });

  it("still refuses duplicate host/entry memberships across different sources", () => {
    const manifest = fixture();
    expect(
      codes(
        buildCanonicalExport({
          ...manifest,
          databaseEntries: [...manifest.databaseEntries, ...manifest.databaseEntries],
        }),
      ),
    ).toContain("database-entry.duplicate");
  });
});
