/**
 * Baseline contract validation (T012).
 *
 * Keeps the runtime TypeBox schemas aligned with the canonical OpenAPI
 * source at specs/001-content-foundations/contracts/content-api.openapi.yaml.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CanonicalExportDatabaseEntrySchema,
  CanonicalExportDatabaseSchema,
  CanonicalExportFileSchema,
  CanonicalExportItemSchema,
  CanonicalExportManifestSchema,
  CanonicalExportPlacementSchema,
  CanonicalExportRelationshipSchema,
  CanonicalExportRevisionSchema,
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

interface SchemaNode {
  type?: string | string[];
  format?: string;
  const?: unknown;
  enum?: unknown[] | null;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  uniqueItems?: boolean;
  additionalProperties?: boolean | OpenApiSchema;
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  $ref?: string;
}

interface OpenApiSchema extends SchemaNode {}

interface OpenApiDocument {
  openapi: string;
  security?: unknown[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

interface RuntimeObjectSchema {
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, unknown>>;
}

type ComparableSchema = Record<string, unknown>;

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

function resolveOpenApiSchema(schema: OpenApiSchema): OpenApiSchema {
  const reference = schema.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  return reference === undefined ? schema : (openapi.components.schemas[reference] ?? schema);
}

function comparableSchema(schema: unknown, openApi = false): ComparableSchema {
  const resolved: SchemaNode = openApi
    ? resolveOpenApiSchema(schema as OpenApiSchema)
    : (schema as SchemaNode);
  const union = (resolved.anyOf ?? resolved.oneOf) as unknown[] | undefined;
  if (union !== undefined) {
    return {
      union: union
        .map((branch) => JSON.stringify(comparableSchema(branch, openApi)))
        .sort()
        .map((branch) => JSON.parse(branch) as ComparableSchema),
    };
  }

  const type = resolved.type;
  if (Array.isArray(type)) {
    return {
      union: type
        .map((branchType) =>
          comparableSchema(
            branchType === "null" ? { type: "null" } : { ...resolved, type: branchType },
            openApi,
          ),
        )
        .map((branch) => JSON.stringify(branch))
        .sort()
        .map((branch) => JSON.parse(branch) as ComparableSchema),
    };
  }

  if (Array.isArray(resolved.enum)) {
    return {
      union: resolved.enum
        .map((value) =>
          comparableSchema({
            const: value,
            type: typeof value === "string" ? "string" : typeof value,
          }),
        )
        .map((branch: ComparableSchema) => JSON.stringify(branch))
        .sort()
        .map((branch: string) => JSON.parse(branch) as ComparableSchema),
    };
  }

  const comparable: ComparableSchema = {};
  for (const key of [
    "type",
    "format",
    "const",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
    "uniqueItems",
  ]) {
    const value = (resolved as Record<string, unknown>)[key];
    if (value !== undefined) comparable[key] = value;
  }
  if (comparable["const"] !== undefined && comparable["type"] === undefined) {
    comparable["type"] =
      typeof comparable["const"] === "string" ? "string" : typeof comparable["const"];
  }
  if (type === "object" || resolved.properties !== undefined) {
    comparable["additionalProperties"] = resolved.additionalProperties ?? true;
    comparable["required"] = [...(resolved.required ?? [])].sort();
    const properties = resolved.properties ?? {};
    comparable["properties"] = Object.fromEntries(
      Object.entries(properties)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, comparableSchema(value, openApi)]),
    );
  }
  if (resolved.items !== undefined) {
    comparable["items"] = comparableSchema(resolved.items, openApi);
  }
  return comparable;
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

  it.each([
    ["CanonicalExportManifest", CanonicalExportManifestSchema],
    ["CanonicalExportItem", CanonicalExportItemSchema],
    ["CanonicalExportPlacement", CanonicalExportPlacementSchema],
    ["CanonicalExportFile", CanonicalExportFileSchema],
    ["CanonicalExportDatabase", CanonicalExportDatabaseSchema],
    ["CanonicalExportDatabaseEntry", CanonicalExportDatabaseEntrySchema],
    ["CanonicalExportRelationship", CanonicalExportRelationshipSchema],
    ["CanonicalExportRevision", CanonicalExportRevisionSchema],
  ] as const)(
    "keeps canonical export %s required fields and properties aligned",
    (name, schema) => {
      const contract = openapi.components.schemas[name];
      const runtimeCandidates = (schema as { readonly anyOf?: readonly RuntimeObjectSchema[] })
        .anyOf;
      const runtimeObject =
        runtimeCandidates?.find((candidate) => candidate.properties !== undefined) ??
        (schema as RuntimeObjectSchema);
      expect(contract).toBeDefined();
      expect(contract?.required ?? []).toEqual(runtimeObject.required ?? []);
      expect(Object.keys(contract?.properties ?? {}).sort()).toEqual(
        Object.keys(runtimeObject.properties ?? {}).sort(),
      );
    },
  );

  it.each([
    ["CanonicalExportManifest", CanonicalExportManifestSchema],
    ["CanonicalExportItem", CanonicalExportItemSchema],
    ["CanonicalExportPlacement", CanonicalExportPlacementSchema],
    ["CanonicalExportFile", CanonicalExportFileSchema],
    ["CanonicalExportDatabase", CanonicalExportDatabaseSchema],
    ["CanonicalExportDatabaseEntry", CanonicalExportDatabaseEntrySchema],
    ["CanonicalExportRelationship", CanonicalExportRelationshipSchema],
    ["CanonicalExportRevision", CanonicalExportRevisionSchema],
  ] as const)("keeps canonical export constraints aligned for %s", (name, schema) => {
    expect(comparableSchema(openapi.components.schemas[name], true)).toEqual(
      comparableSchema(schema),
    );
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
        "/v1/export/{exportId}/artifact",
      ]),
    );
  });

  it("documents the canonical export artifact exactly as the runtime download", () => {
    const operation = openapi.paths["/v1/export/{exportId}/artifact"]?.["get"] as {
      operationId?: string;
      security?: unknown[];
      parameters?: Array<{
        in?: string;
        name?: string;
        required?: boolean;
        schema?: { $ref?: string };
      }>;
      responses?: Record<
        string,
        {
          headers?: Record<
            string,
            {
              required?: boolean;
              description?: string;
              schema?: { type?: string; pattern?: string };
            }
          >;
          content?: Record<string, { schema?: { $ref?: string } }>;
        }
      >;
    };

    expect(operation.operationId).toBe("downloadCanonicalExportArtifact");
    expect(operation.security).toEqual([{ sessionCookie: [] }, { devSessionCookie: [] }]);
    expect(operation.parameters).toEqual([
      {
        in: "path",
        name: "exportId",
        required: true,
        schema: { $ref: "#/components/schemas/Uuid" },
      },
    ]);
    expect(operation.responses).toEqual(
      expect.objectContaining({
        "400": { $ref: "#/components/responses/Problem" },
        "404": { $ref: "#/components/responses/Problem" },
      }),
    );
    expect(operation.responses?.["200"]?.content).toEqual({
      "application/json": {
        schema: { $ref: "#/components/schemas/CanonicalExportManifest" },
      },
    });
    expect(operation.responses?.["200"]?.headers?.["X-Export-Digest"]).toEqual({
      required: true,
      description: "SHA-256 digest of the canonical JSON manifest",
      schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
    });
  });

  it("documents authentication, CSRF, and operational failures for every export operation", () => {
    const operations = [
      openapi.paths["/v1/export"]?.["post"],
      openapi.paths["/v1/export/{exportId}"]?.["get"],
      openapi.paths["/v1/export/{exportId}/artifact"]?.["get"],
    ] as Array<{
      security?: unknown[];
      parameters?: Array<{ $ref?: string }>;
      responses?: Record<string, unknown>;
    }>;
    for (const operation of operations) {
      expect(operation.security).toEqual([{ sessionCookie: [] }, { devSessionCookie: [] }]);
      expect(operation.responses).toEqual(
        expect.objectContaining({
          "401": { $ref: "#/components/responses/SecurityProblem" },
          "409": { $ref: "#/components/responses/SecurityProblem" },
          "500": expect.any(Object),
          "503": { $ref: "#/components/responses/SecurityProblem" },
        }),
      );
    }
    expect(operations[0]?.parameters).toEqual([{ $ref: "#/components/parameters/CsrfToken" }]);
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
