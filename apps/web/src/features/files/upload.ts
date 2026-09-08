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

import { sessionCsrf } from "../../services/session-csrf.ts";

/** Do not forward private file bytes or authorization to a server-supplied external URL. */
function uploadRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const origin = typeof location === "undefined" ? "http://localhost" : location.origin;
  const target = new URL(url, origin);
  if (target.origin !== origin || target.username || target.password)
    throw new Error("Untrusted upload location");
  const headers = Object.fromEntries(new Headers(init.headers));
  const csrf = sessionCsrf("");
  if (csrf !== null && !["GET", "HEAD", "OPTIONS"].includes(init.method ?? "GET"))
    headers["x-csrf-token"] = csrf;
  return fetch(url, { ...init, headers, credentials: "same-origin", redirect: "error" });
}

/** 8 MiB: large enough to keep the request count sane, small enough to lose little. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** Prevents a broken server/proxy from making two offsets oscillate forever. */
const MAX_CONSECUTIVE_OFFSET_CORRECTIONS = 8;

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

/** File-like bytes, including an encrypted IndexedDB-backed source after restart. */
export interface UploadByteSource {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  slice(start?: number, end?: number): Blob | Promise<Blob>;
}

function readUploadOffset(headers: Headers): number | null {
  const raw = headers.get("upload-offset");
  if (raw === null || raw.trim() === "") return null;
  const offset = Number(raw);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

/** Creates the upload, or reports the refusal without touching the draft. */
export async function createUpload(
  file: UploadByteSource,
  fileItemId?: string,
  attachmentParentItemId?: string,
): Promise<{ ok: true; handle: UploadHandle } | { ok: false; state: TransferState }> {
  const response = await uploadRequest("/v1/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "upload-length": String(file.size),
      "upload-metadata": encodeMetadata({
        filename: file.name,
        mediaType: file.type,
        ...(fileItemId === undefined ? {} : { itemId: fileItemId }),
        ...(attachmentParentItemId === undefined ? {} : { attachmentParentItemId }),
      }),
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
  if (fileItemId !== undefined && body.id !== fileItemId) {
    return {
      ok: false,
      state: {
        kind: "blocked",
        reason: "The server did not preserve this file's document identity.",
      },
    };
  }
  return {
    ok: true,
    handle: {
      uploadId: body.id,
      location: response.headers.get("location") ?? `/v1/uploads/${body.id}`,
    },
  };
}

export type UploadDiscovery =
  | { readonly kind: "upload"; readonly handle: UploadHandle }
  | { readonly kind: "synchronized"; readonly state: TransferState }
  | { readonly kind: "missing" }
  | { readonly kind: "blocked"; readonly state: TransferState };

/**
 * Finds a transfer after a browser restart without risking a duplicate POST.
 * A new upload is permitted only when both the deterministic upload URL and
 * the final file item return 404. Any other response is ambiguity, not proof
 * that creating another server row is safe.
 */
export async function discoverUpload(fileItemId: string): Promise<UploadDiscovery> {
  const handle = { uploadId: fileItemId, location: `/v1/uploads/${fileItemId}` };
  const upload = await uploadRequest(handle.location, {
    method: "HEAD",
    credentials: "same-origin",
  });
  if (upload.ok) {
    return readUploadOffset(upload.headers) !== null
      ? { kind: "upload", handle }
      : {
          kind: "blocked",
          state: {
            kind: "blocked",
            reason: "Le serveur n’a pas fourni un offset de reprise valide.",
          },
        };
  }
  if (upload.status !== 404) {
    return {
      kind: "blocked",
      state: {
        kind: "blocked",
        reason: "Impossible de vérifier la reprise du transfert sans risquer un doublon.",
      },
    };
  }
  const item = await uploadRequest(`/v1/items/${encodeURIComponent(fileItemId)}`, {
    credentials: "same-origin",
  });
  if (item.ok) {
    const body = (await item.json().catch(() => null)) as { id?: unknown; kind?: unknown } | null;
    return body?.id === fileItemId && body.kind === "file"
      ? { kind: "synchronized", state: { kind: "synchronized", itemId: fileItemId } }
      : {
          kind: "blocked",
          state: { kind: "blocked", reason: "L’identité du fichier vérifié est incohérente." },
        };
  }
  if (item.status === 404) return { kind: "missing" };
  return {
    kind: "blocked",
    state: {
      kind: "blocked",
      reason: "Impossible de vérifier le fichier distant sans risquer un doublon.",
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
  const response = await uploadRequest(handle.location, {
    method: "HEAD",
    credentials: "same-origin",
  });
  if (!response.ok) {
    return null;
  }
  return readUploadOffset(response.headers);
}

/** Proves a final response was lost after the server already committed the file. */
async function verifiedFileExists(itemId: string): Promise<boolean> {
  const response = await uploadRequest(`/v1/items/${encodeURIComponent(itemId)}`, {
    credentials: "same-origin",
  });
  if (!response.ok) return false;
  const item = (await response.json().catch(() => null)) as {
    id?: unknown;
    kind?: unknown;
  } | null;
  return item?.id === itemId && item.kind === "file";
}

async function synchronizedAfterCommit(itemId: string): Promise<TransferState | null> {
  return (await verifiedFileExists(itemId)) ? { kind: "synchronized", itemId } : null;
}

async function readVerifiedCompletion(
  response: Response,
  uploadId: string,
): Promise<TransferState | null> {
  if (response.status !== 201) return null;
  const completed = (await response.json().catch(() => null)) as {
    itemId?: unknown;
    verified?: unknown;
  } | null;
  return completed?.verified === true && completed.itemId === uploadId
    ? { kind: "synchronized", itemId: uploadId }
    : null;
}

/**
 * Sends the rest of a file, resuming from wherever the server is.
 *
 * Safe to call again after any failure: it re-asks for the offset each time it
 * starts, so a retry never assumes the previous attempt's position.
 */
export async function sendRemaining(
  handle: UploadHandle,
  file: UploadByteSource,
  onProgress: (state: TransferState) => void,
): Promise<TransferState> {
  const startingAt = await serverOffset(handle);
  if (startingAt === null) {
    const committed = await synchronizedAfterCommit(handle.uploadId);
    if (committed !== null) {
      onProgress(committed);
      return committed;
    }
    return {
      kind: "blocked",
      reason: "This transfer expired. Starting it again will send the file from the beginning.",
    };
  }
  let offset: number = startingAt;
  let consecutiveOffsetCorrections = 0;
  if (offset > file.size) {
    return {
      kind: "blocked",
      reason: "The server holds more bytes than this local file. The transfer was stopped safely.",
    };
  }

  // A zero-byte file, or bytes committed just before a failed finalization,
  // needs one empty PATCH so the server can atomically create and verify the
  // logical file. Offset === size alone is not proof of completion.
  if (offset === file.size) {
    onProgress({ kind: "verifying" });
    const response = await uploadRequest(handle.location, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "content-type": "application/offset+octet-stream",
        "upload-offset": String(offset),
      },
      body: await file.slice(offset, offset),
    });
    const completed = await readVerifiedCompletion(response, handle.uploadId);
    if (completed !== null) {
      onProgress(completed);
      return completed;
    }
    if (response.status === 404) {
      const committed = await synchronizedAfterCommit(handle.uploadId);
      if (committed !== null) {
        onProgress(committed);
        return committed;
      }
    }
    return response.ok
      ? { kind: "verifying" }
      : {
          kind: "blocked",
          reason: "This transfer stopped while the server verified it. It is safe to retry.",
        };
  }

  while (offset < file.size) {
    onProgress({ kind: "uploading", sent: offset, total: file.size });
    const chunk = await file.slice(offset, Math.min(offset + CHUNK_BYTES, file.size));
    const response = await uploadRequest(handle.location, {
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
      const corrected = readUploadOffset(response.headers);
      if (corrected !== null) {
        if (corrected > file.size) {
          return {
            kind: "blocked",
            reason:
              "Le serveur annonce plus d’octets que le fichier local. Le transfert est arrêté sûrement.",
          };
        }
        if (corrected === offset) {
          return {
            kind: "blocked",
            reason:
              "Le serveur a refusé le transfert sans fournir de nouvel offset. Il est arrêté sûrement.",
          };
        }
        consecutiveOffsetCorrections += 1;
        if (consecutiveOffsetCorrections > MAX_CONSECUTIVE_OFFSET_CORRECTIONS) {
          return {
            kind: "blocked",
            reason:
              "Les offsets de reprise du serveur sont instables. Le transfert est arrêté sûrement.",
          };
        }
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
      if (asked > file.size) {
        return {
          kind: "blocked",
          reason:
            "Le serveur annonce plus d’octets que le fichier local. Le transfert est arrêté sûrement.",
        };
      }
      if (asked === offset) {
        return {
          kind: "blocked",
          reason:
            "Le serveur a refusé le transfert sans fournir de nouvel offset. Il est arrêté sûrement.",
        };
      }
      consecutiveOffsetCorrections += 1;
      if (consecutiveOffsetCorrections > MAX_CONSECUTIVE_OFFSET_CORRECTIONS) {
        return {
          kind: "blocked",
          reason:
            "Les offsets de reprise du serveur sont instables. Le transfert est arrêté sûrement.",
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

    if (response.status === 201) {
      const completed = await readVerifiedCompletion(response, handle.uploadId);
      if (completed === null) {
        return {
          kind: "blocked",
          reason: "The server could not prove the identity of the verified file.",
        };
      }
      onProgress(completed);
      return completed;
    }

    const next = readUploadOffset(response.headers);
    // Taken from the response rather than computed by adding the chunk size:
    // the server is the authority on what it stored, and the two can only ever
    // differ in the direction that loses data.
    if (next === null) {
      return {
        kind: "blocked",
        reason:
          "Le serveur n’a pas confirmé l’offset enregistré. Le transfert est arrêté sûrement.",
      };
    }
    if (next <= offset || next > file.size) {
      return {
        kind: "blocked",
        reason:
          "Le serveur n’a pas confirmé une progression valide. Le transfert est arrêté sûrement.",
      };
    }
    consecutiveOffsetCorrections = 0;
    offset = next;
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
