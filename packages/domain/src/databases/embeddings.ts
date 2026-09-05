import type { Uuid } from "../ids/uuid.ts";
import type { DatabaseDefinition, DatabaseEmbedding } from "./types.ts";

/** Legacy database pages keep their identity and first display without rewriting ciphertext. */
export function databaseEmbeddings(definition: DatabaseDefinition): readonly DatabaseEmbedding[] {
  return (
    definition.embeddings ?? [
      {
        id: definition.databaseId,
        hostPageId: definition.databaseId,
        state: "active",
        views: definition.views,
      },
    ]
  );
}

export function databaseDefinitionForEmbedding(
  definition: DatabaseDefinition,
  embeddingId: Uuid,
): DatabaseDefinition | null {
  const embedding = databaseEmbeddings(definition).find(
    (candidate) => candidate.id === embeddingId && candidate.state === "active",
  );
  return embedding === undefined ? null : { ...definition, views: embedding.views };
}

/** Query view IDs are globally unique within the source; active displays win over legacy defaults. */
export function databaseQueryDefinition(definition: DatabaseDefinition): DatabaseDefinition {
  const views = new Map(
    databaseEmbeddings(definition)
      .filter((embedding) => embedding.state === "active")
      .flatMap((embedding) => embedding.views)
      .map((view) => [view.id, view]),
  );
  for (const view of definition.views) if (!views.has(view.id)) views.set(view.id, view);
  return { ...definition, views: [...views.values()] };
}

/** Shared schema changes and local presentation changes have different owners. */
export function replaceDatabaseEmbeddingDefinition(
  source: DatabaseDefinition,
  embeddingId: Uuid,
  candidate: DatabaseDefinition,
): DatabaseDefinition {
  return {
    ...source,
    properties: candidate.properties,
    taskRoles: candidate.taskRoles,
    embeddings: databaseEmbeddings(source).map((embedding) =>
      embedding.id === embeddingId ? { ...embedding, views: candidate.views } : embedding,
    ),
  };
}
