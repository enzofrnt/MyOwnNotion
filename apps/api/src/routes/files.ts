/**
 * File import and copy-on-write content replacement (T059, US2).
 *
 * Multipart import: bytes are ingested through the content store (verified
 * physical reuse only), then the logical file, placement, and revision are
 * created in one transaction. Every independent import yields an
 * independent logical file (FR-034).
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { ContentIngestResult } from "@myownnotion/blob-store";
import { MutationResultSchema } from "@myownnotion/contracts";
import {
  DomainRejection,
  executeImportFile,
  executeReplaceFileContent,
  findVerifiedContentByDigest,
  getFileContentDescriptor,
  readItem,
  recordChange,
  runMutation,
  schema,
} from "@myownnotion/database";
import {
  contentDispositionForFile,
  generateUuidV7,
  isUuid,
  MAX_FILE_BYTE_LENGTH,
  parseSingleByteRange,
  replayResult,
  type SafeError,
  type Uuid,
} from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";
import { mutationIdFrom } from "../plugins/mutations.ts";

interface ParsedUpload {
  readonly content: ContentIngestResult;
  readonly filename: string;
  readonly mediaType: string;
  readonly fields: Record<string, unknown>;
}

const FileContentParamsSchema = Type.Object({ itemId: Type.String({ format: "uuid" }) });
const FileContentQuerySchema = Type.Object({
  revisionId: Type.String({ format: "uuid" }),
});

type AvailableDescriptor = Extract<
  Awaited<ReturnType<typeof getFileContentDescriptor>>,
  { status: "available" }
>["value"];

async function verifyDescriptorBytes(
  context: AppContext,
  descriptor: AvailableDescriptor,
): Promise<"verified" | "missing" | "mismatched"> {
  let opened: Awaited<ReturnType<AppContext["contentStore"]["open"]>>;
  try {
    opened = await context.contentStore.open(descriptor.storageKey);
  } catch {
    return "missing";
  }
  if (opened === null) {
    return "missing";
  }
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of opened.body) {
      byteLength += chunk.byteLength;
      if (byteLength > descriptor.byteLength) {
        return "mismatched";
      }
      hash.update(chunk);
    }
  } catch {
    return "missing";
  }
  return byteLength === descriptor.byteLength && hash.digest("hex") === descriptor.sha256
    ? "verified"
    : "mismatched";
}

function applyFileHeaders(
  reply: FastifyReply,
  descriptor: AvailableDescriptor,
  contentLength: number,
  mediaType: string,
): void {
  reply.headers({
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": contentDispositionForFile(descriptor.name, descriptor.mediaType),
    "content-length": contentLength,
    "content-type": mediaType,
    etag: `"${descriptor.sha256}"`,
    "x-content-id": descriptor.contentId,
    "x-content-sha256": descriptor.sha256,
    "x-content-type-options": "nosniff",
    "x-file-revision-id": descriptor.revisionId,
  });
}

function descriptorProblem(
  result: Exclude<Awaited<ReturnType<typeof getFileContentDescriptor>>, { status: "available" }>,
): SafeError {
  if (result.status === "stale-revision") {
    return {
      code: "file.stale-revision",
      title: "Requested file revision is no longer current",
      competingRevisionIds: [result.currentRevisionId],
    };
  }
  if (result.status === "unavailable" && result.reason === "metadata-mismatch") {
    return { code: "file.integrity-failed", title: "File metadata failed verification" };
  }
  return { code: "file.content-unavailable", title: "File content is unavailable" };
}

async function parseMultipart(
  request: {
    parts: () => AsyncIterableIterator<
      | {
          type: "file";
          filename?: string;
          mimetype?: string;
          file: AsyncIterable<Uint8Array> & { truncated?: boolean };
        }
      | { type: "field"; fieldname: string; value: unknown }
    >;
  },
  context: AppContext,
): Promise<ParsedUpload | null> {
  let content: ContentIngestResult | null = null;
  let filename = "file";
  let mediaType = "application/octet-stream";
  const fields: Record<string, unknown> = {};
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (content !== null) {
          throw new RangeError("multipart upload accepts exactly one file part");
        }
        content = await context.contentStore.ingest(
          part.file,
          (sha256, byteLength) => findVerifiedContentByDigest(context.db, sha256, byteLength),
          { maxByteLength: MAX_FILE_BYTE_LENGTH },
        );
        if (part.file.truncated === true) {
          await context.contentStore.discardUnreferenced(content);
          throw new RangeError("multipart file exceeds maximum byte length");
        }
        filename = part.filename ?? filename;
        mediaType = part.mimetype ?? mediaType;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (content !== null) await context.contentStore.discardUnreferenced(content);
    throw error;
  }
  return content === null ? null : { content, filename, mediaType, fields };
}

async function existingMutationReplay(
  context: AppContext,
  mutationId: Uuid,
  commandType: "file.import" | "file.content.replace",
): Promise<{ status: "accepted"; revisionIds: readonly Uuid[] } | { status: "rejected" } | null> {
  const rows = await context.db
    .select()
    .from(schema.mutations)
    .where(eq(schema.mutations.id, mutationId))
    .limit(1);
  const record = rows[0];
  if (record === undefined) return null;
  if (record.commandType !== commandType) return { status: "rejected" };
  const replay = replayResult({
    id: record.id as Uuid,
    workspaceId: record.workspaceId as Uuid,
    commandType: record.commandType,
    status: record.status as "accepted" | "rejected",
    submittedAt: record.submittedAt.toISOString(),
    acceptedAt: record.acceptedAt?.toISOString() ?? null,
    resultRevisionIds: record.resultRevisionIds as Uuid[],
    failureCode: record.failureCode,
  });
  return replay.status === "already-accepted"
    ? { status: "accepted", revisionIds: replay.revisionIds ?? [] }
    : { status: "rejected" };
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
  app.head(
    "/v1/files/:itemId/content",
    {
      schema: {
        params: FileContentParamsSchema,
        querystring: FileContentQuerySchema,
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: Uuid };
      const { revisionId } = request.query as { revisionId: Uuid };
      const descriptor = await context.db.transaction((tx) =>
        getFileContentDescriptor(tx, itemId, revisionId),
      );
      if (descriptor.status !== "available") {
        return sendProblem(reply, descriptorProblem(descriptor));
      }
      const verification = await verifyDescriptorBytes(context, descriptor.value);
      if (verification !== "verified") {
        return sendProblem(
          reply,
          verification === "missing"
            ? { code: "storage.unavailable", title: "Private file storage is unavailable" }
            : { code: "file.integrity-failed", title: "Stored file failed integrity verification" },
        );
      }
      applyFileHeaders(
        reply,
        descriptor.value,
        descriptor.value.byteLength,
        descriptor.value.mediaType,
      );
      return reply.status(200).send();
    },
  );

  app.get(
    "/v1/files/:itemId/content",
    {
      exposeHeadRoute: false,
      schema: {
        params: FileContentParamsSchema,
        querystring: FileContentQuerySchema,
      },
    },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: Uuid };
      const { revisionId } = request.query as { revisionId: Uuid };
      const descriptor = await context.db.transaction((tx) =>
        getFileContentDescriptor(tx, itemId, revisionId),
      );
      if (descriptor.status !== "available") {
        return sendProblem(reply, descriptorProblem(descriptor));
      }
      const rangeHeader = request.headers.range;
      if (rangeHeader !== undefined && rangeHeader.length > 128) {
        return sendProblem(reply, {
          code: "file.range-invalid",
          title: "Requested byte range is invalid",
        });
      }
      const parsedRange = parseSingleByteRange(rangeHeader, descriptor.value.byteLength);
      if (!parsedRange.ok) {
        if (parsedRange.code === "range.unsatisfiable") {
          reply.header("content-range", `bytes */${descriptor.value.byteLength}`);
          return sendProblem(reply, {
            code: "file.range-unsatisfiable",
            title: "Requested byte range cannot be satisfied",
          });
        }
        return sendProblem(reply, {
          code:
            parsedRange.code === "range.multiple-not-supported"
              ? "file.range-multiple-not-supported"
              : "file.range-invalid",
          title: "Requested byte range is invalid",
        });
      }

      const verification = await verifyDescriptorBytes(context, descriptor.value);
      if (verification !== "verified") {
        return sendProblem(
          reply,
          verification === "missing"
            ? { code: "storage.unavailable", title: "Private file storage is unavailable" }
            : { code: "file.integrity-failed", title: "Stored file failed integrity verification" },
        );
      }

      let opened: Awaited<ReturnType<AppContext["contentStore"]["open"]>>;
      try {
        opened = await context.contentStore.open(
          descriptor.value.storageKey,
          parsedRange.range ?? undefined,
        );
      } catch {
        return sendProblem(reply, {
          code: "storage.unavailable",
          title: "Private file storage is unavailable",
        });
      }
      if (opened === null) {
        return sendProblem(reply, {
          code: "storage.unavailable",
          title: "Private file storage is unavailable",
        });
      }
      const partial = parsedRange.range !== null;
      applyFileHeaders(
        reply,
        descriptor.value,
        opened.contentLength,
        partial ? "application/octet-stream" : descriptor.value.mediaType,
      );
      reply.header("content-security-policy", "sandbox; default-src 'none'");
      if (opened.range !== null) {
        reply.header(
          "content-range",
          `bytes ${opened.range.start}-${opened.range.endInclusive}/${descriptor.value.byteLength}`,
        );
      }
      return reply.status(partial ? 206 : 200).send(Readable.from(opened.body));
    },
  );

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
      const prior = await existingMutationReplay(context, mutationId, "file.import");
      if (prior?.status === "accepted") {
        return reply.status(201).send({ mutationId, revisionIds: prior.revisionIds });
      }
      if (prior?.status === "rejected") {
        return sendProblem(reply, {
          code: "mutation.rejected",
          title: "Mutation was previously rejected",
        });
      }
      const upload = await parseMultipart(
        request as unknown as Parameters<typeof parseMultipart>[0],
        context,
      );
      if (upload === null) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a file part",
        });
      }
      const placement = parsePlacementField(upload.fields["placement"]);
      if (placement === null) {
        await context.contentStore.discardUnreferenced(upload.content);
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a valid placement field",
        });
      }
      const requestedItemId = upload.fields["itemId"];
      const itemId = isUuid(requestedItemId) ? requestedItemId : generateUuidV7();
      const acceptedAt = new Date();

      // Ingest bytes first (idempotent content addressing), then persist.
      let committed = false;
      try {
        const result = await runMutation(context.db, async (tx) => {
          const execution = await executeImportFile(tx, {
            mutationId,
            workspaceId: context.workspaceId,
            itemId,
            name: upload.filename,
            mediaType: upload.mediaType,
            content: upload.content,
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
        committed = true;
        const item = await readItem(context.db, result.itemId);
        return reply.status(201).send({
          mutationId,
          revisionIds: [result.revisionId],
          ...(item !== null ? { item } : {}),
        });
      } catch (error) {
        if (!committed) {
          await context.contentStore.discardUnreferenced(upload.content);
        }
        if (error instanceof DomainRejection) {
          return sendProblem(reply, error.safeError);
        }
        throw error;
      }
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
      const prior = await existingMutationReplay(context, mutationId, "file.content.replace");
      if (prior?.status === "accepted") {
        const item = await readItem(context.db, itemId as Uuid);
        return reply.status(200).send({
          mutationId,
          revisionIds: prior.revisionIds,
          ...(item !== null ? { item } : {}),
        });
      }
      if (prior?.status === "rejected") {
        return sendProblem(reply, {
          code: "mutation.rejected",
          title: "Mutation was previously rejected",
        });
      }
      const upload = await parseMultipart(
        request as unknown as Parameters<typeof parseMultipart>[0],
        context,
      );
      if (upload === null) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Multipart upload requires a file part",
        });
      }
      const baseRevisionId = upload.fields["baseRevisionId"];
      if (!isUuid(baseRevisionId)) {
        await context.contentStore.discardUnreferenced(upload.content);
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "baseRevisionId field is required",
        });
      }
      const acceptedAt = new Date();

      let committed = false;
      try {
        const result = await runMutation(context.db, async (tx) => {
          const execution = await executeReplaceFileContent(tx, {
            mutationId,
            itemId: itemId as Uuid,
            baseRevisionId,
            content: upload.content,
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
        committed = true;
        const item = await readItem(context.db, result.itemId);
        return reply.status(200).send({
          mutationId,
          revisionIds: [result.revisionId],
          ...(item !== null ? { item } : {}),
        });
      } catch (error) {
        if (!committed) {
          await context.contentStore.discardUnreferenced(upload.content);
        }
        if (error instanceof DomainRejection) {
          return sendProblem(reply, error.safeError);
        }
        throw error;
      }
    },
  );
}
