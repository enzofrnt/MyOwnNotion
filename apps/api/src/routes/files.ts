/**
 * File import and copy-on-write content replacement (T059, US2).
 *
 * Multipart import: bytes are ingested through the content store (verified
 * physical reuse only), then the logical file, placement, and revision are
 * created in one transaction. Every independent import yields an
 * independent logical file (FR-034).
 */

import { FileUsagesResponseSchema, MutationResultSchema } from "@myownnotion/contracts";
import {
  DomainRejection,
  executeImportFile,
  executeReplaceFileContent,
  findVerifiedContentByDigest,
  namedUsagesOfFile,
  readItem,
  recordChange,
  runMutation,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, isUuid, replayResult, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import { mutationIdFrom } from "../plugins/mutations.ts";

interface ParsedUpload {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
  readonly fields: Record<string, unknown>;
}

async function parseMultipart(request: {
  parts: () => AsyncIterableIterator<
    | { type: "file"; filename?: string; mimetype?: string; toBuffer: () => Promise<Buffer> }
    | { type: "field"; fieldname: string; value: unknown }
  >;
}): Promise<ParsedUpload | null> {
  let bytes: Uint8Array | null = null;
  let filename = "file";
  let mediaType = "application/octet-stream";
  const fields: Record<string, unknown> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      bytes = new Uint8Array(await part.toBuffer());
      filename = part.filename ?? filename;
      mediaType = part.mimetype ?? mediaType;
    } else {
      fields[part.fieldname] = part.value;
    }
  }
  return bytes === null ? null : { bytes, filename, mediaType, fields };
}

function parsePlacementField(raw: unknown): {
  kind: "hierarchy" | "attachment";
  parentItemId: Uuid | null;
  positionKey: string;
} | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      kind?: unknown;
      parentItemId?: unknown;
      positionKey?: unknown;
    };
    if (
      (parsed.kind !== "hierarchy" && parsed.kind !== "attachment") ||
      (parsed.parentItemId !== null && !isUuid(parsed.parentItemId)) ||
      typeof parsed.positionKey !== "string" ||
      parsed.positionKey.length === 0
    ) {
      return null;
    }
    return {
      kind: parsed.kind,
      parentItemId: parsed.parentItemId as Uuid | null,
      positionKey: parsed.positionKey,
    };
  } catch {
    return null;
  }
}

