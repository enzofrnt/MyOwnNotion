import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export interface KnowledgePageFixture {
  readonly id: Uuid;
  readonly name: string;
  readonly lifecycle: "active" | "trashed";
}

export interface KnowledgeRelationshipFixture {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: "link:references";
  readonly metadata: { readonly label: string };
}

export interface KnowledgeFixture {
  readonly pages: KnowledgePageFixture[];
  readonly relationships: KnowledgeRelationshipFixture[];
}

/**
 * Builds a bounded directed page graph. The topology is deterministic for a
 * given size even though canonical UUIDs remain unique per fixture build.
 */
export function buildKnowledgeFixture(
  pageCount: number,
  relationshipCount: number,
): KnowledgeFixture {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error("pageCount must be a positive integer");
  }
  if (!Number.isInteger(relationshipCount) || relationshipCount < 0) {
    throw new Error("relationshipCount must be a non-negative integer");
  }

  const pages = Array.from({ length: pageCount }, (_, index) => ({
    id: generateUuidV7(),
    name: `Knowledge page ${index}`,
    lifecycle: "active" as const,
  }));
  const relationships = Array.from({ length: relationshipCount }, (_, index) => {
    const source = pages[index % pages.length] as KnowledgePageFixture;
    const target = pages[(index * 7 + 1) % pages.length] as KnowledgePageFixture;
    return {
      id: generateUuidV7(),
      sourceItemId: source.id,
      targetItemId: target.id,
      relationType: "link:references" as const,
      metadata: { label: target.name },
    };
  });
  return { pages, relationships };
}
