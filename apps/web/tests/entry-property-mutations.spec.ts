import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { saveEntryPropertyChanges } from "../src/features/databases/edit-entry-properties.ts";
import {
  duplicateEntryProperty,
  reorderEntryProperties,
} from "../src/features/databases/entry-property-list.tsx";
import {
  propertyWithType,
  updateEntryProperty,
} from "../src/features/databases/property-configuration.tsx";
import type { LocalContentService } from "../src/services/local-content.ts";
import { reviewDefinition } from "../src/ui/ui-lab-review-fixtures.ts";

function serviceFixture() {
  const entryId = generateUuidV7(),
    databaseId = generateUuidV7(),
    edited = generateUuidV7(),
    other = generateUuidV7();
  const replace = vi.fn().mockResolvedValue({ ok: true });
  const service = {
    getItem: vi.fn().mockResolvedValue({ currentRevisionId: generateUuidV7() }),
    getDatabaseEntry: vi.fn().mockResolvedValue({
      values: { values: { [other]: { kind: "text", value: "new remote value" } } },
    }),
    getDatabaseEntryRelationTargets: vi.fn().mockResolvedValue({}),
    replaceDatabaseEntryValues: replace,
  } as unknown as LocalContentService;
  return { service, replace, entryId, databaseId, edited, other };
}
describe("automatic entry changes preserve other revisions", () => {
  it("merges changed fields into the latest values and keeps unrelated data", async () => {
    const f = serviceFixture();
    await saveEntryPropertyChanges(
      f.service,
      f.databaseId,
      f.entryId,
      { [f.edited]: { kind: "text", value: "mine" } },
      {},
      { propertyIds: [f.edited], previousValues: {}, previousRelations: {} },
    );
    expect(f.replace.mock.calls[0]?.[2].values).toEqual({
      [f.other]: { kind: "text", value: "new remote value" },
      [f.edited]: { kind: "text", value: "mine" },
    });
  });
  it("detects a divergent edit of the same property before writing", async () => {
    const f = serviceFixture();
    vi.mocked(f.service.getDatabaseEntry).mockResolvedValue({
      values: { values: { [f.edited]: { kind: "text", value: "another owner edit" } } },
    } as never);
    await expect(
      saveEntryPropertyChanges(
        f.service,
        f.databaseId,
        f.entryId,
        { [f.edited]: { kind: "text", value: "mine" } },
        {},
        { propertyIds: [f.edited], previousValues: {}, previousRelations: {} },
      ),
    ).rejects.toThrow("changé ailleurs");
    expect(f.replace).not.toHaveBeenCalled();
  });
  it("accepts an echo of a confirmed local write and removes only cleared fields", async () => {
    const f = serviceFixture();
    vi.mocked(f.service.getDatabaseEntry).mockResolvedValue({
      values: {
        values: {
          [f.edited]: { kind: "text", value: "mine" },
          [f.other]: { kind: "text", value: "keep" },
        },
      },
    } as never);
    await saveEntryPropertyChanges(
      f.service,
      f.databaseId,
      f.entryId,
      { [f.edited]: { kind: "text", value: "mine" } },
      {},
      { propertyIds: [f.edited], previousValues: {}, previousRelations: {} },
    );
    await saveEntryPropertyChanges(
      f.service,
      f.databaseId,
      f.entryId,
      {},
      {},
      {
        propertyIds: [f.edited],
        previousValues: { [f.edited]: { kind: "text", value: "mine" } },
        previousRelations: {},
      },
    );
    expect(f.replace.mock.calls[1]?.[2].values).toEqual({
      [f.other]: { kind: "text", value: "keep" },
    });
  });
  it("retries a stale page revision without replacing unrelated fields", async () => {
    const f = serviceFixture();
    f.replace.mockResolvedValueOnce({
      ok: false,
      error: { code: "revision.stale-base", title: "stale" },
    });
    await saveEntryPropertyChanges(
      f.service,
      f.databaseId,
      f.entryId,
      { [f.edited]: { kind: "checkbox", checked: true } },
      {},
      { propertyIds: [f.edited], previousValues: {}, previousRelations: {} },
    );
    expect(f.replace).toHaveBeenCalledTimes(2);
    expect(f.service.getItem).toHaveBeenCalledTimes(2);
  });
  it("keeps relation and scalar values exclusive when changing a relation", async () => {
    const f = serviceFixture(),
      target = generateUuidV7();
    await saveEntryPropertyChanges(
      f.service,
      f.databaseId,
      f.entryId,
      {},
      { [f.edited]: [target] },
      { propertyIds: [f.edited], previousValues: {}, previousRelations: {} },
    );
    expect(f.replace.mock.calls[0]?.[2].relationTargets[f.edited]).toEqual([target]);
    expect(f.replace.mock.calls[0]?.[2].values[f.edited]).toBeUndefined();
  });
});
describe("source property operations", () => {
  it("preserves a source property icon through rename, type, duplication and reorder", () => {
    const source = reviewDefinition.properties.find((p) => p.type === "text");
    if (source === undefined) throw Error();
    const original = updateEntryProperty(reviewDefinition, source.id, (p) => ({
      ...p,
      icon: "lightbulb",
    }));
    const renamed = updateEntryProperty(original, source.id, (p) => ({ ...p, name: "Brief" }));
    const typed = updateEntryProperty(renamed, source.id, (p) => propertyWithType(p, "number"));
    const duplicated = duplicateEntryProperty(typed, source.id);
    const copy = duplicated.properties.at(-1);
    expect(copy).toMatchObject({ name: "Brief (copie)", icon: "lightbulb", type: "number" });
    if (copy === undefined) throw Error();
    const reordered = reorderEntryProperties(duplicated, copy.id, source.id, "before");
    expect(reordered.properties.find((p) => p.id === source.id)).toMatchObject({
      icon: "lightbulb",
      name: "Brief",
      type: "number",
    });
    expect(reordered.views).toEqual(duplicated.views);
  });
  const properties = reviewDefinition.properties.filter((p) => p.type !== "title");
  const id = (at: number) => properties[at]?.id as Uuid;
  it("reorders source properties without changing view column order or task mappings", () => {
    const before = reviewDefinition;
    const after = reorderEntryProperties(before, id(0), id(2), "after");
    expect(after.views).toEqual(before.views);
    expect(after.taskRoles).toEqual(before.taskRoles);
    expect(after.properties.findIndex((p) => p.id === id(0))).toBeGreaterThan(
      after.properties.findIndex((p) => p.id === id(2)),
    );
    for (const p of before.properties)
      expect(after.properties.find((a) => a.id === p.id)).toMatchObject({
        id: p.id,
        name: p.name,
        type: p.type,
        config: p.config,
      });
  });
  it("does not reorder the title or invent a missing target", () => {
    const title = reviewDefinition.properties.find((p) => p.type === "title");
    if (title === undefined) throw Error();
    expect(reorderEntryProperties(reviewDefinition, title.id, id(0), "after")).toBe(
      reviewDefinition,
    );
    expect(reorderEntryProperties(reviewDefinition, id(0), generateUuidV7(), "before")).toBe(
      reviewDefinition,
    );
  });
  it("duplicates the schema with new property and option identities without copying values", () => {
    const after = duplicateEntryProperty(reviewDefinition, id(0));
    const copy = after.properties.at(-1);
    const source = properties[0];
    expect(copy?.id).not.toBe(source?.id);
    expect(copy?.name).toContain("copie");
    if (source?.type !== "status" || copy?.type !== "status") throw Error();
    expect(copy.config.options.map((o) => o.label)).toEqual(
      source.config.options.map((o) => o.label),
    );
    expect(copy.config.options[0]?.id).not.toBe(source.config.options[0]?.id);
    expect(after.views.every((v) => v.properties.some((p) => p.propertyId === copy.id))).toBe(true);
  });
  it("preserves option IDs when toggling multiple values", () => {
    const p = properties[0];
    if (p === undefined) throw Error();
    const after = propertyWithType(p, "multi-select");
    expect(after.id).toBe(p.id);
    expect(after.config).toEqual(p.config);
  });
  it("clears only incompatible task roles when changing a property type", () => {
    const status = id(0),
      due = id(1),
      priority = id(6);
    const d: DatabaseDefinition = {
      ...reviewDefinition,
      taskRoles: { statusPropertyId: status, dueDatePropertyId: due, priorityPropertyId: priority },
    };
    expect(updateEntryProperty(d, due, (p) => propertyWithType(p, "text")).taskRoles).toEqual({
      ...d.taskRoles,
      dueDatePropertyId: null,
    });
    expect(
      updateEntryProperty(d, status, (p) => propertyWithType(p, "checkbox")).taskRoles,
    ).toBeNull();
  });
});

