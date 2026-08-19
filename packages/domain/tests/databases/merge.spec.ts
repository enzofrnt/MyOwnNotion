import { describe, expect, it } from "vitest";
import { mergeDatabaseDefinitions, mergeEntryValues } from "../../src/index.ts";
import { definition, IDS, values } from "./fixtures.ts";

describe("three-way database definition merge", () => {
  it("merges compatible edits to distinct stable identities", () => {
    const ancestor = definition();
    const local = {
      ...ancestor,
      properties: ancestor.properties.map((property) =>
        property.id === IDS.text ? { ...property, name: "Description" } : property,
      ),
    };
    const remote = {
      ...ancestor,
      views: ancestor.views.map((view) => ({ ...view, name: "Vue principale" })),
    };
    const outcome = mergeDatabaseDefinitions(ancestor, local, remote);
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") return;
    expect(outcome.value.properties.find((property) => property.id === IDS.text)?.name).toBe(
      "Description",
    );
    expect(outcome.value.views[0]?.name).toBe("Vue principale");
  });

  it("preserves all versions for a deletion against an edit", () => {
    const ancestor = definition();
    const local = {
      ...ancestor,
      properties: ancestor.properties.filter((property) => property.id !== IDS.text),
    };
    const remote = {
      ...ancestor,
      properties: ancestor.properties.map((property) =>
        property.id === IDS.text ? { ...property, name: "Changed remotely" } : property,
      ),
    };
    const outcome = mergeDatabaseDefinitions(ancestor, local, remote);
    expect(outcome.kind).toBe("needs-owner");
    if (outcome.kind !== "needs-owner") return;
    expect(outcome.conflicts).toContainEqual(
      expect.objectContaining({ path: `properties.${IDS.text}`, reason: "delete-edit" }),
    );
    expect(outcome).toMatchObject({ ancestor, local, remote });
  });
});

describe("three-way entry value merge", () => {
  it("merges different property values and identical edits", () => {
    const ancestor = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "before" },
      [IDS.number]: { kind: "number", decimal: "1" },
    });
    const local = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "local" },
      [IDS.number]: { kind: "number", decimal: "1" },
    });
    const remote = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "before" },
      [IDS.number]: { kind: "number", decimal: "2" },
    });
    const outcome = mergeEntryValues({ ancestor, local, remote });
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") return;
    expect(outcome.value.values).toEqual({
      [IDS.text]: { kind: "text", value: "local" },
      [IDS.number]: { kind: "number", decimal: "2" },
    });
  });

  it("reports divergent edits and deletion against edit without choosing a winner", () => {
    const ancestor = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "before" },
      [IDS.number]: { kind: "number", decimal: "1" },
    });
    const local = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "mine" },
    });
    const remote = values(IDS.entryA, {
      [IDS.text]: { kind: "text", value: "theirs" },
      [IDS.number]: { kind: "number", decimal: "2" },
    });
    const outcome = mergeEntryValues({ ancestor, local, remote });
    expect(outcome.kind).toBe("needs-owner");
    if (outcome.kind !== "needs-owner") return;
    expect(outcome.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: `values.${IDS.text}`, reason: "divergent-edit" }),
        expect.objectContaining({ path: `values.${IDS.number}`, reason: "delete-edit" }),
      ]),
    );
  });

  it("flags a schema type change against a concurrent old-type value edit", () => {
    const ancestorDefinition = definition();
    const localDefinition = {
      ...ancestorDefinition,
      properties: ancestorDefinition.properties.map((property) =>
        property.id === IDS.number ? { ...property, type: "text" as const, config: {} } : property,
      ),
    };
    const ancestor = values(IDS.entryA, {
      [IDS.number]: { kind: "number", decimal: "1" },
    });
    const remote = values(IDS.entryA, {
      [IDS.number]: { kind: "number", decimal: "2" },
    });
    const outcome = mergeEntryValues({
      ancestor,
      local: ancestor,
      remote,
      ancestorDefinition,
      localDefinition,
      remoteDefinition: ancestorDefinition,
    });
    expect(outcome.kind).toBe("needs-owner");
    if (outcome.kind !== "needs-owner") return;
    expect(outcome.conflicts).toContainEqual(
      expect.objectContaining({ path: `values.${IDS.number}`, reason: "type-value-incompatible" }),
    );
  });
});
