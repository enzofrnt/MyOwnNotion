import {
  changeDatabaseViewSource,
  type DatabasePresentationDefinition,
  type DatabaseSourceDefinition,
  generateUuidV7,
  type SourcedDatabaseView,
  validateDatabasePresentation,
  validateDatabaseSource,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const ownerItemId = generateUuidV7();
const sourceId = generateUuidV7();
const otherSourceId = generateUuidV7();
const propertyId = generateUuidV7();

const source: DatabaseSourceDefinition = {
  format: "myownnotion.database-source+json",
  formatVersion: 1,
  sourceId,
  ownerItemId,
  name: "Tasks",
  properties: [
    { id: propertyId, name: "Name", type: "title", positionKey: "a", state: "active", config: {} },
  ],
  taskRoles: null,
};

function tableView(source: SourcedDatabaseView["sourceId"]): SourcedDatabaseView {
  return {
    id: generateUuidV7(),
    sourceId: source,
    name: "Table",
    positionKey: "a",
    state: "active",
    type: "table",
    properties: [{ propertyId, visible: true, positionKey: "a" }],
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: null,
    options: { density: "comfortable", freezeTitle: true },
  };
}

function presentation(views: readonly SourcedDatabaseView[]): DatabasePresentationDefinition {
  return {
    format: "myownnotion.database-presentation+json",
    formatVersion: 1,
    containerItemId: ownerItemId,
    views,
  };
}

describe("separate source and presentation definitions", () => {
  it("requires a source identity distinct from its owner", () => {
    expect(validateDatabaseSource(source)).toMatchObject({ ok: true });
    expect(validateDatabaseSource({ ...source, sourceId: ownerItemId })).toMatchObject({
      ok: false,
      error: { invalidFields: [{ field: "ownerItemId", code: "invalid" }] },
    });
  });

  it("requires a linked-view item to show exactly one view", () => {
    expect(
      validateDatabasePresentation(presentation([tableView(sourceId)]), "database_view").ok,
    ).toBe(true);
    expect(
      validateDatabasePresentation(
        presentation([tableView(sourceId), tableView(sourceId)]),
        "database_view",
      ).ok,
    ).toBe(false);
  });

  it("locks the only owner view, then changes just the selected view", () => {
    const first = tableView(sourceId);
    const single = presentation([first]);
    expect(changeDatabaseViewSource(single, "database", first.id, otherSourceId)).toMatchObject({
      ok: false,
      error: { code: "database.view-source-locked" },
    });
    const second = tableView(sourceId);
    const multiple = presentation([first, second]);
    const result = changeDatabaseViewSource(multiple, "database", first.id, otherSourceId);
    expect(result).toMatchObject({
      ok: true,
      value: {
        views: [
          { id: first.id, sourceId: otherSourceId },
          { id: second.id, sourceId },
        ],
      },
    });
    expect(multiple.views[0]?.sourceId).toBe(sourceId);
    expect(source.sourceId).toBe(sourceId);
  });
});
