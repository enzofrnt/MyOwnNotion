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
  ItemSchema,
  MutationResultSchema,
  PageDocumentSchema,
  PlacementSchema,
  ProblemSchema,
  QueuedMutationResultSchema,
  QueuedMutationSchema,
  RevisionSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  SearchResultSchema,
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
const searchDocumentPath = path.resolve(
  import.meta.dirname,
  "../../specs/008-search/contracts/search-api.openapi.yaml",
);
const searchOpenapi = parse(readFileSync(searchDocumentPath, "utf8")) as OpenApiDocument;

function requiredOf(schemaName: string): string[] {
  const schema = openapi.components.schemas[schemaName];
  expect(schema, `OpenAPI schema ${schemaName} must exist`).toBeDefined();
  return schema?.required ?? [];
}

function requiredOfSearch(schemaName: string): string[] {
  const schema = searchOpenapi.components.schemas[schemaName];
  expect(schema, `Search OpenAPI schema ${schemaName} must exist`).toBeDefined();
  return schema?.required ?? [];
}

function runtimeRequired(schema: { required?: string[] }): string[] {
  return schema.required ?? [];
}

describe("OpenAPI ↔ runtime schema alignment", () => {
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

describe("search OpenAPI contract", () => {
  it("uses an authenticated POST body and never a query-string route", () => {
    expect(searchOpenapi.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(searchOpenapi.paths)).toEqual(["/v1/search"]);
    const operation = searchOpenapi.paths["/v1/search"]?.post as {
      security?: unknown[];
      requestBody?: { required?: boolean };
      parameters?: Array<{ in?: string }>;
    };
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.parameters ?? []).not.toContainEqual(expect.objectContaining({ in: "query" }));
  });

  it("documents bounded queries, pages and every safe failure state", () => {
    const request = searchOpenapi.components.schemas.SearchRequest as {
      properties?: Record<string, { minLength?: number; maxLength?: number; maximum?: number }>;
    };
    expect(request.properties?.query).toMatchObject({ minLength: 1, maxLength: 512 });
    expect(request.properties?.limit).toMatchObject({ maximum: 50 });

    const searchPath = searchOpenapi.paths["/v1/search"];
    expect(searchPath).toBeDefined();
    const responses = (searchPath as { post: { responses: Record<string, unknown> } }).post
      .responses;
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "401", "409", "503"]);
  });

  it.each([
    ["SearchRequest", SearchRequestSchema],
    ["SearchResponse", SearchResponseSchema],
    ["SearchResult", SearchResultSchema],
  ] as const)("runtime %s requires every search OpenAPI-required field", (name, schema) => {
    const runtime = runtimeRequired(schema as { required?: string[] });
    for (const field of requiredOfSearch(name)) {
      expect(runtime, `${name}.${field} must be required at runtime`).toContain(field);
    }
  });
});
