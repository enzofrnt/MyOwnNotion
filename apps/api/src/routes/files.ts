/**
 * File import and copy-on-write content replacement (T059, US2).
 *
 * Multipart import: bytes are ingested through the content store (verified
 * physical reuse only), then the logical file, placement, and revision are
 * created in one transaction. Every independent import yields an
 * independent logical file (FR-034).
 */

import { Readable } from "node:stream";
import { FileUsagesResponseSchema, MutationResultSchema } from "@myownnotion/contracts";
import {
  DomainRejection,
  executeImportFile,
  executeReplaceFileContent,
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
import { parseFileRange } from "../files/file-range.ts";
import {
  ProtectedFileUnavailableError,
  type ProtectedStoredContent,
} from "../files/protected-file-service.ts";
import { sendProblem } from "../plugins/errors.ts";
import { acceptedWriteGuards, attributionFor, mutationIdFrom } from "../plugins/mutations.ts";
import { resolveProtectedContent } from "../security/content-resolution.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import { maxFileBytes } from "./uploads.ts";

interface ParsedUpload {
  readonly content: ProtectedStoredContent;
  readonly filename: string;
  readonly mediaType: string;
  readonly fields: Record<string, unknown>;
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
  consume: (source: AsyncIterable<Uint8Array>) => Promise<ProtectedStoredContent>,
): Promise<ParsedUpload | null> {
  let content: ProtectedStoredContent | null = null;
  let filename = "file";
  let mediaType = "application/octet-stream";
  const fields: Record<string, unknown> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (content !== null)
        throw new DomainRejection({
          code: "validation.invalid-payload",
          title: "Only one file part is accepted",
        });
      content = await consume(part.file);
      if (part.file.truncated)
        throw new DomainRejection({
          code: "resource.limit-exceeded",
          title: "The file exceeds the configured size limit",
        });
      filename = part.filename ?? filename;
      mediaType = part.mimetype ?? mediaType;
    } else {
      fields[part.fieldname] = part.value;
    }
  }
  return content === null ? null : { content, filename, mediaType, fields };
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
      const files = context.protectedFiles;
      if (files === undefined) throw new ProtectedFileUnavailableError();
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

      // Stream once within the publication transaction; a conflict requires a fresh request.
      try {
        const result = await runMutation(
          context.db,
          async (tx) => {
            await context.rotationPolicies?.assertWritesAllowed(tx);
            const upload = await parseMultipart(
              request as unknown as Parameters<typeof parseMultipart>[0],
              (source) => files.ingest(tx, source, { maxBytes: maxFileBytes() }),
            );
            if (upload === null)
              throw new DomainRejection({
                code: "validation.invalid-payload",
                title: "Multipart upload requires a file part",
              });
            const placement = parsePlacementField(upload.fields["placement"]);
            if (placement === null)
              throw new DomainRejection({
                code: "validation.invalid-payload",
                title: "Multipart upload requires a valid placement field",
              });
            const requestedItemId = upload.fields["itemId"];
            const itemId = isUuid(requestedItemId) ? requestedItemId : generateUuidV7();
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
            await acceptedWriteGuards(
              { type: "file.import" },
              context.protectedContent,
              context.rotationPolicies,
              attributionFor(request, mutationId),
            ).onAccepted?.(tx, {
              primaryItemId: itemId,
              revisionIds: [execution.value.revisionId],
            });
            await tx.insert(schema.mutations).values({
              id: mutationId,
              workspaceId: context.workspaceId,
              commandType: "file.import",
              status: "accepted",
              submittedAt: acceptedAt,
              acceptedAt,
              resultRevisionIds: [execution.value.revisionId],
            });
            const committedSequence = await recordChange(tx, {
              workspaceId: context.workspaceId,
              mutationId,
              revisionIds: [execution.value.revisionId],
              changedItemIds: [execution.value.itemId],
            });
            return { ...execution.value, committedSequence };
          },
          { maxAttempts: 1 },
        );
        announceCommitted(result.committedSequence);
        if (context.search !== undefined) {
          try {
            await context.search.applyCommittedChanges([result.itemId], result.committedSequence);
          } catch {
            // The file committed; search invalidates and rebuilds itself.
          }
        }
        const raw = await readItem(context.db, result.itemId);
        const item =
          (
            await resolveProtectedContent(
              context.db,
              raw === null ? [] : [raw],
              context.protectedContent,
            )
          )[0] ?? null;
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
    "/v1/files/:itemId/content",
    { schema: { params: Type.Object({ itemId: Type.String({ format: "uuid" }) }) } },
    async (request, reply) => {
      const { itemId } = request.params as { itemId: string };
      const [logical] = await context.db
        .select()
        .from(schema.logicalFiles)
        .where(eq(schema.logicalFiles.itemId, itemId as Uuid))
        .limit(1);
      if (logical === undefined) {
        return sendProblem(reply, { code: "item.not-found", title: "File does not exist" });
      }
      const [content] = await context.db
        .select()
        .from(schema.fileContents)
        .where(eq(schema.fileContents.id, logical.contentId))
        .limit(1);
      if (content === undefined || content.verifiedAt === null) {
        // Unverified content is not served. Handing back bytes the server has
        // not confirmed would make "synchronized" mean less than FR-007 says.
        // Reported as not-found rather than with a code of its own: from the
        // caller's side there is nothing here to fetch, and the distinction
        // between "absent" and "not yet verified" is operator detail.
        return sendProblem(reply, {
          code: "item.not-found",
          title: "This file has no verified content to serve",
        });
      }
      const files = context.protectedFiles;
      if (content.storageFormat === "encrypted-chunks-v1") {
        if (files === undefined) throw new ProtectedFileUnavailableError();
        await files.manifest(context.db, content.id);
      }
      const metadata = await context.protectedContent?.readFileMetadata(context.db, {
        kind: "file",
        id: itemId,
      });
      if (content.storageFormat === "encrypted-chunks-v1" && metadata == null)
        throw new ProtectedFileUnavailableError();
      const etag = `"content.${content.id}"`;
      const range = parseFileRange(
        request.method !== "GET" ||
          (request.headers["if-range"] !== undefined && request.headers["if-range"] !== etag)
          ? undefined
          : request.headers.range,
        content.byteLength,
      );
      if (range === "unsatisfiable")
        return reply
          .status(416)
          .header("content-range", `bytes */${content.byteLength}`)
          .header("accept-ranges", "bytes")
          .header("cache-control", "no-store")
          .send();
      const bytes =
        content.storageFormat === "encrypted-chunks-v1" && files !== undefined
          ? Readable.from(files.read(context.db, content.id, range ?? undefined), {
              objectMode: false,
            })
          : content.storageKey === null
            ? null
            : await context.contentStore.read(content.storageKey);
      if (bytes === null) {
        return sendProblem(reply, {
          code: "item.not-found",
          title: "The stored bytes for this file could not be read",
        });
      }

      // Every header here is load-bearing, and each closes a different door.
      //
      // A file is arbitrary bytes the owner obtained somewhere else, and two of
      // the formats this product previews — SVG and PDF — can carry script.
      // Served inline from the application's own origin, that script runs with
      // the application's privileges against everything the owner has written.
      //
      //   `attachment`  stops the browser rendering it inline at all;
      //   `nosniff`     stops it being reinterpreted as something executable;
      //   the policy    denies the response any capability even if it is.
      //
      // Any one of them alone has a known bypass shape, which is why all three
      // are set rather than whichever seems sufficient.
      if (range !== null)
        reply.header("content-range", `bytes ${range.start}-${range.end}/${content.byteLength}`);
      return reply
        .status(range === null ? 200 : 206)
        .header("accept-ranges", "bytes")
        .header("etag", etag)
        .header("content-type", metadata?.mediaType ?? logical.mediaType)
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(metadata?.originalName ?? logical.originalName)}`,
        )
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, max-age=0, must-revalidate")
        .header("content-length", range === null ? content.byteLength : range.end - range.start + 1)
        .send(
          bytes instanceof Readable
            ? bytes
            : Buffer.from(range === null ? bytes : bytes.subarray(range.start, range.end + 1)),
        );
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
      const files = context.protectedFiles;
      if (files === undefined) throw new ProtectedFileUnavailableError();
      const acceptedAt = new Date();

      try {
        const result = await runMutation(
          context.db,
          async (tx) => {
            await context.rotationPolicies?.assertWritesAllowed(tx);
            const upload = await parseMultipart(
              request as unknown as Parameters<typeof parseMultipart>[0],
              (source) => files.ingest(tx, source, { maxBytes: maxFileBytes() }),
            );
            if (upload === null)
              throw new DomainRejection({
                code: "validation.invalid-payload",
                title: "Multipart upload requires a file part",
              });
            const baseRevisionId = upload.fields["baseRevisionId"];
            if (!isUuid(baseRevisionId))
              throw new DomainRejection({
                code: "validation.invalid-payload",
                title: "baseRevisionId field is required",
              });
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
            await acceptedWriteGuards(
              { type: "file.content.replace" },
              context.protectedContent,
              context.rotationPolicies,
              attributionFor(request, mutationId),
            ).onAccepted?.(tx, {
              primaryItemId: itemId as Uuid,
              revisionIds: [execution.value.revisionId],
            });
            await tx.insert(schema.mutations).values({
              id: mutationId,
              workspaceId: context.workspaceId,
              commandType: "file.content.replace",
              status: "accepted",
              submittedAt: acceptedAt,
              acceptedAt,
              resultRevisionIds: [execution.value.revisionId],
            });
            const committedSequence = await recordChange(tx, {
              workspaceId: context.workspaceId,
              mutationId,
              revisionIds: [execution.value.revisionId],
              changedItemIds: [execution.value.itemId],
            });
            return { ...execution.value, committedSequence };
          },
          { maxAttempts: 1 },
        );
        announceCommitted(result.committedSequence);
        if (context.search !== undefined) {
          try {
            await context.search.applyCommittedChanges([result.itemId], result.committedSequence);
          } catch {
            // The replacement committed; search invalidates and rebuilds itself.
          }
        }
        const raw = await readItem(context.db, result.itemId);
        const item =
          (
            await resolveProtectedContent(
              context.db,
              raw === null ? [] : [raw],
              context.protectedContent,
            )
          )[0] ?? null;
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
