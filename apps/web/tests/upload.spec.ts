/**
 * Resuming a transfer from where the server actually is (T050, FR-006, FR-009).
 *
 * The assertion that matters is what the client does when the server disagrees
 * about the offset: it takes the server's number, always. A client that kept its
 * own count would resume from a position the server does not hold and produce a
 * file that completes, verifies, and is wrong — the one failure here that never
 * announces itself.
 *
 * `fetch` is stubbed rather than mocked at a higher level, so the request the
 * client actually sends is the thing under test: the offset header is where the
 * bug would live.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpload, sendRemaining, type UploadHandle } from "../src/features/files/upload.ts";

const handle: UploadHandle = { uploadId: "u1", location: "/v1/uploads/u1" };

function fileOf(size: number): File {
  return new File([new Uint8Array(size)], "big.bin", { type: "application/octet-stream" });
}

function response(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}): Response {
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("starting a transfer", () => {
  it("passes the declared length and decoded metadata", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return response({
          status: 201,
          headers: { location: "/v1/uploads/u9" },
          body: { id: "u9" },
        });
      }),
    );

    const created = await createUpload(fileOf(120));
    expect(created.ok).toBe(true);
    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers["upload-length"]).toBe("120");
    // Base64 per tus, because a filename is arbitrary text and a header is not.
    expect(headers["upload-metadata"]).toContain("filename ");
  });

  it("asks the server to preserve the file identity already stored in the document", async () => {
    const fileItemId = generateUuidV7();
    let metadata = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        metadata = (init.headers as Record<string, string>)["upload-metadata"] ?? "";
        return response({
          status: 201,
          headers: { location: `/v1/uploads/${fileItemId}` },
          body: { id: fileItemId },
        });
      }),
    );

    await expect(createUpload(fileOf(12), fileItemId)).resolves.toMatchObject({
      ok: true,
      handle: { uploadId: fileItemId },
    });
    expect(metadata).toContain(`itemId ${btoa(fileItemId)}`);
  });

  it("reports the limit when the file is refused, and says the draft is safe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          status: 413,
          body: { title: "This file is larger than this installation accepts", limitBytes: 1024 },
        }),
      ),
    );

    const created = await createUpload(fileOf(99_999));
    expect(created.ok).toBe(false);
    if (created.ok) {
      return;
    }
    expect(created.state.kind).toBe("blocked");
    // FR-009: the limit itself, so the owner can act rather than guess.
    expect(created.state.kind === "blocked" && created.state.limitBytes).toBe(1024);
  });
});

describe("resuming", () => {
  it("becomes synchronized only from the server's verified final identity", async () => {
    const fileItemId = generateUuidV7();
    const verified: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "HEAD"
          ? response({ headers: { "upload-offset": "0" } })
          : response({
              status: 201,
              headers: { "upload-offset": "5", "upload-complete": "true" },
              body: { itemId: fileItemId, verified: true },
            }),
      ),
    );

    const state = await sendRemaining(
      { uploadId: fileItemId, location: `/v1/uploads/${fileItemId}` },
      fileOf(5),
      (progress) => {
        if (progress.kind === "synchronized") verified.push(progress.itemId);
      },
    );

    expect(state).toEqual({ kind: "synchronized", itemId: fileItemId });
    expect(verified).toEqual([fileItemId]);
  });

  it("recognizes a committed file when the final upload response was lost", async () => {
    const fileItemId = generateUuidV7();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "HEAD") return response({ status: 404 });
        expect(url).toBe(`/v1/items/${fileItemId}`);
        return response({ body: { id: fileItemId, kind: "file" } });
      }),
    );

    const state = await sendRemaining(
      { uploadId: fileItemId, location: `/v1/uploads/${fileItemId}` },
      fileOf(5),
      () => {},
    );
    expect(state).toEqual({ kind: "synchronized", itemId: fileItemId });
  });

  it("finalizes a zero-byte file instead of leaving it in verification forever", async () => {
    const fileItemId = generateUuidV7();
    const methods: Array<string | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        methods.push(init?.method);
        return init?.method === "HEAD"
          ? response({ headers: { "upload-offset": "0" } })
          : response({ status: 201, body: { itemId: fileItemId, verified: true } });
      }),
    );

    const state = await sendRemaining(
      { uploadId: fileItemId, location: `/v1/uploads/${fileItemId}` },
      fileOf(0),
      () => {},
    );
    expect(state).toEqual({ kind: "synchronized", itemId: fileItemId });
    expect(methods).toEqual(["HEAD", "PATCH"]);
  });

  it("seeks to the offset the server reports rather than to zero", async () => {
    const offsets: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "HEAD") {
          return response({ headers: { "upload-offset": "40" } });
        }
        offsets.push((init.headers as Record<string, string>)["upload-offset"] ?? "");
        return response({ status: 204, headers: { "upload-offset": "60" } });
      }),
    );

    await sendRemaining(handle, fileOf(60), () => {});
    // Started at 40, not at 0: the whole point of asking.
    expect(offsets[0]).toBe("40");
  });

  it("takes the server's offset when the server disagrees", async () => {
    const offsets: string[] = [];
    let patches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "HEAD") {
          return response({ headers: { "upload-offset": "0" } });
        }
        patches += 1;
        offsets.push((init.headers as Record<string, string>)["upload-offset"] ?? "");
        // The first attempt is refused with a correction; the second must use it.
        return patches === 1
          ? response({ status: 409, headers: { "upload-offset": "25" } })
          : response({ status: 204, headers: { "upload-offset": "50" } });
      }),
    );

    await sendRemaining(handle, fileOf(50), () => {});
    expect(offsets).toEqual(["0", "25"]);
  });

  it("stops when a successful response omits or repeats its offset", async () => {
    for (const headers of [{}, { "upload-offset": "0" }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) =>
          init.method === "HEAD"
            ? response({ headers: { "upload-offset": "0" } })
            : response({ status: 204, headers }),
        ),
      );

      const state = await sendRemaining(handle, fileOf(10), () => {});
      expect(state.kind).toBe("blocked");
    }
  });

  it("stops when a correction claims more bytes than the local file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "HEAD"
          ? response({ headers: { "upload-offset": "0" } })
          : response({ status: 409, headers: { "upload-offset": "11" } }),
      ),
    );

    const state = await sendRemaining(handle, fileOf(10), () => {});
    expect(state.kind).toBe("blocked");
  });

  it("stops when a rejected chunk repeats the attempted offset", async () => {
    let patches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "HEAD") return response({ headers: { "upload-offset": "0" } });
        patches += 1;
        return response({ status: 409, headers: { "upload-offset": "0" } });
      }),
    );

    const state = await sendRemaining(handle, fileOf(10), () => {});
    expect(state.kind).toBe("blocked");
    expect(patches).toBe(1);
  });

  it("bounds oscillating offset corrections instead of retrying forever", async () => {
    let patches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "HEAD") return response({ headers: { "upload-offset": "0" } });
        patches += 1;
        return response({
          status: 409,
          headers: { "upload-offset": patches % 2 === 1 ? "5" : "0" },
        });
      }),
    );

    const state = await sendRemaining(handle, fileOf(10), () => {});
    expect(state.kind).toBe("blocked");
    expect(patches).toBe(9);
  });

  it("trusts the offset in the response over its own arithmetic", async () => {
    const offsets: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "HEAD") {
          return response({ headers: { "upload-offset": "0" } });
        }
        offsets.push((init.headers as Record<string, string>)["upload-offset"] ?? "");
        // The server says it stored less than was sent. Adding the chunk size
        // would skip bytes; the response is authoritative.
        return offsets.length === 1
          ? response({ status: 204, headers: { "upload-offset": "10" } })
          : response({ status: 204, headers: { "upload-offset": "30" } });
      }),
    );

    await sendRemaining(handle, fileOf(30), () => {});
    expect(offsets).toEqual(["0", "10"]);
  });

  it("says a vanished upload must be started again rather than retrying forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ status: 404 })),
    );
    const state = await sendRemaining(handle, fileOf(10), () => {});
    expect(state.kind).toBe("blocked");
    expect(state.kind === "blocked" && state.reason).toMatch(/again/i);
  });

  it("reports progress as it goes", async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "HEAD"
          ? response({ headers: { "upload-offset": "0" } })
          : response({ status: 204, headers: { "upload-offset": "20" } }),
      ),
    );

    await sendRemaining(handle, fileOf(20), (state) => {
      if (state.kind === "uploading") {
        seen.push(state.sent);
      }
    });
    expect(seen[0]).toBe(0);
  });

  it("ends in verifying rather than claiming the file is synchronized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "HEAD"
          ? response({ headers: { "upload-offset": "0" } })
          : response({ status: 204, headers: { "upload-offset": "5" } }),
      ),
    );

    const state = await sendRemaining(handle, fileOf(5), () => {});
    // The client does not decide that a file is stored: only the server's
    // verification does, which is what FR-007 requires.
    expect(state.kind).toBe("verifying");
  });
});
