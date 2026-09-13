import { describe, expect, it } from "vitest";
import {
  type DatabaseEmbedding,
  databaseDefinitionForEmbedding,
  databaseEmbeddings,
  databaseQueryDefinition,
  evaluateDatabaseView,
  generateUuidV7,
  mergeDatabaseDefinitions,
  replaceDatabaseEmbeddingDefinition,
  validateDatabaseDefinition,
} from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing test fixture");
  return value;
}

function displays(): readonly DatabaseEmbedding[] {
  return [1, 2].map(() => ({
    id: generateUuidV7(),
    hostPageId: generateUuidV7(),
    state: "active",
    views: definition().views.map((view) => ({ ...view, id: generateUuidV7() })),
  }));
}

describe("independent database displays", () => {
  it("reads a legacy host as a display but preserves an explicitly empty source", () => {
    expect(databaseEmbeddings(definition())[0]).toMatchObject({
      id: IDS.database,
      hostPageId: IDS.database,
    });
    expect(databaseEmbeddings(definition({ embeddings: [] }))).toEqual([]);
    expect(databaseDefinitionForEmbedding(definition({ embeddings: [] }), IDS.database)).toBeNull();
  });
  it("isolates view edits while preserving shared properties and canonical entry IDs", () => {
    const embeddings = displays();
    const source = definition({ embeddings });
    const first = required(embeddings[0]);
    const second = required(embeddings[1]);
    const display = required(databaseDefinitionForEmbedding(source, first.id));
    const candidate = {
      ...display,
      views: display.views.map((view) => ({ ...view, name: "Only this page" })),
    };
    const changed = replaceDatabaseEmbeddingDefinition(source, first.id, candidate);
    expect(databaseDefinitionForEmbedding(changed, first.id)?.views[0]?.name).toBe(
      "Only this page",
    );
    expect(databaseDefinitionForEmbedding(changed, second.id)?.views).toEqual(second.views);
    const query = evaluateDatabaseView(
      databaseQueryDefinition(changed),
      required(first.views[0]).id,
      [{ entryId: IDS.entryA, title: "A", values: {}, relationTargets: {} }],
    );
    expect(query.ok && query.value.rows[0]?.entryId).toBe(IDS.entryA);
  });
  it("merges changes to separate displays without losing either view", () => {
    const ancestor = definition({ embeddings: displays() });
    const first = required(ancestor.embeddings?.[0]);
    const second = required(ancestor.embeddings?.[1]);
    const local = replaceDatabaseEmbeddingDefinition(ancestor, first.id, {
      ...ancestor,
      views: first.views.map((view) => ({ ...view, name: "First" })),
    });
    const remote = replaceDatabaseEmbeddingDefinition(ancestor, second.id, {
      ...ancestor,
      views: second.views.map((view) => ({ ...view, name: "Second" })),
    });
    const result = mergeDatabaseDefinitions(ancestor, local, remote);
    expect(result.kind).toBe("merged");
    if (result.kind === "merged")
      expect(result.value.embeddings?.map((value) => value.views[0]?.name)).toEqual([
        "First",
        "Second",
      ]);
  });
  it("rejects repeated placement identities, invalid hosts and views without active tabs", () => {
    const embedding = required(displays()[0]);
    expect(
      validateDatabaseDefinition(
        definition({
          embeddings: [
            embedding,
            { ...embedding, id: generateUuidV7(), hostPageId: generateUuidV7() },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(validateDatabaseDefinition(definition({ embeddings: [embedding, embedding] })).ok).toBe(
      false,
    );
    expect(
      validateDatabaseDefinition(
        definition({ embeddings: [{ ...embedding, hostPageId: "invalid" as never }] }),
      ).ok,
    ).toBe(false);
    expect(
      validateDatabaseDefinition(definition({ embeddings: [{ ...embedding, views: [] }] })).ok,
    ).toBe(false);
  });
});
