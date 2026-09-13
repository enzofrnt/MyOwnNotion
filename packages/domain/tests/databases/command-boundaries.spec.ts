import { describe, expect, it } from "vitest";
import { parseMutationCommand } from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

const placement = { id: IDS.relationA, parentItemId: null, positionKey: "a" };
const create = {
  id: IDS.database,
  name: "Source",
  placement,
  titlePropertyId: IDS.title,
  initialViewId: IDS.view,
  initialViewName: "Table",
};
const entry = {
  databaseId: IDS.database,
  id: IDS.entryA,
  title: "Entry",
  values: {},
  relationTargets: {},
};
const replace = {
  databaseId: IDS.database,
  baseRevisionId: IDS.revision,
  definition: definition(),
};
const resolve = {
  databaseId: IDS.database,
  resolvedRevisionIds: [IDS.revision, IDS.relationB],
  definition: definition(),
};
const valueReplace = {
  databaseId: IDS.database,
  entryId: IDS.entryA,
  baseRevisionId: IDS.revision,
  values: {},
  relationTargets: {},
};
const valueResolve = {
  databaseId: IDS.database,
  entryId: IDS.entryA,
  resolvedRevisionIds: [IDS.revision, IDS.relationB],
  values: {},
  relationTargets: {},
};
const commands: [string, Record<string, unknown>][] = [
  ["database.create", create],
  ["database.entry.create", entry],
  ["database.definition.replace", replace],
  ["database.definition.resolve-conflict", resolve],
  ["database.entry.values.replace", valueReplace],
  ["database.entry.values.resolve-conflict", valueResolve],
];
function refuses(type: string, payload: Record<string, unknown>) {
  expect(parseMutationCommand(type, payload)).toMatchObject({
    ok: false,
    error: { code: "validation.invalid-payload" },
  });
}

