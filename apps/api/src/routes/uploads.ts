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
  advanceUpload,
  createUpload,
  DomainRejection,
  deleteUpload,
  executeImportFile,
  findVerifiedContentByDigest,
  getUpload,
  isComplete,
  recordChange,
  runMutation,
  schema,
} from "@myownnotion/database";
import { generateUuidV7, isUuid, type SafeError, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { sendProblem } from "../plugins/errors.ts";

/** 2 GB by default, and bounded in practice by what the deployment carries. */
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

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
  upload: { readonly id: Uuid; readonly mediaType: string; readonly originalName: string },
): Promise<{ ok: true; itemId: Uuid } | { ok: false; error: SafeError }> {
  const bytes = await context.partialUploads.read(upload.id);
  if (bytes === null) {
    return {
      ok: false,
      error: { code: "item.not-found", title: "The transferred bytes could not be read" },
    };
  }

  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  try {
    await runMutation(context.db, async (tx) => {
      const stored = await context.contentStore.ingest(bytes, (sha256, byteLength) =>
        findVerifiedContentByDigest(tx, sha256, byteLength),
      );
      const execution = await executeImportFile(tx, {
        mutationId,
        workspaceId: context.workspaceId,
        itemId,
        name: upload.originalName,
        mediaType: upload.mediaType,
        content: stored,
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        acceptedAt: new Date(),
      });
      if (!execution.ok) {
        throw new DomainRejection(execution.error);
      }
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
      await recordChange(tx, {
        workspaceId: context.workspaceId,
        mutationId,
        revisionIds: [execution.value.revisionId],
        changedItemIds: [execution.value.itemId],
      });
      await deleteUpload(tx, upload.id);
    });
  } catch (error) {
    if (error instanceof DomainRejection) {
      return { ok: false, error: error.safeError };
    }
    throw error;
  }

  await context.partialUploads.discard(upload.id);
  return { ok: true, itemId };
}

export function registerUploadRoutes(app: FastifyInstance, context: AppContext): void {
  // tus sends chunks as `application/offset+octet-stream`, which Fastify has no
  // parser for — without this every PATCH is refused with 415 before the route
  // is reached. The body is taken as raw bytes and not interpreted: the server
  // is storing what it was given, not reading it.
  app.addContentTypeParser(
    "application/offset+octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );

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
      if (!Number.isFinite(declared) || declared < 0) {
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
      const upload = await createUpload(context.db, {
        workspaceId: context.workspaceId,
        declaredLength: declared,
        mediaType: metadata["mediaType"] ?? "application/octet-stream",
        originalName: metadata["filename"] ?? "untitled",
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
    const upload = await getUpload(context.db, uploadId as Uuid);
    if (upload === null) {
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
    if (!Number.isFinite(offset) || offset < 0) {
      return sendProblem(reply, {
        code: "validation.invalid-payload",
        title: "Upload-Offset must be a non-negative number of bytes",
      });
    }

    const body = request.body;
    const chunk = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
    // The offset is recorded *before* the bytes are appended, and that order is
    // the safe one. If the record advances and the append then fails, the client
    // is told a position the file has not reached and the next HEAD reveals the
    // gap; if the bytes were appended first and the record failed, the file
    // would silently contain a chunk nothing accounts for.
    const outcome = await advanceUpload(context.db, {
      id: uploadId as Uuid,
      atOffset: offset,
      chunkLength: chunk.byteLength,
    });

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

    await context.partialUploads.append(uploadId, chunk);

    const upload = await getUpload(context.db, uploadId as Uuid);
    const complete = upload !== null && isComplete(upload);
    if (complete && upload !== null) {
      const finished = await completeUpload(context, upload);
      if (!finished.ok) {
        return sendProblem(reply, finished.error);
      }
      return reply
        .status(201)
        .header("upload-offset", String(outcome.receivedLength))
        .header("upload-complete", "true")
        .header("tus-resumable", "1.0.0")
        .send({ itemId: finished.itemId, verified: true });
    }
    return reply
      .status(204)
      .header("upload-offset", String(outcome.receivedLength))
      .header("upload-complete", "false")
      .header("tus-resumable", "1.0.0")
      .send();
  });
}
