import { readFileSync } from "node:fs";
import path from "node:path";
import { FileContentMetadataSchema } from "@myownnotion/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const canonicalOpenApi = parse(
  readFileSync(
    path.join(repoRoot, "specs/001-content-foundations/contracts/content-api.openapi.yaml"),
    "utf8",
  ),
) as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};
const backupManifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, "specs/007-files-storage/contracts/backup-manifest.schema.json"),
    "utf8",
  ),
) as {
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, Record<string, unknown>>;
};

describe("public file-content contracts", () => {
  it("defines exact metadata and digest fields without a private storage locator", () => {
    expect(FileContentMetadataSchema.required).toEqual([
      "itemId",
      "revisionId",
      "contentId",
      "name",
      "mediaType",
      "byteLength",
      "sha256",
      "disposition",
      "cacheEligibility",
    ]);
    expect(FileContentMetadataSchema.additionalProperties).toBe(false);
    expect(FileContentMetadataSchema.properties).not.toHaveProperty("storageKey");

    expect(Object.keys(FileContentMetadataSchema.properties)).toEqual(
      FileContentMetadataSchema.required,
    );
  });

  it("merges revision-qualified HEAD and GET retrieval into the canonical OpenAPI", () => {
    const contentPath = canonicalOpenApi.paths["/v1/files/{itemId}/content"] as {
      head?: {
        operationId?: string;
        responses?: Record<string, unknown>;
        parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
      };
      get?: {
        operationId?: string;
        responses?: Record<string, unknown>;
        parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
      };
      put?: { operationId?: string };
    };
    expect(contentPath.head?.operationId).toBe("inspectFileContent");
    expect(contentPath.get?.operationId).toBe("downloadFileContent");
    expect(contentPath.put?.operationId).toBe("replaceFileContent");
    expect(contentPath.head?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "revisionId", in: "query", required: true }),
      ]),
    );
    expect(contentPath.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "revisionId", in: "query", required: true }),
      ]),
    );
    expect(contentPath.get?.responses).toHaveProperty("206");
    expect(contentPath.get?.responses).toHaveProperty("416");
  });
});

describe("backup manifest contract", () => {
  it("is closed, versioned, and carries deterministic database, object, and count records", () => {
    expect(backupManifest.additionalProperties).toBe(false);
    expect(backupManifest.required).toEqual([
      "manifestVersion",
      "product",
      "createdAt",
      "sourceRevision",
      "databaseSchemaVersions",
      "toolVersions",
      "database",
      "objects",
      "counts",
      "status",
    ]);
    expect(backupManifest.properties["manifestVersion"]?.["const"]).toBe(1);
    expect(backupManifest.properties["product"]?.["const"]).toBe("myownnotion");
    expect(backupManifest.properties["objects"]?.["type"]).toBe("array");
    expect(backupManifest.properties["counts"]?.["additionalProperties"]).toBe(false);

    const objectRecord = backupManifest.properties["objects"]?.["items"] as {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    expect(objectRecord.additionalProperties).toBe(false);
    expect(objectRecord.required).toEqual([
      "contentId",
      "storageKey",
      "path",
      "byteLength",
      "sha256",
    ]);
    expect(objectRecord.properties).not.toHaveProperty("filename");
    expect(objectRecord.properties).not.toHaveProperty("mediaType");
  });
});