describe("external database mutation boundaries", () => {
  it.each(commands)(
    "rejects missing fields, injected fields and malformed identities: %s",
    (type, input) => {
      expect(parseMutationCommand(type, input).ok).toBe(true);
      const original = structuredClone(input);
      for (const key of Object.keys(input)) {
        const missing = { ...input };
        delete missing[key];
        refuses(type, missing);
        if (key.endsWith("Id") || key === "id") refuses(type, { ...input, [key]: "foreign-id" });
      }
      refuses(type, { ...input, injected: true });
      expect(input).toEqual(original);
    },
  );
  it.each([
    null,
    {},
    { id: IDS.relationA, parentItemId: null },
    { ...placement, id: "bad" },
    { ...placement, parentItemId: "bad" },
    { ...placement, positionKey: 1 },
    { ...placement, positionKey: "" },
    { ...placement, extra: true },
  ])("rejects an invalid explicit placement %# on sources and entries", (candidate) => {
    refuses("database.create", { ...create, placement: candidate });
    refuses("database.entry.create", { ...entry, placement: candidate });
  });
  it.each([
    { name: " " },
    { titlePropertyName: " " },
    { initialViewName: " " },
    { name: 1 },
    { titlePropertyName: false },
    { initialViewName: null },
    { hostPageId: "bad" },
  ])("rejects invalid source labels and hosts %#", (patch) =>
    refuses("database.create", { ...create, ...patch }),
  );
  it.each([
    null,
    [],
    { unrelated: { kind: "text", value: "x" } },
    ...[
      null,
      3,
      {},
      { kind: "future-kind" },
      { kind: "text", value: 3 },
      { kind: "number", decimal: 3 },
      { kind: "number", decimal: "NaN" },
      { kind: "date", date: 3 },
      { kind: "date", date: "2026-02-30" },
      { kind: "instant", instant: 3 },
      { kind: "instant", instant: "not-an-instant" },
      { kind: "select", optionId: "bad" },
      { kind: "status", optionId: "bad" },
      { kind: "multi-select", optionIds: null },
      { kind: "multi-select", optionIds: ["bad"] },
      { kind: "multi-select", optionIds: [IDS.todo, IDS.todo] },
      { kind: "multi-select", optionIds: [], extra: true },
      { kind: "checkbox", checked: "false" },
    ].map((value) => ({ [IDS.text]: value })),
  ])("rejects malformed values %# through every entry write", (values) => {
    for (const [type, payload] of [
      ["database.entry.create", entry],
      ["database.entry.values.replace", valueReplace],
      ["database.entry.values.resolve-conflict", valueResolve],
    ] as const)
      refuses(type, { ...payload, values });
  });
  it.each([
    null,
    [],
    { invalid: [] },
    { [IDS.relation]: null },
    { [IDS.relation]: ["bad"] },
    { [IDS.relation]: [IDS.entryB, IDS.entryB] },
  ])("rejects malformed relation targets %#", (relationTargets) => {
    refuses("database.entry.create", { ...entry, relationTargets });
    refuses("database.entry.values.replace", { ...valueReplace, relationTargets });
    refuses("database.entry.values.resolve-conflict", { ...valueResolve, relationTargets });
  });
  it.each([
    null,
    {},
    { format: "other", formatVersion: 1, body: {} },
    { format: "myownnotion.document+json", formatVersion: "1", body: {} },
    { format: "myownnotion.document+json", formatVersion: 1, body: null },
    { format: "myownnotion.document+json", formatVersion: 999, body: {} },
  ])("rejects malformed page documents %# without degrading to empty", (document) =>
    refuses("database.entry.create", { ...entry, document }),
  );
  it.each([
    null,
    [],
    {},
    { properties: [], views: null },
    { properties: [null], views: [] },
    definition({ databaseId: IDS.entryB }),
  ])("rejects malformed or foreign definitions %#", (candidate) => {
    refuses("database.definition.replace", { ...replace, definition: candidate });
    refuses("database.definition.resolve-conflict", { ...resolve, definition: candidate });
  });
  it.each([
    null,
    {},
    { digest: 5, decision: "discard-confirmed" },
    { digest: "a".repeat(64), decision: "guess" },
    { digest: "a".repeat(64), decision: "discard-confirmed", injected: true },
  ])("requires a valid explicit impact confirmation %#", (impactConfirmation) => {
    refuses("database.definition.replace", { ...replace, impactConfirmation });
    refuses("database.definition.resolve-conflict", { ...resolve, impactConfirmation });
  });
  it.each([null, "parents", ["bad", IDS.revision], [IDS.revision, "bad"]])(
    "rejects malformed conflict parents %#",
    (resolvedRevisionIds) => {
      refuses("database.definition.resolve-conflict", { ...resolve, resolvedRevisionIds });
      refuses("database.entry.values.resolve-conflict", { ...valueResolve, resolvedRevisionIds });
    },
  );
  it("normalizes accepted typed values and sorts sets without mutating caller data", () => {
    const values = {
      [IDS.number]: { kind: "number", decimal: "+02.00" },
      [IDS.date]: { kind: "date", date: "2026-09-08" },
      [IDS.text]: { kind: "instant", instant: "2026-09-08T12:00:00+02:00" },
      [IDS.status]: { kind: "status", optionId: IDS.todo },
      [IDS.select]: { kind: "select", optionId: IDS.high },
      [IDS.multi]: { kind: "multi-select", optionIds: [IDS.doing, IDS.todo] },
      [IDS.checkbox]: { kind: "checkbox", checked: false },
    };
    const input = {
      ...entry,
      title: " Entry ",
      values,
      relationTargets: { [IDS.relation]: [IDS.entryC, IDS.entryB] },
    };
    const original = structuredClone(input);
    const result = parseMutationCommand("database.entry.create", input);
    expect(result).toMatchObject({
      ok: true,
      value: {
        title: "Entry",
        values: {
          [IDS.number]: { kind: "number", decimal: "2" },
          [IDS.multi]: { kind: "multi-select", optionIds: [IDS.todo, IDS.doing] },
          [IDS.checkbox]: { kind: "checkbox", checked: false },
        },
        relationTargets: { [IDS.relation]: [IDS.entryB, IDS.entryC] },
      },
    });
    expect(parseMutationCommand("database.entry.create", input)).toEqual(result);
    expect(input).toEqual(original);
    expect(
      parseMutationCommand("database.definition.resolve-conflict", {
        ...resolve,
        impactConfirmation: { digest: "a".repeat(64), decision: "discard-confirmed" },
      }).ok,
    ).toBe(true);
  });
  it.each(["property", "view", "embedded view"])("rejects an unknown %s type", (target) => {
    const candidate = definition();
    const view = { ...candidate.views[0], type: "unsupported-view" };
    const bad =
      target === "property"
        ? {
            ...candidate,
            properties: candidate.properties.map((p) =>
              p.id === IDS.text ? { ...p, type: "unsupported-property" } : p,
            ),
          }
        : target === "view"
          ? { ...candidate, views: [view] }
          : {
              ...candidate,
              embeddings: [
                { id: IDS.relationA, hostPageId: IDS.entryA, state: "active", views: [view] },
              ],
            };
    refuses("database.definition.replace", { ...replace, definition: bad });
  });
});
