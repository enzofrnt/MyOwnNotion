/**
 * Sending a large file, and picking up where the server actually is (T050, FR-006).
 *
 * The client keeps no byte-count of its own. It asks (`HEAD`), seeks to the
 * answer, and continues — which is not a simplification but the correctness
 * argument: a client that trusted its own count would, after a dropped
 * connection, resume from a position the server does not hold and produce a file
 * that completes, verifies, and is wrong.
 *
 * Chunked because that is what makes an interruption survivable at all. A 2 GB
 * body in one request restarts from zero every time the connection blinks, which
 * on a domestic line can mean never finishing.
 */

/** 8 MiB: large enough to keep the request count sane, small enough to lose little. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export type TransferState =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading"; readonly sent: number; readonly total: number }
  | { readonly kind: "verifying" }
  | { readonly kind: "synchronized"; readonly itemId: string }
  /** Refused, with the reason and the limit stated (FR-009). */
  | {
      readonly kind: "blocked";
      readonly reason: string;
      readonly limitBytes?: number;
    };

export interface UploadHandle {
  readonly uploadId: string;
  readonly location: string;
}

/** Creates the upload, or reports the refusal without touching the draft. */
export async function createUpload(
  file: File,
): Promise<{ ok: true; handle: UploadHandle } | { ok: false; state: TransferState }> {
  const response = await fetch("/v1/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "upload-length": String(file.size),
      "upload-metadata": encodeMetadata({ filename: file.name, mediaType: file.type }),
    },
  });

  if (response.status === 413) {
    const problem = (await response.json()) as { limitBytes?: number; title?: string };
    // The limit is carried through rather than paraphrased: FR-009 asks that the
    // owner be told what it is, so they can act instead of guessing.
    return {
      ok: false,
      state: {
        kind: "blocked",
        reason:
          problem.title ??
          "This file is larger than this installation accepts. Nothing you were writing has been lost.",
        ...(problem.limitBytes === undefined ? {} : { limitBytes: problem.limitBytes }),
      },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      state: { kind: "blocked", reason: "This transfer could not be started." },
    };
  }

  const body = (await response.json()) as { id: string };
  return {
    ok: true,
    handle: {
      uploadId: body.id,
      location: response.headers.get("location") ?? `/v1/uploads/${body.id}`,
    },
  };
}

/**
 * The offset the server holds, which is the only offset that matters.
 *
 * `null` means the upload is gone — expired or never issued — and the caller
 * must start again rather than retry forever.
 */
export async function serverOffset(handle: UploadHandle): Promise<number | null> {
  const response = await fetch(handle.location, { method: "HEAD", credentials: "same-origin" });
  if (!response.ok) {
    return null;
  }
  const offset = Number(response.headers.get("upload-offset"));
  return Number.isFinite(offset) ? offset : null;
}

/**
 * Sends the rest of a file, resuming from wherever the server is.
 *
 * Safe to call again after any failure: it re-asks for the offset each time it
 * starts, so a retry never assumes the previous attempt's position.
 */
export async function sendRemaining(
  handle: UploadHandle,
  file: File,
  onProgress: (state: TransferState) => void,
): Promise<TransferState> {
  const startingAt = await serverOffset(handle);
  if (startingAt === null) {
    return {
      kind: "blocked",
      reason: "This transfer expired. Starting it again will send the file from the beginning.",
    };
  }
  let offset: number = startingAt;

  while (offset < file.size) {
    onProgress({ kind: "uploading", sent: offset, total: file.size });
    const chunk = file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
    const response = await fetch(handle.location, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/offset+octet-stream",
        "upload-offset": String(offset),
      },
      body: chunk,
    });

    if (response.status === 409) {
      // The server disagreed. Its number wins, always: continuing from ours
      // would write bytes to the wrong place inside a file that then completes
      // and verifies as though nothing had happened.
      const corrected = Number(response.headers.get("upload-offset"));
      if (Number.isFinite(corrected)) {
        offset = corrected;
        continue;
      }
      // No usable correction in the response: ask outright rather than guess.
      const asked = await serverOffset(handle);
      if (asked === null) {
        return {
          kind: "blocked",
          reason: "This transfer is no longer available. Starting it again will send it afresh.",
        };
      }
      offset = asked;
      continue;
    }
    if (!response.ok) {
      return {
        kind: "blocked",
        reason: "This transfer stopped. It will continue from where it got to when you retry.",
      };
    }

    const next = Number(response.headers.get("upload-offset"));
    // Taken from the response rather than computed by adding the chunk size:
    // the server is the authority on what it stored, and the two can only ever
    // differ in the direction that loses data.
    offset = Number.isFinite(next) ? next : offset + chunk.size;
  }

  onProgress({ kind: "verifying" });
  return { kind: "verifying" };
}

function encodeMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(value)))}`)
    .join(",");
}
