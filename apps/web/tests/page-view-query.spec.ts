import type { LocalDatabaseQuerySource } from "@myownnotion/client-core";
import { createInitialDatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { PageViewQuery } from "../src/features/databases/page-view-query.ts";

function fixture() {
  const databaseId = generateUuidV7();
  const viewId = generateUuidV7();
  const titlePropertyId = generateUuidV7();
  const definition = createInitialDatabaseDefinition({
    type: "database.create",
    id: databaseId,
    name: "Source",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId,
    initialViewId: viewId,
    initialViewName: "Table",
  });
  const source: Omit<LocalDatabaseQuerySource, "generation"> = {
    databaseId,
    definitionRevisionId: generateUuidV7(),
    definition,
    expectedCount: 1001,
    entries: Array.from({ length: 1001 }, (_, index) => ({
      entryId: generateUuidV7(),
      revisionId: generateUuidV7(),
      title: `Entry ${String(index).padStart(4, "0")}`,
      availability: "present",
      values: {},
      relationTargets: {},
    })),
  };
  return { source, viewId, titlePropertyId };
}

describe("page-backed view queries", () => {
  it("loads beyond 1000 entries without duplicate identities and retains a stable cursor across identical projections", async () => {
    const { source, viewId } = fixture();
    const query = new PageViewQuery();
    const generation = query.update(source, new Map());
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      expect(query.update(structuredClone(source), new Map())).toBe(generation);
      const result = await query.query(viewId, cursor);
      if (!result.ok) throw new Error(result.problem.code);
      expect(result.value.coverage).toBe("complete");
      expect(result.value.staleCursorRecovered).toBe(false);
      ids.push(...result.value.rows.map((row) => row.entryId));
      cursor = result.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(ids).toEqual(source.entries.map((row) => row.entryId));
    expect(new Set(ids).size).toBe(1001);
  });

  it("evaluates the selected container's filter over the whole source before pagination", async () => {
    const { source, viewId, titlePropertyId } = fixture();
    const query = new PageViewQuery();
    query.update(
      {
        ...source,
        definition: {
          ...source.definition,
          views: source.definition.views.map((view) => ({
            ...view,
            filter: {
              mode: "all",
              criteria: [
                {
                  id: generateUuidV7(),
                  propertyId: titlePropertyId,
                  operator: "contains",
                  operand: { kind: "text", value: "1000" },
                },
              ],
            },
          })),
        },
      },
      new Map(),
    );
    expect(await query.query(viewId)).toMatchObject({
      ok: true,
      value: { rows: [{ title: "Entry 1000" }], nextCursor: null },
    });
    expect(source.definition.views[0]?.filter.criteria).toEqual([]);
  });

  it("restarts an obsolete cursor against the changed source without mixing generations", async () => {
    const { source, viewId } = fixture();
    const query = new PageViewQuery();
    query.update(source, new Map());
    const first = await query.query(viewId);
    if (!first.ok || first.value.nextCursor === null) throw new Error("Missing cursor");
    query.update({ ...source, definitionRevisionId: generateUuidV7() }, new Map());
    const next = await query.query(viewId, first.value.nextCursor);
    expect(next).toMatchObject({ ok: true, value: { staleCursorRecovered: true, generation: 2 } });
    if (next.ok)
      expect(next.value.rows.map((row) => row.entryId)).toEqual(
        first.value.rows.map((row) => row.entryId),
      );
  });

  it("reports partial availability and pending/conflicted rows honestly", async () => {
    const { source, viewId } = fixture();
    const first = source.entries[0];
    const second = source.entries[1];
    if (first === undefined || second === undefined) throw new Error("Missing rows");
    const query = new PageViewQuery();
    query.update(
      {
        ...source,
        entries: source.entries.map((row, index) =>
          index === 2 ? { ...row, availability: "offloaded" } : row,
        ),
      },
      new Map([
        [first.entryId, "pending"],
        [second.entryId, "conflict"],
      ]),
    );
    const result = await query.query(viewId);
    expect(result).toMatchObject({
      ok: true,
      value: { coverage: "partial", availableCount: 1000, expectedCount: 1001 },
    });
    if (result.ok)
      expect(result.value.rows.slice(0, 3).map((row) => row.syncState)).toEqual([
        "pending",
        "conflict",
        "synced",
      ]);
    expect(await query.query(generateUuidV7())).toMatchObject({
      ok: false,
      problem: { code: "database.invalid-view" },
    });
    expect(await query.query(viewId, "malformed")).toMatchObject({
      ok: false,
      problem: { code: "database.invalid-cursor" },
    });
  });
});
