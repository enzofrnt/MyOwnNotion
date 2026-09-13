/**
 * Owner-facing backup HTTP contract.
 *
 * The OpenAPI document is deliberately checked against the TypeBox objects
 * used by the real route handlers. Keeping this separate from the security API
 * contract prevents the backup surface from silently acquiring a second set
 * of response fields or authentication requirements.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FullBackupRehearsalSchema,
  FullBackupStatusSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BackupStatusSchema, RehearsalResultSchema } from "../../apps/api/src/routes/backups.ts";

interface OpenApiSchema {
  required?: string[];
  $ref?: string;
  type?: string;
  format?: string;
  const?: unknown;
  enum?: unknown[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  properties?: Record<string, OpenApiSchema>;
}

interface OpenApiOperation {
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ $ref?: string; in?: string; name?: string; required?: boolean }>;
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

const contractPath = path.resolve(
  import.meta.dirname,
  "../../specs/024-full-server-backups/contracts/backup-api.openapi.yaml",
);
const openapi = parse(readFileSync(contractPath, "utf8")) as OpenApiDocument;

function requiredOf(name: string): string[] {
  const schema = openapi.components.schemas[name];
  expect(schema, `OpenAPI schema ${name} must exist`).toBeDefined();
  return schema?.required ?? [];
}

function runtimeRequired(schema: { required?: readonly string[] }): string[] {
  return [...(schema.required ?? [])];
}

function shapeOf(
  schema: OpenApiSchema,
  resolveRef?: (ref: string) => OpenApiSchema | undefined,
): unknown {
  if (schema.$ref !== undefined && resolveRef !== undefined) {
    const resolved = resolveRef(schema.$ref);
    if (resolved !== undefined) return shapeOf(resolved, resolveRef);
  }
  const shape: Record<string, unknown> = {};
  for (const key of [
    "type",
    "format",
    "const",
    "enum",
    "additionalProperties",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
  ]) {
    if (schema[key as keyof OpenApiSchema] !== undefined) {
      shape[key] = schema[key as keyof OpenApiSchema];
    }
  }
  // TypeBox emits the primitive type alongside a literal; OpenAPI's const
  // form carries the same constraint without redundantly spelling the type.
  if (shape["const"] !== undefined) delete shape["type"];
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives !== undefined) {
    shape["oneOf"] = alternatives.map((alternative) => shapeOf(alternative, resolveRef));
  }
  return shape;
}

const ownerSecurity = [{ sessionCookie: [] }, { devSessionCookie: [] }];

describe("owner-facing backup OpenAPI contract", () => {
  it("contains exactly the four served routes and their methods", () => {
    expect(
      Object.fromEntries(
        Object.entries(openapi.paths).map(([route, methods]) => [route, Object.keys(methods)]),
      ),
    ).toEqual({
      "/v1/backups/status": ["get"],
      "/v1/backups/rehearsals": ["post"],
      "/v1/backups/full/status": ["get"],
      "/v1/backups/full/rehearsals": ["post"],
    });
  });

  it.each([
    ["/v1/backups/status", "get", "BackupStatus", ["200", "401", "409", "500"]],
    [
      "/v1/backups/rehearsals",
      "post",
      "RehearsalResult",
      ["200", "401", "403", "409", "500", "503"],
    ],
    ["/v1/backups/full/status", "get", "FullBackupStatus", ["200", "401", "409", "500"]],
    [
      "/v1/backups/full/rehearsals",
      "post",
      "FullBackupRehearsal",
      ["200", "401", "403", "409", "500", "503"],
    ],
  ] as const)(
    "declares the real %s %s statuses and success shape",
    (route, method, schema, statuses) => {
      const operation = openapi.paths[route]?.[method];
      expect(operation).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([...statuses].sort());
      expect(operation?.security).toEqual(ownerSecurity);
      expect(operation?.responses["200"]?.content).toEqual({
        "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
      });

      if (method === "post") {
        expect(operation?.parameters).toEqual([{ $ref: "#/components/parameters/CsrfToken" }]);
      } else {
        expect(operation?.parameters ?? []).toEqual([]);
      }
      for (const status of statuses.filter((candidate) => candidate !== "200")) {
        expect(operation?.responses[status]).toEqual({
          $ref: "#/components/responses/SecurityProblem",
        });
      }
    },
  );

  it("keeps every documented required response field aligned with runtime TypeBox shapes", () => {
    const runtimeSchemas = {
      BackupStatus: BackupStatusSchema,
      RehearsalResult: RehearsalResultSchema,
      FullBackupStatus: FullBackupStatusSchema,
      FullBackupRehearsal: FullBackupRehearsalSchema,
      SecurityProblem: SecurityProblemSchema,
    } as const;

    for (const [name, schema] of Object.entries(runtimeSchemas)) {
      const contract = openapi.components.schemas[name];
      expect(requiredOf(name)).toEqual(runtimeRequired(schema));
      expect(contract?.additionalProperties).toBe(schema.additionalProperties);
      expect(shapeOf(contract ?? {})).toEqual(shapeOf(schema as OpenApiSchema));
      expect(Object.keys(contract?.properties ?? {}).sort()).toEqual(
        Object.keys(schema.properties ?? {}).sort(),
      );
      for (const property of Object.keys(schema.properties ?? {})) {
        const resolveRef = (ref: string) =>
          openapi.components.schemas[ref.replace("#/components/schemas/", "")];
        expect(shapeOf(contract?.properties?.[property] ?? {}, resolveRef)).toEqual(
          shapeOf((schema.properties as Record<string, OpenApiSchema>)[property] ?? {}, resolveRef),
        );
      }
    }
  });
});
