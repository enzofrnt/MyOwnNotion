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
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";

async function buildManifest(context: AppContext) {
  return context.db.transaction(async (tx) => {
    const sequence = await currentSequence(tx, context.workspaceId);
    const active = await listItems(tx, context.workspaceId, { lifecycle: "active" });
    const trashed = await listItems(tx, context.workspaceId, { lifecycle: "trashed" });
    const models = [...active, ...trashed];

    const fileRows = await tx
      .select({
        itemId: schema.logicalFiles.itemId,
        contentId: schema.logicalFiles.contentId,
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
              and(inArray(schema.placements.itemId, itemIds), isNull(schema.placements.removedAt)),
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
        pageDocument: model.pageDocument,
        file:
          file === undefined
            ? null
            : {
                contentId: file.contentId as Uuid,
                revisionId: model.currentRevisionId,
                mediaType: file.mediaType,
                originalName: file.originalName,
                byteLength: file.byteLength,
                sha256: Buffer.from(file.sha256).toString("hex"),
              },
        placements: (placementsByItem.get(model.id) ?? []).map((placement) => ({
          id: placement.id as Uuid,
          workspaceId: placement.workspaceId as Uuid,
          itemId: placement.itemId as Uuid,
          itemKind: placement.itemKind as "page" | "folder" | "file",
          kind: placement.kind as "hierarchy" | "attachment",
          parentItemId: (placement.parentItemId as Uuid | null) ?? null,
          positionKey: placement.positionKey,
          removedAt: null,
        })),
      };
    });

    const relationships = (await listRelationships(tx, context.workspaceId)).map(
      (relationship) => ({
        id: relationship.id,
        workspaceId: context.workspaceId,
        sourceItemId: relationship.sourceItemId,
        targetItemId: relationship.targetItemId,
        relationType: relationship.relationType,
        metadata: relationship.metadata,
        createdRevisionId: relationship.createdRevisionId,
        removedRevisionId: relationship.removedRevisionId,
      }),
    );

    return buildCanonicalExport({
      workspaceId: context.workspaceId,
      schemaVersion: context.schemaVersion,
      exportedAt: new Date().toISOString(),
      changeCursor: sequenceToCursor(sequence),
      items,
      relationships,
      revisions,
    });
  });
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
    await context.db
      .update(schema.exports)
      .set({
        status: "ready",
        ready: true,
        digest,
        manifest,
        completedAt: new Date(),
      })
      .where(eq(schema.exports.id, exportId));
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
      if (row === undefined || row.status !== "ready" || row.manifest === null) {
        return sendProblem(reply, { code: "item.not-found", title: "Export artifact not ready" });
      }
      return reply
        .header("content-type", "application/json")
        .header("x-export-digest", row.digest ?? "")
        .send(row.manifest);
    },
  );
}
