import { describe, expect, it } from "vitest";
import { parseMutationCommand } from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

function replace(candidate: unknown) {
  return parseMutationCommand("database.definition.replace", {
    databaseId: IDS.database,
    baseRevisionId: IDS.revision,
    definition: candidate,
  });
}
function patch(path: readonly (string | number)[], value: unknown) {
  const input = structuredClone(definition()) as unknown as Record<string, unknown>;
  let target = input;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path.at(-1) as string] = value;
  return input;
}
const malformed: [string, (string | number)[], unknown][] = [
  ["format", ["format"], "future-format"],
  ["version", ["formatVersion"], 2],
  ["identity", ["databaseId"], "invalid"],
  ["name", ["name"], " "],
  ["property id", ["properties", 1, "id"], "invalid"],
  ["property name", ["properties", 1, "name"], " "],
  ["property position", ["properties", 1, "positionKey"], ""],
  ["property state", ["properties", 1, "state"], "deleted"],
  ["date mode", ["properties", 3, "config", "mode"], "date-range"],
  ["relation cardinality", ["properties", 8, "config", "cardinality"], "all"],
  ["option id", ["properties", 4, "config", "options", 0, "id"], "invalid"],
  ["option label", ["properties", 4, "config", "options", 0, "label"], " "],
  ["option position", ["properties", 4, "config", "options", 0, "positionKey"], ""],
  ["option tone", ["properties", 4, "config", "options", 0, "tone"], "red;display:none"],
  ["option state", ["properties", 4, "config", "options", 0, "state"], "deleted"],
  ["view identity", ["views", 0, "id"], "invalid"],
  ["view name", ["views", 0, "name"], " "],
  ["view position", ["views", 0, "positionKey"], ""],
  ["view state", ["views", 0, "state"], "deleted"],
  ["filter mode", ["views", 0, "filter", "mode"], "random"],
  [
    "filter identity",
    ["views", 0, "filter", "criteria"],
    [{ id: "bad", propertyId: IDS.text, operator: "is-empty" }],
  ],
  ["presentation identity", ["views", 0, "properties", 0, "propertyId"], "invalid"],
  ["presentation order", ["views", 0, "properties", 0, "positionKey"], ""],
  ["presentation width type", ["views", 0, "properties", 0, "width"], "100"],
  ["presentation width minimum", ["views", 0, "properties", 0, "width"], 79],
  ["presentation width maximum", ["views", 0, "properties", 0, "width"], 801],
  ["presentation duplicate", ["views", 0, "properties", 1, "propertyId"], IDS.title],
  ["missing task status", ["taskRoles", "statusPropertyId"], IDS.entryA],
  ["missing task due date", ["taskRoles", "dueDatePropertyId"], IDS.entryA],
  ["missing task priority", ["taskRoles", "priorityPropertyId"], IDS.entryA],
];

describe("database definition rejection at the public command boundary", () => {
  it.each(malformed)("refuses invalid %s without rewriting caller data", (_label, path, value) => {
    const input = patch(path, value);
    const original = structuredClone(input);
    expect(replace(input)).toMatchObject({
      ok: false,
      error: { code: "validation.invalid-payload" },
    });
    expect(input).toEqual(original);
  });
  it.each([
    null,
    {},
    [{ id: "invalid", hostPageId: IDS.entryA, state: "active", views: definition().views }],
    [{ id: IDS.relationA, hostPageId: "invalid", state: "active", views: definition().views }],
    [{ id: IDS.relationA, hostPageId: IDS.entryA, state: "deleted", views: definition().views }],
    [{ id: IDS.relationA, hostPageId: IDS.entryA, state: "active", views: null }],
    [{ id: IDS.relationA, hostPageId: IDS.entryA, state: "active", views: [] }],
    [
      {
        id: IDS.relationA,
        hostPageId: IDS.entryA,
        state: "active",
        views: definition().views.map((view) => ({ ...view, name: " " })),
      },
    ],
  ])("refuses malformed embedded configuration %#", (embeddings) => {
    expect(replace({ ...definition(), embeddings }).ok).toBe(false);
  });
  it("normalizes independent embedding labels while preserving identities and caller state", () => {
    const input = definition({
      embeddings: [
        {
          id: IDS.relationA,
          hostPageId: IDS.entryA,
          state: "active",
          views: definition().views.map((view) => ({ ...view, name: "  Linked view  " })),
        },
      ],
    });
    const original = structuredClone(input);
    expect(replace(input)).toMatchObject({
      ok: true,
      value: {
        definition: {
          embeddings: [
            {
              id: IDS.relationA,
              hostPageId: IDS.entryA,
              views: [{ id: IDS.view, name: "Linked view" }],
            },
          ],
        },
      },
    });
    expect(input).toEqual(original);
  });
});
