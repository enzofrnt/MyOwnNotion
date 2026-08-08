/**
 * Contract-test harness: the real Fastify app over a disposable migrated
 * PostgreSQL and a temporary blob root, driven through app.inject.
 */
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { type BuiltApp, buildApp } from "../../src/app.ts";

export interface ApiHarness {
  readonly built: BuiltApp;
  readonly postgres: DisposablePostgres;
  readonly blobRoot: string;
  close(): Promise<void>;
}

export async function createApiHarness(): Promise<ApiHarness> {
  const postgres = await startMigratedPostgres();
  const blobRoot = mkdtempSync(path.join(os.tmpdir(), "mon-blobs-"));
  const built = await buildApp({
    databaseUrl: postgres.connectionString,
    blobRoot,
    logger: false,
  });
  return {
    built,
    postgres,
    blobRoot,
    close: async () => {
      await built.close();
      await postgres.stop();
      await rm(blobRoot, { recursive: true, force: true });
    },
  };
}

export function idempotencyHeaders(mutationId: Uuid = generateUuidV7()): Record<string, string> {
  return { "idempotency-key": mutationId };
}

export interface CreatedItem {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  readonly placementId: Uuid;
}

export interface ImportedFile extends CreatedItem {
  readonly contentId: Uuid;
  readonly sha256: string;
}

export async function importFileViaApi(
  harness: ApiHarness,
  input: {
    readonly name: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
    readonly placement?: {
      readonly kind: "hierarchy" | "attachment";
      readonly parentItemId: Uuid | null;
      readonly positionKey: string;
    };
  },
): Promise<ImportedFile> {
  const boundary = `----test-${generateUuidV7()}`;
  const placement = input.placement ?? {
    kind: "hierarchy",
    parentItemId: null,
    positionKey: "V",
  };
  const prefix = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="placement"\r\n\r\n${JSON.stringify(placement)}\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${input.name}"\r\ncontent-type: ${input.mediaType}\r\n\r\n`,
    "utf8",
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/files",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...idempotencyHeaders(),
    },
    payload: Buffer.concat([prefix, Buffer.from(input.bytes), suffix]),
  });
  if (response.statusCode !== 201) {
    throw new Error(`file import failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as {
    revisionIds: string[];
    item: {
      id: string;
      placements: Array<{ id: string }>;
      file: { contentId: string; sha256: string };
    };
  };
  return {
    itemId: body.item.id as Uuid,
    revisionId: body.revisionIds[0] as Uuid,
    placementId: body.item.placements[0]?.id as Uuid,
    contentId: body.item.file.contentId as Uuid,
    sha256: body.item.file.sha256,
  };
}

export async function createItemViaApi(
  harness: ApiHarness,
  input: {
    kind: "page" | "folder";
    name: string;
    parentItemId?: Uuid | null;
    positionKey?: string;
  },
): Promise<CreatedItem> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/items",
    headers: idempotencyHeaders(),
    payload: {
      id: generateUuidV7(),
      kind: input.kind,
      name: input.name,
      placement: {
        kind: "hierarchy",
        parentItemId: input.parentItemId ?? null,
        positionKey: input.positionKey ?? "V",
      },
      ...(input.kind === "page"
        ? {
            pageDocument: {
              format: "myownnotion.document+json",
              formatVersion: 1,
              body: {},
            },
          }
        : {}),
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`item creation failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as {
    revisionIds: string[];
    item: { id: string; placements: Array<{ id: string }> };
  };
  return {
    itemId: body.item.id as Uuid,
    revisionId: body.revisionIds[0] as Uuid,
    placementId: body.item.placements[0]?.id as Uuid,
  };
}
