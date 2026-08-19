import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  asUuid,
  type DatabaseQueryEntry,
  type DatabaseView,
  type DomainResult,
  evaluateDatabaseView,
  type FilterCriterion,
} from "../../src/index.ts";
import { definition, IDS, queryEntry, tableView } from "./fixtures.ts";

function unwrap<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function idsFor(view: DatabaseView, entries: readonly DatabaseQueryEntry[]) {
  return unwrap(evaluateDatabaseView(definition({ views: [view] }), view.id, entries)).rows.map(
    (entry) => entry.entryId,
  );
}

describe("saved database query evaluation", () => {
  const entries = [
    queryEntry(IDS.entryA, "Éclair", {
      [IDS.number]: { kind: "number", decimal: "2" },
      [IDS.status]: { kind: "status", optionId: IDS.todo },
      [IDS.checkbox]: { kind: "checkbox", checked: false },
    }),
    queryEntry(IDS.entryB, "eclair", {
      [IDS.number]: { kind: "number", decimal: "10" },
      [IDS.status]: { kind: "status", optionId: IDS.doing },
      [IDS.checkbox]: { kind: "checkbox", checked: true },
    }),
    queryEntry(IDS.entryC, "Autre", {
      [IDS.checkbox]: { kind: "checkbox", checked: false },
    }),
  ] as const;

  it("implements explicit ALL and ANY semantics, including empty sets", () => {
    const criteria: FilterCriterion[] = [
      {
        id: IDS.filter,
        propertyId: IDS.number,
        operator: "greater-than" as const,
        operand: { kind: "number", decimal: "1" },
      },
      {
        id: IDS.relationA,
        propertyId: IDS.status,
        operator: "equals" as const,
        operand: { kind: "status", optionId: IDS.todo },
      },
    ];
    expect(idsFor(tableView({ filter: { mode: "all", criteria } }), entries)).toEqual([IDS.entryA]);
    expect(idsFor(tableView({ filter: { mode: "any", criteria } }), entries)).toEqual([
      IDS.entryB,
      IDS.entryA,
    ]);
    expect(idsFor(tableView({ filter: { mode: "all", criteria: [] } }), entries)).toHaveLength(3);
    expect(idsFor(tableView({ filter: { mode: "any", criteria: [] } }), entries)).toHaveLength(3);
  });

  it("sorts numbers canonically, then normalized/raw title, then entry identity", () => {
    const view = tableView({
      sorts: [{ propertyId: IDS.number, direction: "ascending", missing: "last" }],
    });
    expect(idsFor(view, [entries[1], entries[2], entries[0]])).toEqual([
      IDS.entryA,
      IDS.entryB,
      IDS.entryC,
    ]);
  });

  it("puts every entry in exactly one stable group, including missing", () => {
    const view = tableView({ group: { propertyId: IDS.status } });
    const result = unwrap(evaluateDatabaseView(definition({ views: [view] }), view.id, entries));
    expect(result.groups.map((group) => group.id)).toEqual([IDS.todo, IDS.doing, "missing"]);
    const grouped = result.groups.flatMap((group) => group.entryIds);
    expect(grouped).toHaveLength(entries.length);
    expect(new Set(grouped)).toEqual(new Set(entries.map((entry) => entry.entryId)));
  });

  it("applies typed text, presence, relation and date-range operators", () => {
    const datedEntries = [
      queryEntry(
        IDS.entryA,
        "Alpha",
        {
          [IDS.text]: { kind: "text", value: "Résumé important" },
          [IDS.date]: { kind: "date", date: "2026-08-20" },
        },
        { [IDS.relation]: [IDS.relationA, IDS.relationB] },
      ),
      queryEntry(IDS.entryB, "Beta", {
        [IDS.text]: { kind: "text", value: "Sans rapport" },
        [IDS.date]: { kind: "date", date: "2026-09-01" },
      }),
      queryEntry(IDS.entryC, "Gamma"),
    ];
    const view = tableView({
      filter: {
        mode: "all",
        criteria: [
          {
            id: IDS.filter,
            propertyId: IDS.text,
            operator: "contains",
            operand: { kind: "text", value: "resume" },
          },
          {
            id: IDS.relationA,
            propertyId: IDS.relation,
            operator: "contains",
            operand: { kind: "relation", targetIds: [IDS.relationB] },
          },
          {
            id: IDS.relationB,
            propertyId: IDS.date,
            operator: "between",
            operand: {
              kind: "date-range",
              from: { kind: "date", date: "2026-08-01" },
              to: { kind: "date", date: "2026-08-31" },
            },
          },
        ],
      },
    });
    expect(idsFor(view, datedEntries)).toEqual([IDS.entryA]);

    const missing = tableView({
      filter: {
        mode: "all",
        criteria: [{ id: IDS.filter, propertyId: IDS.text, operator: "is-empty" }],
      },
    });
    expect(idsFor(missing, datedEntries)).toEqual([IDS.entryC]);
  });

  it("is invariant to input order across 10,000 generated entry evaluations", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 100, maxLength: 100 }),
        (numbers) => {
          const generated = numbers.map((number, index) =>
            queryEntry(
              asUuid(`018f1000-0000-7000-8000-${String(index).padStart(12, "0")}`),
              `Entrée ${index % 11}`,
              { [IDS.number]: { kind: "number", decimal: String(number) } },
            ),
          );
          const view = tableView({
            sorts: [{ propertyId: IDS.number, direction: "ascending", missing: "last" }],
          });
          expect(idsFor(view, generated)).toEqual(idsFor(view, [...generated].reverse()));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("keeps the same filtered identities and order across all five view types", () => {
    const base = tableView({
      filter: {
        mode: "all",
        criteria: [
          {
            id: IDS.filter,
            propertyId: IDS.checkbox,
            operator: "equals",
            operand: { kind: "checkbox", checked: false },
          },
        ],
      },
    });
    const views: DatabaseView[] = [
      base,
      {
        ...base,
        id: IDS.relationA,
        type: "board",
        options: {
          axisPropertyId: IDS.status,
          columnOrder: [IDS.todo, IDS.doing],
          collapsedColumnIds: [],
        },
      },
      {
        ...base,
        id: IDS.relationB,
        type: "gallery",
        options: { cardPropertyIds: [IDS.status], preview: "none" },
      },
      {
        ...base,
        id: IDS.entryA,
        type: "list",
        options: { density: "comfortable", secondaryPropertyIds: [IDS.status] },
      },
      {
        ...base,
        id: IDS.entryB,
        type: "calendar",
        options: { datePropertyId: IDS.date, initialMode: "month" },
      },
    ];
    const outcomes = views.map((view) => idsFor(view, entries));
    expect(
      outcomes.every((outcome) => JSON.stringify(outcome) === JSON.stringify(outcomes[0])),
    ).toBe(true);
  });
});
