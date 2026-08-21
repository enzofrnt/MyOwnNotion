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
  CreateDatabaseRequestSchema,
  CreateEntryRequestSchema,
  CreateItemSchema,
  CreatePlacementSchema,
  CreateRelationshipSchema,
  DatabaseDefinitionSchema,
  DatabaseEntrySchema,
  DatabaseQueryPageSchema,
  DatabaseQuerySchema,
  DatabaseSchema,
  DefinitionImpactSchema,
  HealthResponseSchema,
  ItemSchema,
  MutationResultSchema,
  PageDocumentSchema,
  PlacementSchema,
  ProblemSchema,
  QueuedMutationResultSchema,
  QueuedMutationSchema,
  ReplaceDefinitionRequestSchema,
  ReplaceEntryValuesRequestSchema,
  RevisionSchema,
  SearchHealthSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  SearchResultSchema,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface OpenApiSchema {
  required?: string[];
  enum?: string[];
  properties?: Record<string, unknown>;
  allOf?: OpenApiSchema[];
  $ref?: string;
}

interface OpenApiDocument {
  openapi: string;
  security?: unknown[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
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
const databaseDocumentPath = path.resolve(
  import.meta.dirname,
  "../../specs/009-databases-structured-tasks/contracts/database-api.openapi.yaml",
);
const databaseOpenapi = parse(readFileSync(databaseDocumentPath, "utf8")) as OpenApiDocument;

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

function requiredOfDatabase(schemaName: string): string[] {
  const schema = databaseOpenapi.components.schemas[schemaName];
  expect(schema, `Database OpenAPI schema ${schemaName} must exist`).toBeDefined();
  const required = (candidate: OpenApiSchema | undefined): string[] => {
    if (candidate === undefined) return [];
    const referenced = candidate.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
    return [
      ...(candidate.required ?? []),
      ...(candidate.allOf ?? []).flatMap(required),
      ...(referenced === undefined ? [] : required(databaseOpenapi.components.schemas[referenced])),
    ];
  };
  return [...new Set(required(schema))];
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

  it("documents the optional redacted search health state exposed at runtime", () => {
    const health = openapi.paths["/health"]?.["get"] as {
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                required?: string[];
                properties?: Record<string, { $ref?: string }>;
              };
            };
          };
        };
      };
    };
    const schema = health.responses["200"].content["application/json"].schema;

    expect(schema.properties?.["search"]?.$ref).toBe("#/components/schemas/SearchHealth");
    expect(runtimeRequired(HealthResponseSchema)).toEqual(
      expect.arrayContaining(schema.required ?? []),
    );
    expect(runtimeRequired(SearchHealthSchema)).toEqual(requiredOf("SearchHealth"));
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
    const operation = searchOpenapi.paths["/v1/search"]?.["post"] as {
      security?: unknown[];
      requestBody?: { required?: boolean };
      parameters?: Array<{ in?: string }>;
    };
    expect(operation.security).toEqual([{ ownerSession: [] }]);
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.parameters ?? []).not.toContainEqual(expect.objectContaining({ in: "query" }));
  });

  it("documents bounded queries, pages and every safe failure state", () => {
    const request = searchOpenapi.components.schemas["SearchRequest"] as {
      properties?: Record<string, { minLength?: number; maxLength?: number; maximum?: number }>;
    };
    expect(request.properties?.["query"]).toMatchObject({ minLength: 1, maxLength: 512 });
    expect(request.properties?.["limit"]).toMatchObject({ maximum: 50 });

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

describe("database OpenAPI contract", () => {
  it("resolves every local schema and response reference", () => {
    const references: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          if (key === "$ref" && typeof child === "string") references.push(child);
          else visit(child);
        }
      }
    };
    visit(databaseOpenapi);
    for (const reference of references) {
      const match = reference.match(/^#\/components\/(schemas|responses|parameters)\/(.+)$/);
      expect(match, `unsupported reference ${reference}`).not.toBeNull();
      const [, collection, name] = match as RegExpMatchArray;
      expect(
        (databaseOpenapi.components as unknown as Record<string, Record<string, unknown>>)[
          collection as string
        ]?.[name as string],
        `missing ${reference}`,
      ).toBeDefined();
    }
  });

  it("keeps private definitions and values in authenticated request bodies", () => {
    expect(databaseOpenapi.openapi).toMatch(/^3\.1\./);
    expect(databaseOpenapi.security).toEqual([{ ownerSession: [] }]);
    for (const [route, method] of [
      ["/v1/databases", "post"],
      ["/v1/databases/{databaseId}/definition/impact", "post"],
      ["/v1/databases/{databaseId}/definition", "put"],
      ["/v1/databases/{databaseId}/entries", "post"],
      ["/v1/databases/{databaseId}/entries/{entryId}/values", "put"],
      ["/v1/databases/{databaseId}/query", "post"],
    ] as const) {
      const operation = databaseOpenapi.paths[route]?.[method] as {
        requestBody?: { required?: boolean };
        parameters?: Array<{ in?: string }>;
      };
      expect(operation.requestBody?.required, `${method.toUpperCase()} ${route}`).toBe(true);
      expect(operation.parameters ?? []).not.toContainEqual(
        expect.objectContaining({ in: "query" }),
      );
    }
  });

  it("documents every database boundary and bounded saved-view query", () => {
    expect(Object.keys(databaseOpenapi.paths)).toEqual(
      expect.arrayContaining([
        "/v1/databases",
        "/v1/databases/{databaseId}",
        "/v1/databases/{databaseId}/definition/impact",
        "/v1/databases/{databaseId}/definition",
        "/v1/databases/{databaseId}/entries",
        "/v1/databases/{databaseId}/entries/{entryId}",
        "/v1/databases/{databaseId}/entries/{entryId}/values",
        "/v1/databases/{databaseId}/query",
      ]),
    );
    const query = databaseOpenapi.components.schemas["DatabaseQuery"] as {
      properties?: Record<string, { minimum?: number; maximum?: number; maxLength?: number }>;
    };
    expect(query.properties?.["limit"]).toMatchObject({ minimum: 1, maximum: 100 });
    expect(query.properties?.["cursor"]).toMatchObject({ maxLength: 2048 });
  });

  it.each([
    ["CreateDatabaseRequest", CreateDatabaseRequestSchema],
    ["DatabaseDefinition", DatabaseDefinitionSchema],
    ["ReplaceDefinitionRequest", ReplaceDefinitionRequestSchema],
    ["DefinitionImpact", DefinitionImpactSchema],
    ["Database", DatabaseSchema],
    ["CreateEntryRequest", CreateEntryRequestSchema],
    ["ReplaceEntryValuesRequest", ReplaceEntryValuesRequestSchema],
    ["DatabaseEntry", DatabaseEntrySchema],
    ["DatabaseQuery", DatabaseQuerySchema],
    ["DatabaseQueryPage", DatabaseQueryPageSchema],
  ] as const)("runtime %s requires every database OpenAPI-required field", (name, schema) => {
    const runtime = runtimeRequired(schema as { required?: string[] });
    for (const field of requiredOfDatabase(name)) {
      expect(runtime, `${name}.${field} must be required at runtime`).toContain(field);
    }
  });

  it("uses the shared safe problem shape for validation, conflicts, cursors and projection state", () => {
    expect(runtimeRequired(ProblemSchema)).toEqual(requiredOfDatabase("Problem"));
    const queryResponses = (
      databaseOpenapi.paths["/v1/databases/{databaseId}/query"] as {
        post: { responses: Record<string, unknown> };
      }
    ).post.responses;
    expect(Object.keys(queryResponses).sort()).toEqual(["200", "400", "404", "409", "503"]);
  });
});
