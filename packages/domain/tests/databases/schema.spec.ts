import { describe, expect, it } from "vitest";
import {
  type DomainResult,
  jsonValuesEqual,
  previewDefinitionImpact,
  projectTaskSemantics,
  validateDatabaseDefinition,
} from "../../src/index.ts";
import { definition, IDS, values } from "./fixtures.ts";

function unwrap<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("invalid fixture");
  return value;
}

describe("database definitions", () => {
  it("compares JSON content independently of object key serialization order", () => {
    expect(
      jsonValuesEqual(
        { formatVersion: 1, options: { density: "comfortable", frozen: true } },
        { options: { frozen: true, density: "comfortable" }, formatVersion: 1 },
      ),
    ).toBe(true);
    expect(jsonValuesEqual({ order: ["a", "b"] }, { order: ["b", "a"] })).toBe(false);
  });

  it("requires exactly one active, immutable title property", () => {
    const valid = definition();
    expect(validateDatabaseDefinition(valid).ok).toBe(true);
    expect(
      validateDatabaseDefinition({
        ...valid,
        properties: valid.properties.filter((property) => property.type !== "title"),
      }).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition({
        ...valid,
        properties: [...valid.properties, { ...required(valid.properties[0]), id: IDS.relationA }],
      }).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition({
        ...valid,
        properties: valid.properties.map((property) =>
          property.type === "title" ? { ...property, state: "retired" as const } : property,
        ),
      }).ok,
    ).toBe(false);
  });

  it("preserves stable identities through rename and reorder and rejects duplicates", () => {
    const original = definition();
    const renamed = {
      ...original,
      properties: original.properties.map((property) =>
        property.id === IDS.text
          ? { ...property, name: "  Description  ", positionKey: "zz" }
          : property,
      ),
    };
    const normalized = unwrap(validateDatabaseDefinition(renamed));
    expect(normalized.properties.find((property) => property.id === IDS.text)).toMatchObject({
      id: IDS.text,
      name: "Description",
      positionKey: "zz",
    });
    expect(
      validateDatabaseDefinition({
        ...original,
        properties: [
          ...original.properties,
          { ...required(original.properties[1]), name: "Duplicate" },
        ],
      }).ok,
    ).toBe(false);
  });

  it("requires at least one active view and unique property, option and view identities", () => {
    const valid = definition();
    expect(
      validateDatabaseDefinition({
        ...valid,
        views: valid.views.map((view) => ({ ...view, state: "retired" as const })),
      }).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition({ ...valid, views: [...valid.views, required(valid.views[0])] })
        .ok,
    ).toBe(false);
    const status = required(valid.properties.find((property) => property.id === IDS.status));
    if (status.type !== "status") throw new Error("invalid fixture");
    expect(
      validateDatabaseDefinition({
        ...valid,
        properties: valid.properties.map((property) =>
          property.id === IDS.status
            ? {
                ...status,
                config: {
                  options: [...status.config.options, required(status.config.options[0])],
                },
              }
            : property,
        ),
      }).ok,
    ).toBe(false);
  });

  it("accepts only compatible active properties for task roles", () => {
    const valid = definition();
    const roles = valid.taskRoles;
    if (roles === null) throw new Error("invalid fixture");
    expect(validateDatabaseDefinition(valid).ok).toBe(true);
    expect(
      validateDatabaseDefinition({
        ...valid,
        taskRoles: { ...roles, statusPropertyId: IDS.text },
      }).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition({
        ...valid,
        taskRoles: { ...roles, dueDatePropertyId: IDS.number },
      }).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition({
        ...valid,
        taskRoles: { ...roles, priorityPropertyId: IDS.multi },
      }).ok,
    ).toBe(false);
    expect(validateDatabaseDefinition({ ...valid, taskRoles: null }).ok).toBe(true);
  });

  it("keeps task roles attached to stable property identities through rename", () => {
    const valid = definition();
    const renamed = {
      ...valid,
      properties: valid.properties.map((property) =>
        property.id === IDS.status ? { ...property, name: "Progression" } : property,
      ),
    };

    const normalized = unwrap(validateDatabaseDefinition(renamed));
    expect(normalized.taskRoles?.statusPropertyId).toBe(IDS.status);
    expect(normalized.properties.find(({ id }) => id === IDS.status)?.name).toBe("Progression");
  });

  it("projects task semantics from canonical values without creating a task record", () => {
    const projected = projectTaskSemantics(
      definition(),
      values(IDS.entryA, {
        [IDS.status]: { kind: "status", optionId: IDS.doing },
        [IDS.date]: { kind: "date", date: "2026-09-15" },
        [IDS.select]: { kind: "select", optionId: IDS.high },
      }),
    );

    expect(projected.ok).toBe(true);
    if (!projected.ok || projected.value === null) return;
    expect(projected.value).toEqual({
      entryId: IDS.entryA,
      status: {
        propertyId: IDS.status,
        value: { kind: "status", optionId: IDS.doing },
      },
      dueDate: {
        propertyId: IDS.date,
        value: { kind: "date", date: "2026-09-15" },
      },
      priority: {
        propertyId: IDS.select,
        value: { kind: "select", optionId: IDS.high },
      },
    });
    expect(Object.keys(projected.value).sort()).toEqual([
      "dueDate",
      "entryId",
      "priority",
      "status",
    ]);
  });

  it("computes a stable, content-free impact for destructive schema changes", async () => {
    const current = definition();
    const candidate = {
      ...current,
      properties: current.properties.map((property) =>
        property.id === IDS.number
          ? { ...property, type: "text" as const, config: {} }
          : property.id === IDS.status
            ? { ...property, state: "retired" as const }
            : property,
      ),
      taskRoles: null,
    };
    const entries = [
      values(IDS.entryB, {
        [IDS.number]: { kind: "number", decimal: "20" },
        [IDS.status]: { kind: "status", optionId: IDS.todo },
      }),
      values(IDS.entryA, { [IDS.number]: { kind: "number", decimal: "10" } }),
    ];

    const impact = await previewDefinitionImpact({
      baseRevisionId: IDS.revision,
      current,
      candidate,
      entries,
    });
    const reordered = await previewDefinitionImpact({
      baseRevisionId: IDS.revision,
      current,
      candidate,
      entries: [...entries].reverse(),
    });

    expect(impact).toMatchObject({
      destructive: true,
      affectedEntryCount: 2,
      affectedValueCount: 3,
    });
    expect(impact.reasons).toEqual(
      expect.arrayContaining([
        "property-retired",
        "property-type-changed",
        "task-role-invalidated",
      ]),
    );
    expect(impact.impactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toEqual(impact);
    expect(Object.keys(impact).sort()).toEqual([
      "affectedEntryCount",
      "affectedValueCount",
      "destructive",
      "impactDigest",
      "reasons",
    ]);
  });

  it("does not classify task-role remapping as destructive when values stay intact", async () => {
    const current = definition();
    const impact = await previewDefinitionImpact({
      baseRevisionId: IDS.revision,
      current,
      candidate: { ...current, taskRoles: null },
      entries: [values(IDS.entryA, { [IDS.status]: { kind: "status", optionId: IDS.todo } })],
    });

    expect(impact).toMatchObject({
      destructive: false,
      affectedEntryCount: 0,
      affectedValueCount: 0,
      reasons: ["task-role-invalidated"],
    });
  });
});

describe("task values and destructive option changes", () => {
  it("distinguishes disabled task roles from missing optional values", () => {
    expect(projectTaskSemantics(definition({ taskRoles: null }), values(IDS.entryA))).toEqual({
      ok: true,
      value: null,
    });
    expect(projectTaskSemantics(definition(), values(IDS.entryA))).toMatchObject({
      ok: true,
      value: {
        status: { propertyId: IDS.status, value: null },
        dueDate: { propertyId: IDS.date, value: null },
        priority: { propertyId: IDS.select, value: null },
      },
    });
    expect(
      projectTaskSemantics(
        definition({
          taskRoles: {
            statusPropertyId: IDS.status,
            dueDatePropertyId: null,
            priorityPropertyId: null,
          },
        }),
        values(IDS.entryA),
      ),
    ).toMatchObject({ ok: true, value: { dueDate: null, priority: null } });
  });
  it.each([IDS.status, IDS.date, IDS.select])(
    "refuses incompatible retained data in task field %s",
    (propertyId) => {
      expect(
        projectTaskSemantics(
          definition(),
          values(IDS.entryA, { [propertyId]: { kind: "text", value: "Retained original" } }),
        ).ok,
      ).toBe(false);
    },
  );
  it("preserves supported alternative task representations without casting their values", () => {
    const input = values(IDS.entryA, {
      [IDS.status]: { kind: "select", optionId: IDS.todo },
      [IDS.date]: { kind: "instant", instant: "2026-09-08T10:00:00Z" },
      [IDS.select]: { kind: "status", optionId: IDS.high },
    });
    expect(projectTaskSemantics(definition(), input)).toMatchObject({
      ok: true,
      value: {
        status: { value: input.values[IDS.status] },
        dueDate: { value: input.values[IDS.date] },
        priority: { value: input.values[IDS.select] },
      },
    });
  });
  it("refuses invalid definitions and foreign or unsupported entry envelopes", () => {
    expect(projectTaskSemantics(definition({ properties: [] }), values(IDS.entryA)).ok).toBe(false);
    const original = values(IDS.entryA);
    for (const patch of [
      { databaseId: IDS.entryB },
      { format: "foreign-format" },
      { formatVersion: 2 },
    ])
      expect(
        projectTaskSemantics(definition(), { ...original, ...patch } as unknown as typeof original)
          .ok,
      ).toBe(false);
  });
  it("counts only values that actually reference retired choices across select and multi-select", async () => {
    const current = definition({ taskRoles: null });
    const candidate = definition({
      taskRoles: null,
      properties: current.properties.map((property) =>
        property.type === "status" || property.type === "select" || property.type === "multi-select"
          ? {
              ...property,
              config: {
                options: property.config.options.map((option) =>
                  option.id === IDS.todo || option.id === IDS.high
                    ? { ...option, state: "retired" as const }
                    : option,
                ),
              },
            }
          : property,
      ),
    });
    const entries = [
      values(IDS.entryA, {
        [IDS.status]: { kind: "status", optionId: IDS.todo },
        [IDS.select]: { kind: "select", optionId: IDS.high },
        [IDS.multi]: { kind: "multi-select", optionIds: [IDS.todo, IDS.doing] },
      }),
      values(IDS.entryB, {
        [IDS.status]: { kind: "status", optionId: IDS.doing },
        [IDS.multi]: { kind: "multi-select", optionIds: [IDS.doing] },
      }),
    ];
    const result = await previewDefinitionImpact({
      baseRevisionId: IDS.revision,
      current,
      candidate,
      entries,
    });
    expect(result).toMatchObject({
      destructive: true,
      affectedEntryCount: 1,
      affectedValueCount: 3,
      reasons: ["option-retired"],
    });
    const reordered = await previewDefinitionImpact({
      baseRevisionId: IDS.revision,
      current,
      candidate,
      entries: [...entries].reverse(),
    });
    expect(reordered).toEqual(result);
  });
  it("counts removal of a property and refuses invalid or foreign candidate definitions", async () => {
    const current = definition();
    const entries = [
      values(IDS.entryA, { [IDS.text]: { kind: "text", value: "Keep recoverable" } }),
    ];
    expect(
      await previewDefinitionImpact({
        baseRevisionId: IDS.revision,
        current,
        candidate: definition({
          properties: current.properties.filter((property) => property.id !== IDS.text),
        }),
        entries,
      }),
    ).toMatchObject({
      affectedEntryCount: 1,
      affectedValueCount: 1,
      reasons: ["property-retired"],
      destructive: true,
    });
    for (const candidate of [
      definition({ databaseId: IDS.entryB }),
      definition({ properties: [] }),
    ])
      await expect(
        previewDefinitionImpact({ baseRevisionId: IDS.revision, current, candidate, entries }),
      ).rejects.toThrow("invalid database definition impact input");
  });
});
