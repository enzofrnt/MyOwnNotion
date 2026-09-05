/**
 * Resumable upload endpoints (T047, T048, FR-006, FR-008, FR-009).
 *
 * The tus 1.0 shape: `POST` to create, `HEAD` to learn the offset, `PATCH` to
 * send from it. Small, and it answers the three questions a hand-rolled scheme
 * has to answer anyway — how many bytes arrived, what happens when client and
 * server disagree, and when an abandoned transfer is reclaimed.
 *
 * The rule the whole thing rests on: **the server's offset is the only
 * offset.** A `PATCH` that disagrees is refused with 409, never accepted at the
 * server's position. Silently correcting it writes the client's bytes to the
 * wrong place, and the file then completes and verifies as though nothing had
 * happened — which is worse than any failure that announces itself.
 */

import {
  type Database,
  DomainRejection,
  executeImportFile,
  isComplete,
  lockUpload,
  recordChange,
  runMutation,
  schema,
  type Transaction,
  type UploadRecord,
} from "@myownnotion/database";
import { generateUuidV7, isUuid, type SafeError, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { shareFullFileMutation } from "../backup/full/locks.ts";
import type { AppContext } from "../context.ts";
import { retireProtectedUpload } from "../files/protected-file-cleanup.ts";
import { ProtectedFileUnavailableError } from "../files/protected-file-service.ts";
import {
  ProtectedUploadService,
  UploadLengthExceededError,
} from "../files/protected-upload-service.ts";
import { sendProblem } from "../plugins/errors.ts";
import { acceptedWriteGuards, attributionFor } from "../plugins/mutations.ts";
import { announceCommitted } from "../sync/change-notifier.ts";

/** 2 GB by default, and bounded in practice by what the deployment carries. */
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

function protectedUploads(context: AppContext): ProtectedUploadService {
  if (context.protectedFiles === undefined) throw new ProtectedFileUnavailableError();
  return new ProtectedUploadService(context.protectedFiles);
}

async function completedUpload(
  executor: Database | Transaction,
  workspaceId: Uuid,
  uploadId: Uuid,
) {
  const [receipt] = await executor
    .select()
    .from(schema.protectedUploadCompletions)
    .where(
      and(
        eq(schema.protectedUploadCompletions.uploadId, uploadId),
        eq(schema.protectedUploadCompletions.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return receipt;
}

export function maxFileBytes(): number {
  const configured = process.env["MYOWNNOTION_MAX_FILE_BYTES"];
  if (configured === undefined) {
    return DEFAULT_MAX_FILE_BYTES;
  }
  const parsed = Number(configured);
  // A misconfigured limit falls back to the default rather than to zero or to
  // infinity: one would refuse every file, the other would promise something
  // the deployment cannot carry.
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_FILE_BYTES;
}

/** Decodes `Upload-Metadata: key base64, key base64` (tus). */
export function parseUploadMetadata(header: string | undefined): Record<string, string> {
  if (header === undefined || header.trim() === "") {
    return {};
  }
  const parsed: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const [key, encoded] = pair.trim().split(" ");
    if (key === undefined || key === "") {
      continue;
    }
    parsed[key] = encoded === undefined ? "" : Buffer.from(encoded, "base64").toString("utf8");
  }
  return parsed;
}

/**
 * Turns a finished upload into a file, in one transaction (T049, FR-007).
 *
 * Everything that makes the file real happens together: the bytes are hashed,
 * matched against existing content so a resumed upload of something already held
 * deduplicates like any other, `verified_at` is set, and the logical file and its
 * placement are created. Either the file exists completely or it does not exist
 * at all — there is no state in which an item points at unverified bytes.
 *
 * The partial file is discarded only after the transaction commits. Discarding
 * first would, on a failed commit, leave the upload recorded as complete with
 * its bytes gone and no file to show for them.
 */
async function completeUpload(
  context: AppContext,
  upload: UploadRecord,
  request: FastifyRequest,
): Promise<{ ok: true; itemId: Uuid } | { ok: false; error: SafeError }> {
  // Editor blocks already contain this UUID before any network request. Using
  // the upload identity for the final logical file keeps that durable document
  // reference valid after verification instead of silently creating a second,
  // unrelated UUID on the server.
  const itemId = upload.id;
  const mutationId = generateUuidV7();
  // Announced after the transaction, never from inside it (feature 006). A file
  // is the case where the difference is most visible: the notification is worth
  // little if the other device fetches before the row is there, and it would then
  // wait for the next unrelated change to discover a file it was already told
  // about.
  let committedSequence: number | undefined;
  const protectedTransfers = protectedUploads(context);
  try {
    await runMutation(context.db, async (tx) => {
      await context.rotationPolicies?.assertWritesAllowed(tx);
      await protectedTransfers.lockGeneration(tx);
      const current = await lockUpload(tx, upload.id);
      if (current === null && (await completedUpload(tx, context.workspaceId, upload.id))) return;
      if (current === null || !isComplete(current)) {
        throw new DomainRejection({
          code: "item.not-found",
          title: "The completed transfer is no longer available",
        });
      }
      const resolved = await protectedTransfers.resolve(tx, current);
      const stored = await protectedTransfers.files.ingest(
        tx,
        protectedTransfers.read(tx, resolved),
        { maxBytes: resolved.declaredLength, expectedLength: resolved.declaredLength },
      );
      const execution = await executeImportFile(tx, {
        mutationId,
        workspaceId: context.workspaceId,
        itemId,
        name: resolved.originalName,
        mediaType: resolved.mediaType,
        content: stored,
        placement:
          upload.attachmentParentItemId === null
            ? { kind: "hierarchy", parentItemId: null, positionKey: "V" }
            : {
                kind: "attachment",
                parentItemId: upload.attachmentParentItemId,
                positionKey: "V",
              },
        acceptedAt: new Date(),
      });
      if (!execution.ok) {
        throw new DomainRejection(execution.error);
      }
      await acceptedWriteGuards(
        { type: "file.import" },
        context.protectedContent,
        context.rotationPolicies,
        attributionFor(request, mutationId),
      ).onAccepted?.(tx, { primaryItemId: itemId, revisionIds: [execution.value.revisionId] });
      // The mutation record and the change envelope belong in the same
      // transaction as the file. Without them the file exists and no client
      // learns of it: the change feed is how every other device finds out, so
      // an item outside it is invisible everywhere except here.
      const acceptedAt = new Date();
      await tx.insert(schema.mutations).values({
        id: mutationId,
        workspaceId: context.workspaceId,
        commandType: "file.import",
        status: "accepted",
        submittedAt: acceptedAt,
        acceptedAt,
        resultRevisionIds: [execution.value.revisionId],
      });
      committedSequence = await recordChange(tx, {
        workspaceId: context.workspaceId,
        mutationId,
        revisionIds: [execution.value.revisionId],
        changedItemIds: [execution.value.itemId],
      });
      await retireProtectedUpload(tx, protectedTransfers.files, upload.id);
      await tx.insert(schema.protectedUploadCompletions).values({
        uploadId: upload.id,
        workspaceId: context.workspaceId,
        itemId,
        byteLength: resolved.declaredLength,
        completedAt: acceptedAt,
      });
    });
  } catch (error) {
    if (error instanceof DomainRejection) {
      return { ok: false, error: error.safeError };
    }
    throw error;
  }

  announceCommitted(committedSequence);
  if (committedSequence !== undefined && context.search !== undefined) {
    try {
      await context.search.applyCommittedChanges([itemId], committedSequence);
    } catch {
      // The file is canonical already; search invalidates and rebuilds itself.
    }
  }
  return { ok: true, itemId };
}

/** Reads the committed encrypted state while serializing against its next append. */
async function reconciledUpload(context: AppContext, uploadId: Uuid) {
  return await context.db.transaction(async (tx) => {
    await shareFullFileMutation(tx);
    const upload = await lockUpload(tx, uploadId);
    return upload === null ? null : protectedUploads(context).resolve(tx, upload);
  });
}

export function registerUploadRoutes(app: FastifyInstance, context: AppContext): void {
  // tus sends chunks as `application/offset+octet-stream`, which Fastify has no
  // parser for — without this every PATCH is refused with 415 before the route
  // is reached. The body is taken as raw bytes and not interpreted: the server
  // is storing what it was given, not reading it.
  app.addContentTypeParser("application/offset+octet-stream", (_request, body, done) => {
    done(null, body);
  });

  app.post(
    "/v1/uploads",
    {
      schema: {
        response: {
          201: Type.Object({ id: Type.String(), uploadLength: Type.Number() }),
          // Declared, not implicit: Fastify serialises a response against the
          // schema for its status, and an undeclared 413 would be stripped down
          // to nothing — taking with it the limit FR-009 requires the owner to
          // be told.
          413: Type.Object({
            type: Type.String(),
            title: Type.String(),
            status: Type.Number(),
            code: Type.String(),
            limitBytes: Type.Number(),
            declaredBytes: Type.Number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const declared = Number(request.headers["upload-length"]);
      if (!Number.isSafeInteger(declared) || declared < 0) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "Upload-Length must be a non-negative number of bytes",
        });
      }
      const limit = maxFileBytes();
      if (declared > limit) {
        // Refused before a single byte is accepted, and the limit travels in
        // the body: FR-009 requires the owner to be told *what* the limit is,
        // not merely that one exists. Nothing here touches their draft.
        return reply.status(413).header("content-type", "application/problem+json").send({
          type: "https://myownnotion.dev/problems/file.too-large",
          title: "This file is larger than this installation accepts",
          status: 413,
          code: "file.too-large",
          limitBytes: limit,
          declaredBytes: declared,
        });
      }

      const metadata = parseUploadMetadata(
        request.headers["upload-metadata"] as string | undefined,
      );
      const requestedItemId = metadata["itemId"];
      if (requestedItemId !== undefined && !isUuid(requestedItemId)) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "The requested file identity is invalid",
        });
      }
      const attachmentParentItemId = metadata["attachmentParentItemId"];
      if (attachmentParentItemId !== undefined && !isUuid(attachmentParentItemId)) {
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "The attachment source page identity is invalid",
        });
      }
      const upload = await context.db.transaction(async (tx) => {
        await context.rotationPolicies?.assertWritesAllowed(tx);
        return protectedUploads(context).create(tx, {
          ...(requestedItemId === undefined ? {} : { id: requestedItemId as Uuid }),
          ...(attachmentParentItemId === undefined
            ? {}
            : { attachmentParentItemId: attachmentParentItemId as Uuid }),
          workspaceId: context.workspaceId,
          declaredLength: declared,
          mediaType: metadata["mediaType"] ?? "application/octet-stream",
          originalName: metadata["filename"] ?? "untitled",
        });
      });
      return reply
        .status(201)
        .header("location", `/v1/uploads/${upload.id}`)
        .header("upload-offset", "0")
        .header("tus-resumable", "1.0.0")
        .send({ id: upload.id, uploadLength: upload.declaredLength });
    },
  );

  app.head("/v1/uploads/:uploadId", async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    if (!isUuid(uploadId)) {
      return reply.status(404).send();
    }
    const upload = await reconciledUpload(context, uploadId as Uuid);
    if (upload === null) {
      const receipt = await completedUpload(context.db, context.workspaceId, uploadId as Uuid);
      if (receipt !== undefined)
        return reply
          .status(200)
          .header("upload-offset", String(receipt.byteLength))
          .header("upload-length", String(receipt.byteLength))
          .header("upload-complete", "true")
          .header("cache-control", "no-store")
          .header("tus-resumable", "1.0.0")
          .send();
      // 410 rather than 404 when it expired would need a tombstone; without
      // one, "gone" and "never existed" are the same answer, and both mean the
      // client must start again rather than retry forever.
      return reply.status(404).header("tus-resumable", "1.0.0").send();
    }
    // The authoritative offset. Everything the client does next follows from
    // this number rather than from anything it remembered.
    return reply
      .status(200)
      .header("upload-offset", String(upload.receivedLength))
      .header("upload-length", String(upload.declaredLength))
      .header("cache-control", "no-store")
      .header("tus-resumable", "1.0.0")
      .send();
  });

  app.patch("/v1/uploads/:uploadId", async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    if (!isUuid(uploadId)) {
      return reply.status(404).send();
    }
    const offset = Number(request.headers["upload-offset"]);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return sendProblem(reply, {
        code: "validation.invalid-payload",
        title: "Upload-Offset must be a non-negative number of bytes",
      });
    }

    const receipt = await completedUpload(context.db, context.workspaceId, uploadId as Uuid);
    if (receipt !== undefined)
      return reply
        .status(201)
        .header("upload-offset", String(receipt.byteLength))
        .header("upload-complete", "true")
        .header("tus-resumable", "1.0.0")
        .send({ itemId: receipt.itemId, verified: true });
    const source = request.body as AsyncIterable<Uint8Array>;
    let outcome: Awaited<ReturnType<ProtectedUploadService["append"]>>;
    try {
      outcome = await context.db.transaction(async (tx) => {
        await context.rotationPolicies?.assertWritesAllowed(tx);
        return protectedUploads(context).append(tx, { id: uploadId as Uuid, offset, source });
      });
    } catch (error) {
      if (error instanceof UploadLengthExceededError)
        return sendProblem(reply, {
          code: "validation.invalid-payload",
          title: "This chunk would exceed the length the upload declared",
        });
      throw error;
    }

    if (!outcome.ok && outcome.reason === "not-found") {
      return reply.status(404).header("tus-resumable", "1.0.0").send();
    }
    if (!outcome.ok && outcome.reason === "offset-mismatch") {
      // The client is told where the server actually is, so its next request
      // is correct rather than another guess.
      return reply
        .status(409)
        .header("upload-offset", String(outcome.expected))
        .header("tus-resumable", "1.0.0")
        .send();
    }
    if (!outcome.ok) {
      return sendProblem(reply, {
        code: "validation.invalid-payload",
        title: "This chunk would exceed the length the upload declared",
      });
    }

    const complete = isComplete(outcome.upload);
    if (complete) {
      const finished = await completeUpload(context, outcome.upload, request);
      if (!finished.ok) {
        return sendProblem(reply, finished.error);
      }
      return reply
        .status(201)
        .header("upload-offset", String(outcome.upload.receivedLength))
        .header("upload-complete", "true")
        .header("tus-resumable", "1.0.0")
        .send({ itemId: finished.itemId, verified: true });
    }
    return reply
      .status(204)
      .header("upload-offset", String(outcome.upload.receivedLength))
      .header("upload-complete", "false")
      .header("tus-resumable", "1.0.0")
      .send();
  });
}
