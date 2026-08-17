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
