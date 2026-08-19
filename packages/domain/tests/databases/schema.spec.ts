import { describe, expect, it } from "vitest";
import {
  type DomainResult,
  previewDefinitionImpact,
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
});
