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
