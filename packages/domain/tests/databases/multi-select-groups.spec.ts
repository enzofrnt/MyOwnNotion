import { describe, expect, it } from "vitest";
import { type DatabaseView, evaluateDatabaseView } from "../../src/index.ts";
import { definition, IDS, queryEntry, tableView } from "./fixtures.ts";

describe("multi-select grouping", () => {
  it("groups each active membership once, retaining unique filtered and ordered rows", () => {
    const view = tableView({ group: { propertyId: IDS.multi } });
    const rows = [
      queryEntry(IDS.entryB, "Beta", {
        [IDS.multi]: { kind: "multi-select", optionIds: [IDS.doing] },
      }),
      queryEntry(IDS.entryA, "Alpha", {
        [IDS.multi]: { kind: "multi-select", optionIds: [IDS.todo, IDS.doing, IDS.todo] },
      }),
      queryEntry(IDS.entryC, "Gamma", { [IDS.multi]: { kind: "multi-select", optionIds: [] } }),
    ];
    const result = evaluateDatabaseView(definition({ views: [view] }), view.id, rows, {
      maxRows: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalCount).toBe(3);
    expect(result.value.rows.map(({ entryId }) => entryId)).toEqual([
      IDS.entryA,
      IDS.entryB,
      IDS.entryC,
    ]);
    expect(result.value.groups).toEqual([
      { id: IDS.todo, entryIds: [IDS.entryA] },
      { id: IDS.doing, entryIds: [IDS.entryA, IDS.entryB] },
      { id: "missing", entryIds: [IDS.entryC] },
    ]);
    const filtered = {
      ...view,
      filter: {
        mode: "all" as const,
        criteria: [
          {
            id: IDS.filter,
            propertyId: IDS.multi,
            operator: "contains" as const,
            operand: { kind: "multi-select" as const, optionIds: [IDS.todo] },
          },
        ],
      },
    };
    const only = evaluateDatabaseView(definition({ views: [filtered] }), filtered.id, rows);
    expect(only.ok && only.value.groups.map(({ entryIds }) => entryIds)).toEqual([
      [IDS.entryA],
      [IDS.entryA],
    ]);
  });

  it("uses the saved board axis even with a legacy null or unrelated group and ignores retired options", () => {
    const model = definition();
    const properties = model.properties.map((p) =>
      p.type === "multi-select"
        ? {
            ...p,
            config: {
              options: p.config.options.map((o) =>
                o.id === IDS.todo ? { ...o, state: "retired" as const } : o,
              ),
            },
          }
        : p,
    );
    const rows = [
      queryEntry(IDS.entryA, "Alpha", {
        [IDS.multi]: { kind: "multi-select", optionIds: [IDS.todo] },
      }),
    ];
    for (const group of [null, { propertyId: IDS.status }]) {
      const view: DatabaseView = {
        ...tableView(),
        type: "board",
        group,
        options: { axisPropertyId: IDS.multi, columnOrder: [], collapsedColumnIds: [] },
      };
      const result = evaluateDatabaseView({ ...model, properties, views: [view] }, view.id, rows);
      expect(result.ok && result.value.groups).toEqual([{ id: "missing", entryIds: [IDS.entryA] }]);
    }
  });
});
