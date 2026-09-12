import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentApi } from "../src/services/content-api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContentApi response lifecycle", () => {
  it("turns a 2xx body-read rejection into an offline result without replaying the request", async () => {
    const response = new Response(JSON.stringify({ nextCursor: "79", changes: [] }), {
      status: 200,
    });
    vi.spyOn(response, "json").mockRejectedValueOnce(new TypeError("document unloaded"));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ContentApi("https://workspace.test").listChanges("78")).resolves.toEqual({
      ok: false,
      problem: {
        type: "https://myownnotion.dev/problems/network",
        title: "Server unreachable",
        status: 503,
        code: "network.unreachable",
      },
      offline: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats an AbortError during body consumption as an offline result", async () => {
    const response = new Response(JSON.stringify({ nextCursor: "79", changes: [] }), {
      status: 200,
    });
    vi.spyOn(response, "json").mockRejectedValueOnce(
      new DOMException("document unloaded", "AbortError"),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ContentApi("https://workspace.test").listChanges("78")).resolves.toMatchObject(
      {
        ok: false,
        offline: true,
      },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not disguise malformed successful JSON as an offline response", async () => {
    const response = new Response("not-json", { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ContentApi("https://workspace.test").listChanges("78")).rejects.toThrow(
      SyntaxError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
