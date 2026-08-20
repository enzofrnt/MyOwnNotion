/**
 * Asynchronous canonical export (T088).
 *
 * POST creates a pending export job; the manifest is built from one
 * transactionally consistent read, validated independently, digested, and
 * stored. GET reports status and returns the verified artifact when ready.
 */
import { createHash } from "node:crypto";
import { CreateExportResponseSchema, ExportStatusSchema } from "@myownnotion/contracts";
import {
  currentSequence,
  listDatabaseEntryRecords,
  listDatabaseRecords,
  listItems,
  listRelationships,
  schema,
  sequenceToCursor,
} from "@myownnotion/database";
import {
  buildCanonicalExport,
  canonicalExportString,
  type ExportedItem,
  generateUuidV7,
  type RevisionHeader,
  type Uuid,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import {
  resolveDatabaseDefinition,
  resolveDatabaseEntryValues,
  resolveProtectedContent,
} from "../security/content-resolution.ts";

/**
 * One transactionally consistent read of the whole workspace.
 *
 * Exported rather than private because the backup archive is built from exactly
 * this (feature 007): a backup format of its own would be a second description
 * of the same workspace, and two descriptions drift the first time either
 * changes — with the drift surfacing only when somebody restores.
 */
export async function buildManifest(context: AppContext) {
  return context.db.transaction(
    async (tx) => {
      // A pre-update backup is deliberately produced before pending migrations
      // run. Feature 009's first such backup therefore sees the feature-007
      // schema, where neither structured table exists yet. Treat that complete
      // absence as an empty structured projection; a half-created pair remains
      // an integrity failure because omitting it could hide canonical data.
      const structuredSchema = await tx.execute<{
        databases_exists: boolean;
        entries_exists: boolean;
      }>(sql`
        SELECT
          to_regclass('public.databases') IS NOT NULL AS databases_exists,
          to_regclass('public.database_entries') IS NOT NULL AS entries_exists
      `);
      const availability = structuredSchema.rows[0];
      if (availability?.databases_exists !== availability?.entries_exists) {
        throw new Error("the structured database schema is only partially installed");
      }
      const structuredTablesAvailable = availability?.databases_exists === true;

      const sequence = await currentSequence(tx, context.workspaceId);
      const active = await listItems(tx, context.workspaceId, { lifecycle: "active" });
      const trashed = await listItems(tx, context.workspaceId, { lifecycle: "trashed" });
      const models = await resolveProtectedContent(
        tx,
        [...active, ...trashed],
        context.protectedContent,
      );

      const fileRows = await tx
        .select({
          itemId: schema.logicalFiles.itemId,
          mediaType: schema.logicalFiles.mediaType,
          originalName: schema.logicalFiles.originalName,
          byteLength: schema.logicalFiles.byteLength,
          sha256: schema.fileContents.sha256,
        })
        .from(schema.logicalFiles)
        .innerJoin(schema.fileContents, eq(schema.logicalFiles.contentId, schema.fileContents.id));
      const filesByItem = new Map(fileRows.map((row) => [row.itemId, row]));

      const revisionRows = await tx.select().from(schema.revisions);
      const parentRows = await tx.select().from(schema.revisionParents);
      const parentsByRevision = new Map<string, Uuid[]>();
      for (const edge of parentRows) {
        const list = parentsByRevision.get(edge.revisionId) ?? [];
        list.push(edge.parentRevisionId as Uuid);
        parentsByRevision.set(edge.revisionId, list);
      }
      const revisions: RevisionHeader[] = revisionRows.map((row) => ({
        id: row.id as Uuid,
        itemId: row.itemId as Uuid,
        mutationId: row.mutationId as Uuid,
        parentRevisionIds: parentsByRevision.get(row.id) ?? [],
        acceptedAt: row.acceptedAt.toISOString(),
      }));

      const itemIds = models.map((model) => model.id);
      const placementRows =
        itemIds.length === 0
          ? []
          : await tx
              .select()
              .from(schema.placements)
              .where(
                and(
                  inArray(schema.placements.itemId, itemIds),
                  isNull(schema.placements.removedAt),
                ),
              );
      const placementsByItem = new Map<string, typeof placementRows>();
      for (const placement of placementRows) {
        const list = placementsByItem.get(placement.itemId) ?? [];
        list.push(placement);
        placementsByItem.set(placement.itemId, list);
      }

      const items: ExportedItem[] = models.map((model) => {
        const file = filesByItem.get(model.id);
        return {
          id: model.id,
          workspaceId: context.workspaceId,
          kind: model.kind,
          name: model.name,
          lifecycle: model.lifecycle,
          trashedAt: model.trashedAt,
          purgeAfter: model.purgeAfter,
          currentRevisionId: model.currentRevisionId,
          favourite: model.favourite,
          offlineIntent: model.offlineIntent,
          pageDocument: model.pageDocument,
          file:
            file === undefined
              ? null
              : {
                  mediaType: file.mediaType,
                  originalName: file.originalName,
                  byteLength: file.byteLength,
                  sha256: Buffer.from(file.sha256).toString("hex"),
                },
          placements: (placementsByItem.get(model.id) ?? []).map((placement) => ({
            id: placement.id as Uuid,
            workspaceId: placement.workspaceId as Uuid,
            itemId: placement.itemId as Uuid,
            // Not the item's kind: the exported item already carries that, and
            // duplicating it here is what tied a placement to a value that
            // changes when a page becomes a folder.
            itemIsFile: placement.itemIsFile,
            kind: placement.kind as "hierarchy" | "attachment",
            parentItemId: (placement.parentItemId as Uuid | null) ?? null,
            positionKey: placement.positionKey,
            removedAt: null,
          })),
        };
      });

      const relationships = await Promise.all(
        (await listRelationships(tx, context.workspaceId)).map(async (relationship) => ({
          id: relationship.id,
          workspaceId: context.workspaceId,
          sourceItemId: relationship.sourceItemId,
          targetItemId: relationship.targetItemId,
          relationType: relationship.relationType,
          metadata:
            context.protectedContent === undefined
              ? relationship.metadata
              : ((await context.protectedContent.readRelationshipMetadata<
                  Readonly<Record<string, unknown>>
                >(tx, relationship.id)) ?? relationship.metadata),
          createdRevisionId: relationship.createdRevisionId,
          removedRevisionId: relationship.removedRevisionId,
        })),
      );

      const databaseRecords = structuredTablesAvailable
        ? await listDatabaseRecords(tx, context.workspaceId)
        : [];
      const databases = [];
      const databaseEntries = [];
      for (const record of databaseRecords) {
        const definition = await resolveDatabaseDefinition(tx, record, context.protectedContent);
        databases.push({
          databaseId: record.databaseId,
          definitionVersion: record.definitionVersion,
          definition,
        });
        const entries = await listDatabaseEntryRecords(tx, record.databaseId);
        for (const entry of entries) {
          const values = await resolveDatabaseEntryValues(tx, entry, context.protectedContent);
          databaseEntries.push({
            entryId: entry.entryId,
            databaseId: entry.databaseId,
            valueVersion: entry.valueVersion,
            addedRevisionId: entry.addedRevisionId,
            values,
          });
        }
      }

      return buildCanonicalExport({
        workspaceId: context.workspaceId,
        schemaVersion: context.schemaVersion,
        exportedAt: new Date().toISOString(),
        changeCursor: sequenceToCursor(sequence),
        items,
        databases,
        databaseEntries,
        relationships,
        revisions,
      });
    },
    // PostgreSQL's default READ COMMITTED gives each statement a fresh view.
    // This export makes several queries, so only REPEATABLE READ makes the
    // recorded cursor, items, placements, relationships and revisions describe
    // one moment as FR-006 requires. File payloads are immutable and addressed
    // by digest, so they can be streamed after this transaction closes.
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function processExport(context: AppContext, exportId: Uuid): Promise<void> {
  try {
    const manifest = await buildManifest(context);
    const issues = validateCanonicalExport(manifest);
    if (issues.length > 0) {
      await context.db
        .update(schema.exports)
        .set({
          status: "failed",
          problem: { code: "export.validation-failed", issues },
          completedAt: new Date(),
        })
        .where(eq(schema.exports.id, exportId));
      return;
    }
    const canonical = canonicalExportString(manifest);
    const digest = createHash("sha256").update(canonical).digest("hex");
    await context.db.transaction(async (tx) => {
      if (context.protectedContent !== undefined) {
        await context.protectedContent.writeExportManifest(tx, { exportId, manifest });
      }
      await tx
        .update(schema.exports)
        .set({
          status: "ready",
          ready: true,
          digest,
          // Test/development harnesses without security retain the legacy
          // shape. A configured installation stores only the protected record.
          manifest: context.protectedContent === undefined ? manifest : null,
          completedAt: new Date(),
        })
        .where(eq(schema.exports.id, exportId));
    });
  } catch (error) {
    await context.db
      .update(schema.exports)
      .set({
        status: "failed",
        problem: { code: "export.unexpected", message: (error as Error).name },
        completedAt: new Date(),
      })
      .where(eq(schema.exports.id, exportId));
  }
}

export function registerExportRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    "/v1/export",
    {
      schema: {
        response: { 202: CreateExportResponseSchema },
      },
    },
    async (_request, reply) => {
      const exportId = generateUuidV7();
      await context.db.insert(schema.exports).values({
        id: exportId,
        workspaceId: context.workspaceId,
        status: "pending",
      });
      // Asynchronous processing; status is polled through GET.
      setImmediate(() => {
        void processExport(context, exportId);
      });
      return reply.status(202).send({ exportId, status: "pending" as const });
    },
  );

  app.get(
    "/v1/export/:exportId",
    {
      schema: {
        params: Type.Object({ exportId: Type.String({ format: "uuid" }) }),
        response: { 200: ExportStatusSchema },
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const rows = await context.db
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.id, exportId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return sendProblem(reply, { code: "item.not-found", title: "Export does not exist" });
      }
      return {
        exportId: row.id,
        status: row.status as "pending" | "ready" | "failed",
        ...(row.digest !== null ? { digest: row.digest } : {}),
        ...(row.status === "ready" ? { downloadPath: `/v1/export/${row.id}/artifact` } : {}),
      };
    },
  );

  app.get(
    "/v1/export/:exportId/artifact",
    {
      schema: {
        params: Type.Object({ exportId: Type.String({ format: "uuid" }) }),
      },
    },
    async (request, reply) => {
      const { exportId } = request.params as { exportId: string };
      const rows = await context.db
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.id, exportId))
        .limit(1);
      const row = rows[0];
      if (row === undefined || row.status !== "ready") {
        return sendProblem(reply, { code: "item.not-found", title: "Export artifact not ready" });
      }
      const manifest =
        row.manifest ??
        (await context.protectedContent?.readExportManifest(context.db, row.id)) ??
        null;
      if (manifest === null) {
        return sendProblem(reply, { code: "item.not-found", title: "Export artifact not ready" });
      }
      return reply
        .header("content-type", "application/json")
        .header("x-export-digest", row.digest ?? "")
        .send(manifest);
    },
  );
}
