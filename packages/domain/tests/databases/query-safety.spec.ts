import fc from "fast-check";
import { expect, it } from "vitest";
import {
  asUuid,
  type DatabaseDefinition,
  type DatabaseView,
  evaluateDatabaseView,
  type FilterCriterion,
} from "../../src/index.ts";
import { definition, IDS, queryEntry, tableView } from "./fixtures.ts";

const rows = [
  queryEntry(
    IDS.entryA,
    "Alpha",
    {
      [IDS.number]: { kind: "number", decimal: "2" },
      [IDS.checkbox]: { kind: "checkbox", checked: false },
      [IDS.multi]: { kind: "multi-select", optionIds: [IDS.todo, IDS.doing] },
      [IDS.date]: { kind: "date", date: "2026-09-01" },
    },
    { [IDS.relation]: [IDS.relationA, IDS.relationB] },
  ),
  queryEntry(
    IDS.entryB,
    "Beta",
    {
      [IDS.number]: { kind: "number", decimal: "10" },
      [IDS.checkbox]: { kind: "checkbox", checked: true },
      [IDS.multi]: { kind: "multi-select", optionIds: [IDS.doing] },
      [IDS.date]: { kind: "date", date: "2026-09-30" },
    },
    { [IDS.relation]: [IDS.relationB] },
  ),
  queryEntry(IDS.entryC, "Gamma"),
];
function evaluate(view: DatabaseView, input = rows, model: DatabaseDefinition = definition()) {
  const result = evaluateDatabaseView({ ...model, views: [view] }, view.id, input);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

it("applies negative, presence, numeric and set filters without treating an absent value as false", () => {
  const cases: [Omit<FilterCriterion, "id">, readonly string[]][] = [
    [{ propertyId: IDS.checkbox, operator: "is-not-empty" }, [IDS.entryA, IDS.entryB]],
    [
      {
        propertyId: IDS.checkbox,
        operator: "not-equals",
        operand: { kind: "checkbox", checked: false },
      },
      [IDS.entryB],
    ],
    [
      { propertyId: IDS.number, operator: "less-than", operand: { kind: "number", decimal: "3" } },
      [IDS.entryA],
    ],
    [
      {
        propertyId: IDS.multi,
        operator: "contains",
        operand: { kind: "multi-select", optionIds: [IDS.todo] },
      },
      [IDS.entryA],
    ],
    [
      {
        propertyId: IDS.multi,
        operator: "not-contains",
        operand: { kind: "multi-select", optionIds: [IDS.todo] },
      },
      [IDS.entryB],
    ],
    [
      {
        propertyId: IDS.relation,
        operator: "not-contains",
        operand: { kind: "relation", targetIds: [IDS.relationA, IDS.relationA] },
      },
      [IDS.entryB],
    ],
    [
      { propertyId: IDS.date, operator: "before", operand: { kind: "date", date: "2026-09-15" } },
      [IDS.entryA],
    ],
    [
      { propertyId: IDS.date, operator: "after", operand: { kind: "date", date: "2026-09-15" } },
      [IDS.entryB],
    ],
    [
      {
        propertyId: IDS.title,
        operator: "not-contains",
        operand: { kind: "text", value: "ALPHA" },
      },
      [IDS.entryB, IDS.entryC],
    ],
    [
      {
        propertyId: IDS.date,
        operator: "between",
        operand: {
          kind: "date-range",
          from: { kind: "date", date: "2026-09-01" },
          to: { kind: "date", date: "2026-09-30" },
        },
      },
      [IDS.entryA, IDS.entryB],
    ],
  ];
  for (const [criterion, expected] of cases) {
    const view = tableView({
      filter: { mode: "all", criteria: [{ ...criterion, id: IDS.filter }] },
    });
    expect(
      evaluate(view).rows.map((row) => row.entryId),
      JSON.stringify(criterion),
    ).toEqual(expected);
  }
});

it("fails closed on unavailable properties and malformed saved filter operands", () => {
  const invalid = [
    { propertyId: IDS.title, operator: "contains", operand: null },
    {
      propertyId: IDS.title,
      operator: "equals",
      operand: { kind: "text", value: "A", extra: true },
    },
    { propertyId: IDS.title, operator: "equals", operand: { kind: "number", decimal: "1" } },
    { propertyId: IDS.number, operator: "contains", operand: { kind: "number", decimal: "1" } },
    { propertyId: IDS.number, operator: "unknown", operand: { kind: "number", decimal: "1" } },
    { propertyId: IDS.number, operator: "equals", operand: { kind: "number", decimal: "NaN" } },
    { propertyId: IDS.number, operator: "equals" },
    { propertyId: IDS.date, operator: "between" },
    { propertyId: IDS.date, operator: "between", operand: { kind: "text", value: "yesterday" } },
    {
      propertyId: IDS.date,
      operator: "between",
      operand: {
        kind: "instant-range",
        from: { kind: "instant", instant: "2026-09-01T00:00:00.000Z" },
        to: { kind: "instant", instant: "2026-09-30T00:00:00.000Z" },
      },
    },
    {
      propertyId: IDS.date,
      operator: "between",
      operand: { kind: "date-range", from: null, to: null },
    },
    {
      propertyId: IDS.date,
      operator: "between",
      operand: {
        kind: "date-range",
        from: { kind: "date", date: "2026-02-30" },
        to: { kind: "date", date: "2026-09-30" },
      },
    },
    {
      propertyId: IDS.date,
      operator: "between",
      operand: {
        kind: "date-range",
        from: { kind: "date", date: "2026-09-30" },
        to: { kind: "date", date: "2026-09-01" },
      },
    },
    {
      propertyId: IDS.relation,
      operator: "contains",
      operand: { kind: "relation", targetIds: [42] },
    },
    {
      propertyId: IDS.relation,
      operator: "contains",
      operand: { kind: "relation", targetIds: "invalid" },
    },
    { propertyId: IDS.relation, operator: "contains", operand: { kind: "text", value: "invalid" } },
    { propertyId: IDS.entryA, operator: "is-empty" },
  ];
  for (const criterion of invalid) {
    const view = tableView({
      filter: { mode: "all", criteria: [{ ...criterion, id: IDS.filter } as FilterCriterion] },
    });
    expect(
      evaluateDatabaseView(definition({ views: [view] }), view.id, rows).ok,
      JSON.stringify(criterion),
    ).toBe(false);
  }
  const retired = definition({
    properties: definition().properties.map((property) =>
      property.id === IDS.number ? { ...property, state: "retired" } : property,
    ),
  });
  for (const view of [
    tableView({
      filter: {
        mode: "all",
        criteria: [{ id: IDS.filter, propertyId: IDS.number, operator: "is-empty" }],
      },
    }),
    tableView({ sorts: [{ propertyId: IDS.number, direction: "ascending", missing: "first" }] }),
    tableView({ group: { propertyId: IDS.number } }),
    tableView({ sorts: [{ propertyId: IDS.entryA, direction: "ascending", missing: "first" }] }),
    tableView({ group: { propertyId: IDS.entryA } }),
    tableView({ group: { propertyId: IDS.text } }),
  ])
    expect(evaluateDatabaseView({ ...retired, views: [view] }, view.id, rows).ok).toBe(false);
  expect(evaluateDatabaseView(definition(), IDS.entryA, rows).ok).toBe(false);
});

it("sorts and groups unchecked, checked and missing values without losing any row", () => {
  for (const direction of ["ascending", "descending"] as const) {
    const sorted = evaluate(
      tableView({ sorts: [{ propertyId: IDS.checkbox, direction, missing: "first" }] }),
    );
    expect(sorted.rows.map((row) => row.entryId)).toEqual(
      direction === "ascending"
        ? [IDS.entryC, IDS.entryA, IDS.entryB]
        : [IDS.entryC, IDS.entryB, IDS.entryA],
    );
  }
  const grouped = evaluate(tableView({ group: { propertyId: IDS.checkbox } }));
  expect(grouped.groups).toEqual([
    { id: "unchecked", entryIds: [IDS.entryA] },
    { id: "checked", entryIds: [IDS.entryB] },
    { id: "missing", entryIds: [IDS.entryC] },
  ]);
  expect(
    evaluate(
      tableView({
        sorts: [{ propertyId: IDS.relation, direction: "descending", missing: "last" }],
      }),
    ).rows.map((row) => row.entryId),
  ).toEqual([IDS.entryB, IDS.entryA, IDS.entryC]);
  expect(
    evaluate(
      tableView({ sorts: [{ propertyId: IDS.multi, direction: "ascending", missing: "first" }] }),
    ).rows.map((row) => row.entryId),
  ).toEqual([IDS.entryC, IDS.entryA, IDS.entryB]);
});

it("filters instants inclusively and orders them independently of entry titles", () => {
  const model = definition({
    properties: definition().properties.map((p) =>
      p.type === "date" ? { ...p, config: { mode: "instant" } } : p,
    ),
  });
  const instantRows = [
    queryEntry(IDS.entryA, "A", {
      [IDS.date]: { kind: "instant", instant: "2026-09-30T00:00:00.000Z" },
    }),
    queryEntry(IDS.entryB, "B", {
      [IDS.date]: { kind: "instant", instant: "2026-09-01T00:00:00.000Z" },
    }),
    queryEntry(IDS.entryC, "C", {
      [IDS.date]: { kind: "instant", instant: "2026-10-01T00:00:00.000Z" },
    }),
  ];
  const view = tableView({
    filter: {
      mode: "all",
      criteria: [
        {
          id: IDS.filter,
          propertyId: IDS.date,
          operator: "between",
          operand: {
            kind: "instant-range",
            from: { kind: "instant", instant: "2026-09-01T00:00:00.000Z" },
            to: { kind: "instant", instant: "2026-09-30T00:00:00.000Z" },
          },
        },
      ],
    },
    sorts: [{ propertyId: IDS.date, direction: "ascending", missing: "last" }],
  });
  expect(evaluate(view, instantRows, model).rows.map((row) => row.entryId)).toEqual([
    IDS.entryB,
    IDS.entryA,
  ]);
});

it("keeps bounded first-page results identical to the complete ordering for arbitrary input permutations", () => {
  fc.assert(
    fc.property(
      fc.array(fc.option(fc.integer({ min: -50, max: 50 }), { nil: undefined }), {
        minLength: 20,
        maxLength: 100,
      }),
      fc.integer({ min: 1, max: 12 }),
      fc.boolean(),
      fc.boolean(),
      (numbers, maxRows, descending, first) => {
        const entries = numbers.map((number, i) =>
          queryEntry(
            asUuid(`018f2000-0000-7000-8000-${String(i).padStart(12, "0")}`),
            `Title ${i % 3}`,
            number === undefined
              ? {}
              : { [IDS.number]: { kind: "number", decimal: String(number) } },
          ),
        );
        const view = tableView({
          sorts: [
            {
              propertyId: IDS.number,
              direction: descending ? "descending" : "ascending",
              missing: first ? "first" : "last",
            },
          ],
        });
        const model = definition({ views: [view] });
        const full = evaluateDatabaseView(model, view.id, entries);
        const limited = evaluateDatabaseView(model, view.id, [...entries].reverse(), { maxRows });
        if (!full.ok || !limited.ok) throw new Error("Valid query refused");
        expect(limited.value.rows).toEqual(full.value.rows.slice(0, maxRows));
        expect(limited.value.totalCount).toBe(entries.length);
        for (const invalidMaximum of [0, -1, 1.5, Number.NaN]) {
          const invalid = evaluateDatabaseView(model, view.id, entries, {
            maxRows: invalidMaximum,
          });
          expect(invalid.ok && invalid.value.rows).toEqual([]);
        }
      },
    ),
    { numRuns: 100 },
  );
});
