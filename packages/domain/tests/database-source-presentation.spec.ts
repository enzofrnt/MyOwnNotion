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
import { definition, IDS } from "./databases/fixtures.ts";

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
  const fullSource = (): DatabaseSourceDefinition => ({
    ...source,
    properties: definition().properties,
    taskRoles: definition().taskRoles,
  });

  it.each([
    ["format", (s: DatabaseSourceDefinition) => ({ ...s, format: "future" })],
    ["version", (s: DatabaseSourceDefinition) => ({ ...s, formatVersion: 2 })],
    ["source identity", (s: DatabaseSourceDefinition) => ({ ...s, sourceId: "invalid" })],
    ["owner identity", (s: DatabaseSourceDefinition) => ({ ...s, ownerItemId: "invalid" })],
    ["empty name", (s: DatabaseSourceDefinition) => ({ ...s, name: " " })],
    [
      "duplicate property",
      (s: DatabaseSourceDefinition) => ({ ...s, properties: [...s.properties, s.properties[0]] }),
    ],
    [
      "invalid property",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        properties: s.properties.map((p) => ({ ...p, name: " " })),
      }),
    ],
    [
      "missing title",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        properties: s.properties.filter((p) => p.type !== "title"),
      }),
    ],
    [
      "missing status role",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        taskRoles: { ...s.taskRoles, statusPropertyId: IDS.entryA },
      }),
    ],
    [
      "wrong status role",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        taskRoles: { ...s.taskRoles, statusPropertyId: IDS.text },
      }),
    ],
    [
      "retired status role",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        properties: s.properties.map((p) => (p.id === IDS.status ? { ...p, state: "retired" } : p)),
      }),
    ],
    [
      "wrong date role",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        taskRoles: { ...s.taskRoles, dueDatePropertyId: IDS.text },
      }),
    ],
    [
      "wrong priority role",
      (s: DatabaseSourceDefinition) => ({
        ...s,
        taskRoles: { ...s.taskRoles, priorityPropertyId: IDS.text },
      }),
    ],
  ] as const)("rejects an invalid source %s independently of any visible view", (_label, make) => {
    const input = make(fullSource()) as DatabaseSourceDefinition;
    const before = structuredClone(input);
    expect(validateDatabaseSource(input)).toMatchObject({
      ok: false,
      error: { code: "validation.invalid-payload" },
    });
    expect(input).toEqual(before);
  });

  it.each(["database", "database_view"] as const)(
    "validates malformed presentations on %s without rewriting them",
    (kind) => {
      const view = tableView(sourceId);
      const valid = presentation([view]);
      const malformed = [
        { ...valid, format: "future" },
        { ...valid, formatVersion: 2 },
        { ...valid, containerItemId: "invalid" },
        { ...valid, views: [view, view] },
        { ...valid, views: [{ ...view, sourceId: "invalid" }] },
        { ...valid, views: [{ ...view, name: " " }] },
        { ...valid, views: [{ ...view, type: "unknown" }] },
      ];
      for (const input of malformed) {
        const before = structuredClone(input);
        expect(
          validateDatabasePresentation(input as DatabasePresentationDefinition, kind),
        ).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
        expect(input).toEqual(before);
      }
    },
  );

  it("keeps an empty or entirely retired presentation recoverable and normalizes view labels/icons", () => {
    for (const views of [[], [{ ...tableView(sourceId), state: "retired" as const }]]) {
      expect(validateDatabasePresentation(presentation(views), "database")).toMatchObject({
        ok: true,
        value: { views },
      });
    }
    for (const icon of [undefined, null, "star", "INVALID"] as const) {
      const view = {
        ...tableView(sourceId),
        name: "  Research  ",
        ...(icon === undefined ? {} : { icon }),
      };
      const result = validateDatabasePresentation(presentation([view]), "database_view");
      expect(result).toMatchObject({
        ok: true,
        value: {
          views: [
            {
              name: "Research",
              ...(icon === undefined ? {} : { icon: icon === "INVALID" ? null : icon }),
            },
          ],
        },
      });
    }
    expect(validateDatabaseSource({ ...source, name: "  Tasks  " })).toMatchObject({
      ok: true,
      value: { name: "Tasks" },
    });
  });

  it("refuses an invalid source change and allows a lone linked view to choose another source", () => {
    const view = tableView(sourceId);
    const current = presentation([view]);
    expect(
      changeDatabaseViewSource(
        { ...current, views: [view, view] },
        "database",
        view.id,
        otherSourceId,
      ),
    ).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
    expect(
      changeDatabaseViewSource(current, "database_view", view.id, "invalid" as typeof sourceId),
    ).toMatchObject({ ok: false, error: { code: "validation.invalid-identifier" } });
    for (const candidate of [current, presentation([{ ...view, state: "retired" }])]) {
      expect(
        changeDatabaseViewSource(candidate, "database_view", generateUuidV7(), otherSourceId),
      ).toMatchObject({ ok: false, error: { code: "database.invalid-view" } });
    }
    expect(
      changeDatabaseViewSource(current, "database_view", view.id, otherSourceId),
    ).toMatchObject({ ok: true, value: { views: [{ sourceId: otherSourceId }] } });
    expect(current.views[0]?.sourceId).toBe(sourceId);
  });
  it("requires a source identity distinct from its owner", () => {
    expect(validateDatabaseSource(source)).toMatchObject({ ok: true });
    expect(validateDatabaseSource({ ...source, sourceId: ownerItemId })).toMatchObject({
      ok: false,
      error: { invalidFields: [{ field: "ownerItemId", code: "invalid" }] },
    });
  });

  it("allows a full-page linked container to host multiple independent views", () => {
    expect(
      validateDatabasePresentation(presentation([tableView(sourceId)]), "database_view").ok,
    ).toBe(true);
    expect(
      validateDatabasePresentation(
        presentation([tableView(sourceId), tableView(otherSourceId)]),
        "database_view",
      ).ok,
    ).toBe(true);
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
