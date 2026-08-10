/**
 * Fastify composition (T017).
 *
 * Schema-first: every request is validated and every response serialized
 * against contract schemas. Errors leave as redacted problem documents.
 * The server binds to 127.0.0.1 only until authentication exists.
 */

import multipart from "@fastify/multipart";
import { ContentStore, FilesystemBlobStore } from "@myownnotion/blob-store";
import { createDatabase, type DatabaseHandle, getOrCreateWorkspace } from "@myownnotion/database";
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
import { attachRequestContext, createRequestContext } from "./security/request-context.ts";

export interface BuildAppOptions {
  readonly databaseUrl: string;
  readonly blobRoot: string;
  readonly logger?: boolean;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly context: AppContext;
  readonly database: DatabaseHandle;
  close(): Promise<void>;
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const database = createDatabase(options.databaseUrl);
  const workspace = await getOrCreateWorkspace(database.db);
  const contentStore = new ContentStore(new FilesystemBlobStore(options.blobRoot));

  const context: AppContext = {
    db: database.db,
    workspaceId: workspace.id,
    schemaVersion: workspace.schemaVersion,
    contentStore,
  };

  const app = Fastify({
    logger: options.logger === false ? false : registerLogging(),
    bodyLimit: 64 * 1024 * 1024,
  });
  await app.register(multipart, {
    limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  });
  // Every request gets a security context before any route runs, including
  // anonymous and rejected ones: the correlation ID it carries is the only
  // bridge between a redacted client problem and the unredacted server log,
  // and creating it lazily would leave exactly the failures an operator most
  // needs to trace without one.
  app.addHook("onRequest", async (request) => {
    attachRequestContext(request, createRequestContext());
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