describe("source schema persistence and impact confirmation", () => {
  it.each(["properties", "taskRoles"] as const)(
    "refuses a %s change before reading incomplete memberships or writing even with confirmation",
    async (field) => {
      const { editEntrySourceDefinition } = await import(
        "../src/features/databases/edit-entry-properties.ts"
      );
      const property = reviewDefinition.properties.find((p) => p.type === "text");
      const status = reviewDefinition.properties.find((p) => p.type === "status");
      if (property === undefined || status === undefined)
        throw new Error("Missing source properties");
      const sourceId = generateUuidV7();
      const memberships = vi.fn().mockResolvedValue([]);
      const replace = vi.fn().mockResolvedValue({ ok: true });
      const service = {
        getSnapshot: () => ({ projectionComplete: false }),
        getDatabase: vi.fn().mockResolvedValue({
          itemId: reviewDefinition.databaseId,
          sourceId,
          definitionRevisionId: generateUuidV7(),
          definition: reviewDefinition,
        }),
        getItem: vi.fn().mockResolvedValue({ currentRevisionId: generateUuidV7() }),
        listDatabaseEntries: memberships,
        replaceDatabaseDefinition: replace,
      } as unknown as LocalContentService;
      await expect(
        editEntrySourceDefinition(
          service,
          sourceId,
          (definition) =>
            field === "properties"
              ? updateEntryProperty(definition, property.id, (p) => propertyWithType(p, "number"))
              : {
                  ...definition,
                  taskRoles:
                    definition.taskRoles === null
                      ? {
                          statusPropertyId: status.id,
                          dueDatePropertyId: null,
                          priorityPropertyId: null,
                        }
                      : null,
                },
          true,
        ),
      ).rejects.toThrow("Attendez la fin du chargement des entrées");
      expect(memberships).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("does not include legacy primary memberships when editing a secondary source", async () => {
    const { editEntrySourceDefinition } = await import(
      "../src/features/databases/edit-entry-properties.ts"
    );
    const primarySourceId = generateUuidV7();
    const secondarySourceId = generateUuidV7();
    const revision = generateUuidV7();
    const replace = vi.fn().mockResolvedValue({ ok: true });
    const service = {
      getSnapshot: () => ({ projectionComplete: true }),
      getDatabase: vi.fn(async (key) => ({
        itemId: reviewDefinition.databaseId,
        sourceId: key === secondarySourceId ? secondarySourceId : primarySourceId,
        definitionRevisionId: revision,
        definition: reviewDefinition,
      })),
      getItem: vi.fn().mockResolvedValue({ currentRevisionId: revision }),
      listDatabaseEntries: vi
        .fn()
        .mockResolvedValue([
          { availability: "offloaded" },
          { sourceId: primarySourceId, availability: "offloaded" },
        ]),
      replaceDatabaseDefinition: replace,
    } as unknown as LocalContentService;
    const property = reviewDefinition.properties.find((p) => p.type === "text");
    if (property === undefined) throw Error();
    await editEntrySourceDefinition(service, secondarySourceId, (d) =>
      updateEntryProperty(d, property.id, (p) => ({ ...p, name: "Secondary only" })),
    );
    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0]?.[1]).toMatchObject({ sourceId: secondarySourceId });
  });

  it("targets the owned source and retains the complete presentation when renaming", async () => {
    const { editEntrySourceDefinition } = await import(
      "../src/features/databases/edit-entry-properties.ts"
    );
    const sourceId = generateUuidV7(),
      revision = generateUuidV7();
    const replace = vi.fn().mockResolvedValue({ ok: true });
    const service = {
      getSnapshot: () => ({ projectionComplete: true }),
      getDatabase: vi.fn().mockResolvedValue({
        itemId: reviewDefinition.databaseId,
        sourceId,
        definitionRevisionId: revision,
        definition: reviewDefinition,
      }),
      getItem: vi.fn().mockResolvedValue({ currentRevisionId: generateUuidV7() }),
      listDatabaseEntries: vi.fn().mockResolvedValue([]),
      replaceDatabaseDefinition: replace,
    } as unknown as LocalContentService;
    const property = reviewDefinition.properties.find((p) => p.type === "text");
    if (property === undefined) throw Error();
    const saved = await editEntrySourceDefinition(service, reviewDefinition.databaseId, (d) =>
      updateEntryProperty(d, property.id, (p) => ({ ...p, name: "Renamed" })),
    );
    expect(replace.mock.calls[0]?.[0]).toBe(reviewDefinition.databaseId);
    expect(replace.mock.calls[0]?.[1]).toMatchObject({ baseRevisionId: revision, sourceId });
    expect(saved.views).toEqual(reviewDefinition.views);
  });
  it("requires impact confirmation before type changes and preserves incompatible values", async () => {
    const { editEntrySourceDefinition, EntrySchemaImpact } = await import(
      "../src/features/databases/edit-entry-properties.ts"
    );
    const revision = generateUuidV7(),
      property = reviewDefinition.properties.find((p) => p.type === "text");
    if (property === undefined) throw Error();
    const replace = vi.fn().mockResolvedValue({ ok: true });
    const service = {
      getSnapshot: () => ({ projectionComplete: true }),
      getDatabase: vi.fn().mockResolvedValue({
        itemId: reviewDefinition.databaseId,
        definitionRevisionId: revision,
        definition: reviewDefinition,
      }),
      getItem: vi.fn().mockResolvedValue({ currentRevisionId: revision }),
      listDatabaseEntries: vi.fn().mockResolvedValue([]),
      replaceDatabaseDefinition: replace,
    } as unknown as LocalContentService;
    const edit = (d: DatabaseDefinition) =>
      updateEntryProperty(d, property.id, (p) => propertyWithType(p, "number"));
    await expect(
      editEntrySourceDefinition(service, reviewDefinition.databaseId, edit),
    ).rejects.toBeInstanceOf(EntrySchemaImpact);
    expect(replace).not.toHaveBeenCalled();
    await editEntrySourceDefinition(service, reviewDefinition.databaseId, edit, true);
    expect(replace.mock.calls[0]?.[1].impactConfirmation).toMatchObject({
      decision: "preserve-incompatible",
    });
  });
});

describe("option edits merge safely", () => {
  it("keeps a queued rename while changing its color from an older menu", async () => {
    const { mergeChoiceOptionEdits } = await import(
      "../src/features/databases/edit-entry-properties.ts"
    );
    const property = reviewDefinition.properties.find((p) => p.type === "status");
    if (property?.type !== "status") throw Error();
    const baseline = property.config.options;
    const first = baseline[0];
    if (first === undefined) throw Error();
    const current = baseline.map((o) => (o.id === first.id ? { ...o, label: "Renamed" } : o));
    const candidate = baseline.map((o) => (o.id === first.id ? { ...o, tone: "red" } : o));
    expect(mergeChoiceOptionEdits(current, baseline, candidate)[0]).toMatchObject({
      label: "Renamed",
      tone: "red",
      id: first.id,
    });
  });
});
