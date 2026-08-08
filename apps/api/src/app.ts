/**
 * Fastify composition (T017).
 *
 * Schema-first: every request is validated and every response serialized
 * against contract schemas. Errors leave as redacted problem documents.
 * The server binds to 127.0.0.1 only until authentication exists.
 */

import multipart from "@fastify/multipart";
import {
  type BlobStore,
  ContentStore,
  FilesystemBlobStore,
  S3BlobStore,
} from "@myownnotion/blob-store";
import { createDatabase, type DatabaseHandle, getOrCreateWorkspace } from "@myownnotion/database";
import { MAX_FILE_BYTE_LENGTH } from "@myownnotion/domain";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";
import { registerErrorHandling } from "./plugins/errors.ts";
import { registerLogging } from "./plugins/logging.ts";
import { registerChangeRoutes } from "./routes/changes.ts";
import { registerExportRoutes } from "./routes/export.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerHealthRoutes } from "./routes/health.ts";
import { registerItemRoutes } from "./routes/items.ts";
import { registerMutationBatchRoutes } from "./routes/mutation-batch.ts";
import { registerPageDocumentRoutes } from "./routes/page-documents.ts";
import { registerPlacementRoutes } from "./routes/placements.ts";
import { registerRelationshipRoutes } from "./routes/relationships.ts";
import { registerRevisionRoutes } from "./routes/revisions.ts";
import { registerSnapshotRoutes } from "./routes/snapshots.ts";

export interface BuildAppOptions {
  readonly databaseUrl: string;
  /** Compatibility input retained for tests and dependency-light development. */
  readonly blobRoot?: string;
  readonly storage?: StorageOptions;
  readonly logger?: boolean;
}

export type StorageOptions =
  | { readonly kind: "filesystem"; readonly root: string }
  | {
      readonly kind: "s3";
      readonly endpoint: string;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly prefix: string;
    };

type Environment = Readonly<Record<string, string | undefined>>;

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${name.toLowerCase()} is required`);
  }
  return value;
}

/** Parses a closed configuration without ever echoing protected values. */
export function parseStorageOptions(environment: Environment): StorageOptions {
  const adapter = environment["MYOWNNOTION_STORAGE_ADAPTER"]?.trim() || "filesystem";
  if (adapter === "filesystem") {
    const root = environment["MYOWNNOTION_BLOB_ROOT"]?.trim() || "./.dev-blobs";
    if (root.includes("\0")) {
      throw new TypeError("filesystem blob root is invalid");
    }
    return { kind: "filesystem", root };
  }
  if (adapter !== "s3") {
    throw new TypeError("storage adapter must be filesystem or s3");
  }

  const endpoint = requiredEnvironment(environment, "MYOWNNOTION_S3_ENDPOINT");
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new TypeError("s3 endpoint is invalid");
  }
  if (
    (parsedEndpoint.protocol !== "http:" && parsedEndpoint.protocol !== "https:") ||
    parsedEndpoint.username.length > 0 ||
    parsedEndpoint.password.length > 0 ||
    parsedEndpoint.pathname !== "/" ||
    parsedEndpoint.search.length > 0 ||
    parsedEndpoint.hash.length > 0
  ) {
    throw new TypeError("s3 endpoint is invalid");
  }

  const bucket = requiredEnvironment(environment, "MYOWNNOTION_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) {
    throw new TypeError("s3 bucket is invalid");
  }
  const prefix = environment["MYOWNNOTION_S3_PREFIX"]?.trim() || "blobs";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(prefix) || prefix.includes("..")) {
    throw new TypeError("s3 prefix is invalid");
  }

  return {
    kind: "s3",
    endpoint: parsedEndpoint.toString().replace(/\/$/, ""),
    region: environment["MYOWNNOTION_S3_REGION"]?.trim() || "us-east-1",
    bucket,
    accessKeyId: requiredEnvironment(environment, "MYOWNNOTION_S3_ACCESS_KEY"),
    secretAccessKey: requiredEnvironment(environment, "MYOWNNOTION_S3_SECRET_KEY"),
    prefix,
  };
}

async function createBlobStore(options: StorageOptions): Promise<BlobStore> {
  if (options.kind === "filesystem") {
    return new FilesystemBlobStore(options.root);
  }
  const store = new S3BlobStore({
    bucket: options.bucket,
    prefix: options.prefix,
    clientConfig: {
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    },
  });
  await store.ensureBucket();
  return store;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly database: DatabaseHandle;
  close(): Promise<void>;
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const database = createDatabase(options.databaseUrl);
  const storage = options.storage ?? {
    kind: "filesystem" as const,
    root: options.blobRoot ?? "./.dev-blobs",
  };
  let workspace: Awaited<ReturnType<typeof getOrCreateWorkspace>>;
  let blobStore: BlobStore;
  try {
    [workspace, blobStore] = await Promise.all([
      getOrCreateWorkspace(database.db),
      createBlobStore(storage),
    ]);
  } catch (error) {
    await database.close();
    throw error;
  }
  const contentStore = new ContentStore(blobStore);

  const context: AppContext = {
    db: database.db,
    workspaceId: workspace.id,
    schemaVersion: workspace.schemaVersion,
    contentStore,
    storageAdapter: storage.kind,
  };

  const app = Fastify({
    logger: options.logger === false ? false : registerLogging(),
    bodyLimit: MAX_FILE_BYTE_LENGTH + 1024 * 1024,
  });
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTE_LENGTH, files: 1, fields: 8, parts: 9 },
  });
  registerErrorHandling(app);
  registerHealthRoutes(app, context);
  registerItemRoutes(app, context);
  registerPlacementRoutes(app, context);
  registerPageDocumentRoutes(app, context);
  registerFileRoutes(app, context);
  registerRelationshipRoutes(app, context);
  registerRevisionRoutes(app, context);
  registerChangeRoutes(app, context);
  registerSnapshotRoutes(app, context);
  registerMutationBatchRoutes(app, context);
  registerExportRoutes(app, context);

  return {
    app,
    context,
    database,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
