/**
 * Baseline contract validation (T012).
 *
 * Keeps the runtime TypeBox schemas aligned with the canonical OpenAPI
 * source at specs/001-content-foundations/contracts/content-api.openapi.yaml.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ChangeEnvelopeSchema,
  CreateItemSchema,
  CreatePlacementSchema,
  CreateRelationshipSchema,
  EditorDocumentSchema,
  ItemSchema,
  MutationResultSchema,
  PageDocumentSchema,
  PlacementSchema,
  ProblemSchema,
  QueuedMutationResultSchema,
  QueuedMutationSchema,
  RevisionSchema,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<
      string,
      { required?: string[]; enum?: string[]; properties?: Record<string, unknown> }
    >;
  };
}

const documentPath = path.resolve(
  import.meta.dirname,
  "../../specs/001-content-foundations/contracts/content-api.openapi.yaml",
);
const openapi = parse(readFileSync(documentPath, "utf8")) as OpenApiDocument;

function requiredOf(schemaName: string): string[] {
  const schema = openapi.components.schemas[schemaName];
  expect(schema, `OpenAPI schema ${schemaName} must exist`).toBeDefined();
  return schema?.required ?? [];
}

function runtimeRequired(schema: { required?: string[] }): string[] {
  return schema.required ?? [];
}

describe("OpenAPI ↔ runtime schema alignment", () => {
  it("defines the strict version 3 editor JSON boundary", () => {
    expect(EditorDocumentSchema.required).toEqual(["type", "content"]);
    expect(EditorDocumentSchema.additionalProperties).toBe(false);
    expect(JSON.stringify(EditorDocumentSchema)).toContain('"horizontalRule"');
    expect(JSON.stringify(EditorDocumentSchema)).toContain('"wikiLink"');
    expect(JSON.stringify(EditorDocumentSchema)).toContain('"targetItemId"');
    expect(JSON.stringify(EditorDocumentSchema)).toContain('"occurrenceId"');
    expect(JSON.stringify(EditorDocumentSchema)).not.toContain("futureWidget");
  });

  it("keeps incremental relationship projection fields aligned", () => {
    const runtime = JSON.stringify(ChangeEnvelopeSchema);
    expect(runtime).toContain('"relationshipSourceItemIds"');
    expect(runtime).toContain('"changedRelationships"');
    expect(requiredOf("WikiLinkMark")).toEqual(["type", "attrs"]);
    const changeProperties = openapi.components.schemas["ChangeEnvelope"]?.properties ?? {};
    expect(changeProperties).toHaveProperty("relationshipSourceItemIds");
    expect(changeProperties).toHaveProperty("changedRelationships");
  });
  it("is an OpenAPI 3.1 document", () => {
    expect(openapi.openapi).toMatch(/^3\.1\./);
  });

  it.each([
    ["Item", ItemSchema],
    ["Placement", PlacementSchema],
    ["CreateItem", CreateItemSchema],
    ["CreatePlacement", CreatePlacementSchema],
    ["CreateRelationship", CreateRelationshipSchema],
    ["Revision", RevisionSchema],
    ["MutationResult", MutationResultSchema],
    ["ChangeEnvelope", ChangeEnvelopeSchema],
    ["QueuedMutation", QueuedMutationSchema],
    ["QueuedMutationResult", QueuedMutationResultSchema],
    ["PageDocument", PageDocumentSchema],
    ["Problem", ProblemSchema],
  ] as const)("runtime %s requires every OpenAPI-required field", (name, schema) => {
    const contractRequired = requiredOf(name);
    const runtime = runtimeRequired(schema as { required?: string[] });
    for (const field of contractRequired) {
      expect(runtime, `${name}.${field} must be required at runtime`).toContain(field);
    }
  });

  it("covers every documented path with the API implementation table", () => {
    const paths = Object.keys(openapi.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/health",
        "/v1/items",
        "/v1/items/{itemId}",
        "/v1/pages/{itemId}/document",
        "/v1/items/{itemId}/trash",
        "/v1/items/{itemId}/restore",
        "/v1/items/{itemId}/placements",
        "/v1/placements/{placementId}/move",
        "/v1/placements/{placementId}",
        "/v1/files",
        "/v1/files/{itemId}/content",
        "/v1/relationships",
        "/v1/relationships/{relationshipId}",
        "/v1/revisions/{revisionId}",
        "/v1/revisions/compare",
        "/v1/revisions/{revisionId}/restore",
        "/v1/changes",
        "/v1/mutations/batch",
        "/v1/snapshots/current",
        "/v1/export",
        "/v1/export/{exportId}",
      ]),
    );
  });

  it("keeps lineage classification vocabulary identical", () => {
    const compare = openapi.paths["/v1/revisions/compare"] as {
      post: {
        responses: Record<
          string,
          {
            content: Record<
              string,
              { schema: { properties: { classification: { enum: string[] } } } }
            >;
          }
        >;
      };
    };
    const contractEnum =
      compare.post.responses["200"]?.content["application/json"]?.schema.properties.classification
        .enum;
    expect(contractEnum).toEqual(["identical", "left-ancestor", "right-ancestor", "concurrent"]);
  });
});