export function registerFileRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    "/v1/files",
    {
      schema: {
        response: { 201: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const mutationId = mutationIdFrom(request);
      if (mutationId === null) {
        return sendProblem(reply, {
          code: "validation.invalid-identifier",
          title: "Idempotency-Key header must be a UUID mutation identity",
        });
      }
      const upload = await parseMultipart(
        request as unknown as Parameters<typeof parseMultipart>[0],
      );
      if (upload === null) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a file part",
        });
      }
      const placement = parsePlacementField(upload.fields["placement"]);
      if (placement === null) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a valid placement field",
        });
      }
      const requestedItemId = upload.fields["itemId"];
      const itemId = isUuid(requestedItemId) ? requestedItemId : generateUuidV7();
      const acceptedAt = new Date();

      // Replay: an already accepted import returns its prior result.
      const prior = await context.db
        .select()
        .from(schema.mutations)
        .where(eq(schema.mutations.id, mutationId))
        .limit(1);
      const priorRecord = prior[0];
      if (priorRecord !== undefined) {
        const replay = replayResult({
          id: priorRecord.id as Uuid,
          workspaceId: priorRecord.workspaceId as Uuid,
          commandType: priorRecord.commandType,
          status: priorRecord.status as "accepted" | "rejected",
          submittedAt: priorRecord.submittedAt.toISOString(),
          acceptedAt: priorRecord.acceptedAt?.toISOString() ?? null,
          resultRevisionIds: priorRecord.resultRevisionIds as Uuid[],
          failureCode: priorRecord.failureCode,
        });
        if (replay.status === "already-accepted") {
          return reply.status(201).send({
            mutationId,
            revisionIds: replay.revisionIds ?? [],
          });
        }
        return sendProblem(reply, {
          code: "mutation.rejected",
          title: "Mutation was previously rejected",
        });
      }

      // Ingest bytes first (idempotent content addressing), then persist.
      try {
        const result = await runMutation(context.db, async (tx) => {
          const content = await context.contentStore.ingest(upload.bytes, (sha256, byteLength) =>
            findVerifiedContentByDigest(tx, sha256, byteLength),
          );
          const execution = await executeImportFile(tx, {
            mutationId,
            workspaceId: context.workspaceId,
            itemId,
            name: upload.filename,
            mediaType: upload.mediaType,
            content,
            placement,
            acceptedAt,
          });
          if (!execution.ok) {
            throw new DomainRejection(execution.error);
          }
          await tx.insert(schema.mutations).values({
            id: mutationId,
            workspaceId: context.workspaceId,
            commandType: "file.import",
            status: "accepted",
            submittedAt: acceptedAt,
            acceptedAt,
            resultRevisionIds: [execution.value.revisionId],
          });
          await recordChange(tx, {
            workspaceId: context.workspaceId,
            mutationId,
            revisionIds: [execution.value.revisionId],
            changedItemIds: [execution.value.itemId],
          });
          return execution.value;
        });
        const item = await readItem(context.db, result.itemId);
        return reply.status(201).send({
          mutationId,
          revisionIds: [result.revisionId],
          ...(item !== null ? { item } : {}),
        });
      } catch (error) {
        if (error instanceof DomainRejection) {
          return sendProblem(reply, error.safeError);
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/files/:itemId/usages",
    {
      schema: {
        params: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
        response: { 200: FileUsagesResponseSchema },
      },
    },
    async (request) => {
      const { itemId } = request.params as { itemId: string };
      // Read before a deletion is confirmed, so it answers "what would this
      // break" rather than "is this used" — the count alone is what
      // `file_contents.reference_count` already gives, and it is not enough to
      // decide with.
      const usages = await namedUsagesOfFile(context.db, itemId as Uuid);
      return { usages };
    },
  );

  app.put(
    "/v1/files/:itemId/content",
    {
      schema: {
        params: Type.Object({ itemId: Type.String({ format: "uuid" }) }),
        response: { 200: MutationResultSchema },
      },
    },
    async (request, reply) => {
      const mutationId = mutationIdFrom(request);
      if (mutationId === null) {
        return sendProblem(reply, {
          code: "validation.invalid-identifier",
          title: "Idempotency-Key header must be a UUID mutation identity",
        });
      }
      const { itemId } = request.params as { itemId: string };
      const upload = await parseMultipart(
        request as unknown as Parameters<typeof parseMultipart>[0],
      );
      if (upload === null) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a file part",
        });
      }
      const baseRevisionId = upload.fields["baseRevisionId"];
      if (!isUuid(baseRevisionId)) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "baseRevisionId field is required",
        });
      }
      const acceptedAt = new Date();

      try {
        const result = await runMutation(context.db, async (tx) => {
          const content = await context.contentStore.ingest(upload.bytes, (sha256, byteLength) =>
            findVerifiedContentByDigest(tx, sha256, byteLength),
          );
          const execution = await executeReplaceFileContent(tx, {
            mutationId,
            itemId: itemId as Uuid,
            baseRevisionId,
            content,
            acceptedAt,
          });
          if (!execution.ok) {
            throw new DomainRejection(execution.error);
          }
          await tx.insert(schema.mutations).values({
            id: mutationId,
            workspaceId: context.workspaceId,
            commandType: "file.content.replace",
            status: "accepted",
            submittedAt: acceptedAt,
            acceptedAt,
            resultRevisionIds: [execution.value.revisionId],
          });
          await recordChange(tx, {
            workspaceId: context.workspaceId,
            mutationId,
            revisionIds: [execution.value.revisionId],
            changedItemIds: [execution.value.itemId],
          });
          return execution.value;
        });
        const item = await readItem(context.db, result.itemId);
        return reply.status(200).send({
          mutationId,
          revisionIds: [result.revisionId],
          ...(item !== null ? { item } : {}),
        });
      } catch (error) {
        if (error instanceof DomainRejection) {
          return sendProblem(reply, error.safeError);
        }
        throw error;
      }
    },
  );
}
