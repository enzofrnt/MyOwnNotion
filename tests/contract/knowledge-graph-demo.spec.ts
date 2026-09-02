import { describe, expect, it } from "vitest";
import {
  assertKnowledgeGraphDemoTarget,
  buildKnowledgeGraphDemoFixture,
  DEMO_EXPECTED,
  DEMO_PASSWORD,
} from "../../scripts/dev/knowledge-graph-demo-fixture.ts";

describe("knowledge graph demo fixture", () => {
  it("covers the exact bounded corpus and every required graph category", () => {
    const fixture = buildKnowledgeGraphDemoFixture();
    const itemIds = new Set(fixture.items.map(({ id }) => id));
    const relationshipKeys = fixture.relationships.map(
      ({ sourceItemId, targetItemId, relationType }) =>
        `${sourceItemId}\u0000${targetItemId}\u0000${relationType}`,
    );
    const multiplicities = new Map<string, number>();
    for (const key of relationshipKeys) {
      multiplicities.set(key, (multiplicities.get(key) ?? 0) + 1);
    }
    const directions = new Set(
      fixture.relationships.map(
        ({ sourceItemId, targetItemId }) => `${sourceItemId}/${targetItemId}`,
      ),
    );

    expect(fixture.summary).toEqual(DEMO_EXPECTED);
    expect(fixture.items).toHaveLength(DEMO_EXPECTED.items);
    expect(itemIds.size).toBe(DEMO_EXPECTED.items);
    expect(fixture.relationships).toHaveLength(DEMO_EXPECTED.relationships);
    expect(
      fixture.relationships.every(
        ({ sourceItemId, targetItemId }) => itemIds.has(sourceItemId) && itemIds.has(targetItemId),
      ),
    ).toBe(true);
    expect(fixture.items.filter(({ role }) => role === "folder")).toHaveLength(8);
    expect(fixture.items.filter(({ role }) => role === "database")).toHaveLength(1);
    expect(fixture.items.filter(({ role }) => role === "task")).toHaveLength(40);
    expect(fixture.items.filter(({ role }) => role === "file")).toHaveLength(1);
    expect(fixture.documents).toHaveLength(190);
    expect(
      fixture.documents.every(({ heading, summary }) => heading.length > 10 && summary.length > 80),
    ).toBe(true);
    expect(fixture.documents.filter(({ links }) => links.length === 2)).toHaveLength(
      DEMO_EXPECTED.documentSourcesWithTwoLinks,
    );
    expect(fixture.documents.filter(({ links }) => links.length === 1)).toHaveLength(
      DEMO_EXPECTED.documentSourcesWithOneLink,
    );
    expect(fixture.documents.filter(({ links }) => links.length === 0)).toHaveLength(
      DEMO_EXPECTED.isolatedItems,
    );
    const documentRelationshipKeys = new Set(
      fixture.relationships
        .filter(({ origin }) => origin === "document")
        .map(({ sourceItemId, targetItemId }) => `${sourceItemId}/${targetItemId}`),
    );
    expect(
      fixture.documents.flatMap(({ itemId, links }) =>
        links.map(({ targetItemId, targetName, leadIn }) => ({
          key: `${itemId}/${targetItemId}`,
          readable: targetName.length > 10 && leadIn.length > 20,
        })),
      ),
    ).toSatisfy(
      (links: { readonly key: string; readonly readable: boolean }[]) =>
        links.length === DEMO_EXPECTED.documentRelationships &&
        links.every(({ key, readable }) => readable && documentRelationshipKeys.has(key)),
    );
    expect(fixture.isolatedItemIds).toHaveLength(8);
    expect(
      fixture.items.filter((item) => {
        if (item.role !== "page" || item.parentId === null) return false;
        return fixture.items.find((candidate) => candidate.id === item.parentId)?.role === "page";
      }),
    ).toHaveLength(174);
    expect(
      fixture.relationships.filter(
        ({ origin, sourceItemId, targetItemId }) =>
          origin === "document" &&
          fixture.items.some((item) => item.id === sourceItemId && item.parentId === targetItemId),
      ),
    ).toHaveLength(174);
    expect(
      fixture.relationships.filter(
        ({ origin, crossBranch }) => origin === "document" && crossBranch,
      ),
    ).toHaveLength(3);
    const adjacency = new Map<string, Set<string>>();
    for (const { origin, sourceItemId, targetItemId } of fixture.relationships) {
      if (origin !== "document") continue;
      const sourceNeighbors = adjacency.get(sourceItemId) ?? new Set<string>();
      const targetNeighbors = adjacency.get(targetItemId) ?? new Set<string>();
      sourceNeighbors.add(targetItemId);
      targetNeighbors.add(sourceItemId);
      adjacency.set(sourceItemId, sourceNeighbors);
      adjacency.set(targetItemId, targetNeighbors);
    }
    const remaining = new Set(
      fixture.items
        .filter(({ role, branchIndex }) => role === "page" && branchIndex !== null)
        .map(({ id }) => id as string),
    );
    let componentCount = 0;
    while (remaining.size > 0) {
      componentCount += 1;
      const first = remaining.values().next().value;
      if (first === undefined) break;
      remaining.delete(first);
      const stack = [first];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        for (const neighbor of adjacency.get(current) ?? []) {
          if (remaining.delete(neighbor)) stack.push(neighbor);
        }
      }
    }
    expect(componentCount).toBe(DEMO_EXPECTED.knowledgeComponents);
    expect(
      fixture.isolatedItemIds.every((id) => {
        const item = fixture.items.find((candidate) => candidate.id === id);
        return (
          item?.parentId === null &&
          !fixture.relationships.some(
            ({ sourceItemId, targetItemId }) => sourceItemId === id || targetItemId === id,
          )
        );
      }),
    ).toBe(true);
    expect([...multiplicities.values()].some((count) => count > 1)).toBe(true);
    expect(
      fixture.relationships.some(({ sourceItemId, targetItemId }) =>
        directions.has(`${targetItemId}/${sourceItemId}`),
      ),
    ).toBe(true);
    expect(fixture.relationships.some(({ crossBranch }) => crossBranch)).toBe(true);
    expect(
      fixture.relationships.some(({ relationType }) => relationType === "future:semantic"),
    ).toBe(true);
    expect(fixture.trashedItemId).not.toBeNull();
    expect(
      fixture.tasks.every(
        ({ status, dueDate, priority }) =>
          status.length > 0 && /^\d{4}-\d{2}-\d{2}$/u.test(dueDate) && priority.length > 0,
      ),
    ).toBe(true);
    expect(DEMO_PASSWORD).toBe("knowledge-graph-demo");
  });

  it("refuses production, remote, ambiguous and non-empty targets before seeding", () => {
    const valid = {
      confirmation: "RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO",
      nodeEnv: "development",
      publicOrigin: "https://localhost:8443",
      databaseUrl: "postgres://myownnotion:dev@postgres:5432/myownnotion",
      installationCount: 1,
      ownerCount: 0,
      itemCount: 0,
    } as const;
    expect(() => assertKnowledgeGraphDemoTarget(valid)).not.toThrow();
    for (const changed of [
      { nodeEnv: "production" },
      { publicOrigin: "https://notes.example.com" },
      { databaseUrl: "postgres://owner:secret@db.example.com:5432/notes" },
      { confirmation: "yes" },
      { installationCount: 2 },
      { ownerCount: 1 },
      { itemCount: 1 },
    ]) {
      expect(() => assertKnowledgeGraphDemoTarget({ ...valid, ...changed })).toThrow();
    }
  });

  it("reproduces the exact logical inventory across ten fresh generations", () => {
    const inventories = Array.from({ length: 10 }, () => {
      const fixture = buildKnowledgeGraphDemoFixture();
      return {
        summary: fixture.summary,
        itemRoles: Object.fromEntries(
          ["folder", "page", "database", "task", "file"].map((role) => [
            role,
            fixture.items.filter((item) => item.role === role).length,
          ]),
        ),
        relationOrigins: Object.fromEntries(
          ["document", "explicit"].map((origin) => [
            origin,
            fixture.relationships.filter((relationship) => relationship.origin === origin).length,
          ]),
        ),
        documents: fixture.documents.map(({ links }) => links.length),
        isolated: fixture.isolatedItemIds.length,
      };
    });
    expect(new Set(inventories.map((inventory) => JSON.stringify(inventory))).size).toBe(1);
  });

  it("refuses 100 distinct remote database targets before any seed work", () => {
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      expect(() =>
        assertKnowledgeGraphDemoTarget({
          confirmation: "RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO",
          nodeEnv: "development",
          publicOrigin: "https://localhost:8443",
          databaseUrl: `postgres://owner:secret@db-${attempt}.example.test:5432/myownnotion`,
          installationCount: 1,
          ownerCount: 0,
          itemCount: 0,
        }),
      ).toThrow();
    }
  });
});
