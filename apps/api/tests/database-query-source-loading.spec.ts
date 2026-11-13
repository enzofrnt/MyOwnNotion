import type { Database, DatabaseRecord } from "@myownnotion/database";
import { asUuid, type DatabaseDefinition, type Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  listDatabaseRecords: vi.fn(),
  readCurrentDatabaseDefinition: vi.fn(),
  listDatabaseProjectionEntries: vi.fn(),
  listDatabaseProjectionRelationships: vi.fn(async () => []),
  databaseIdsForEntries: vi.fn(async () => []),
  readItem: vi.fn(async () => ({
    lifecycle: "active",
    currentRevisionId: "018f7100-0000-7000-8000-000000000099",
  })),
}));
vi.mock("@myownnotion/database", async (original) => ({
  ...(await original<typeof import("@myownnotion/database")>()),
  ...repository,
}));

import { createDatabaseQueryService } from "../src/databases/database-query-service.ts";

const id = (n: number): Uuid => asUuid(`018f7100-0000-7000-8000-${String(n).padStart(12, "0")}`);
const host = id(1);
const record = (n: number): DatabaseRecord => ({
  databaseId: host,
  sourceId: id(n),
  workspaceId: id(2),
  definitionVersion: 1,
  definitionRevisionId: id(n + 10),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const definition = (n: number): DatabaseDefinition => ({
  format: "myownnotion.database-definition+json",
  formatVersion: 1,
  databaseId: host,
  properties: [
    {
      id: id(n + 20),
      name: `Title ${n}`,
      type: "title",
      positionKey: "a",
      state: "active",
      config: {},
    },
  ],
  views: [
    {
      id: id(n + 30),
      name: "Table",
      type: "table",
      state: "active",
      positionKey: "a",
      properties: [],
      filter: { mode: "all", criteria: [] },
      sorts: [],
      group: null,
      options: { density: "comfortable", freezeTitle: true },
    },
  ],
  taskRoles: null,
});

describe("canonical source loading for the API query projection", () => {
  it("removes a trashed source owner from the projection until it is restored", async () => {
    repository.listDatabaseRecords.mockResolvedValue([record(3)]);
    repository.readCurrentDatabaseDefinition.mockResolvedValue(definition(3));
    repository.listDatabaseProjectionEntries.mockResolvedValue([]);
    repository.readItem.mockResolvedValue({ lifecycle: "trashed", currentRevisionId: id(99) });
    const service = createDatabaseQueryService({ db: {} as Database, workspaceId: id(2) });
    await service.rebuild();
    expect(() => service.query(host, { viewId: id(33) })).toThrow();
    repository.readItem.mockResolvedValue({ lifecycle: "active", currentRevisionId: id(99) });
    await service.applyCommittedChanges([host], 1);
    expect(service.query(host, { viewId: id(33) }).rows).toEqual([]);
    vi.clearAllMocks();
  });
  it("loads each host record once, scopes rows by source and removes only a deleted source", async () => {
    let records = [record(3), record(4)];
    repository.listDatabaseRecords.mockImplementation(async () => records);
    repository.readCurrentDatabaseDefinition.mockImplementation(
      async (_db, _host, _unused, sourceId) => definition(sourceId === id(3) ? 3 : 4),
    );
    repository.listDatabaseProjectionEntries.mockImplementation(
      async (_db, _host, _changed, sourceId) =>
        sourceId === id(3)
          ? [
              {
                entryId: id(50),
                revisionId: id(51),
                storedName: "Primary row",
                entryNumber: null,
                valueVersion: 0,
                storedValues: null,
              },
            ]
          : [],
    );
    const service = createDatabaseQueryService({ db: {} as Database, workspaceId: id(2) });
    await service.rebuild();
    expect(repository.readCurrentDatabaseDefinition.mock.calls.map((call) => call[3])).toEqual([
      id(3),
      id(4),
    ]);
    expect(
      repository.listDatabaseProjectionEntries.mock.calls.map((call) => call.slice(1)),
    ).toEqual([
      [host, undefined, id(3)],
      [host, undefined, id(4)],
    ]);
    expect(service.query(host, { viewId: id(33) }).rows).toHaveLength(1);
    expect(service.query(host, { viewId: id(34) }).rows).toEqual([]);
    expect(service.query(host, { viewId: id(33) }).rollupProperties).toContainEqual({
      id: id(24),
      name: "Title 4",
      type: "title",
      sourceId: id(4),
    });
    records = [record(3)];
    await service.applyCommittedChanges([host], 1);
    expect(service.query(host, { viewId: id(33) }).rows).toHaveLength(1);
    expect(() => service.query(host, { viewId: id(34) })).toThrow();
    expect(service.query(host, { viewId: id(33) }).rollupProperties).not.toContainEqual(
      expect.objectContaining({ sourceId: id(4) }),
    );
  });
});
