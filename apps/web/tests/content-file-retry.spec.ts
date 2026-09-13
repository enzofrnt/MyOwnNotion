import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentApi } from "../src/services/content-api.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function refused(code: string, status = 409): Response {
  return new Response(JSON.stringify({ code, status, title: "Write refused" }), { status });
}

describe.each(["import", "replace"] as const)("multipart %s publication", (operation) => {
  function upload(api: ContentApi, mutationId: ReturnType<typeof generateUuidV7>, file: File) {
    return operation === "import"
      ? api.importFile(mutationId, file, {
          kind: "hierarchy",
          parentItemId: null,
          positionKey: "V",
        })
      : api.replaceFileContent(mutationId, generateUuidV7(), generateUuidV7(), file);
  }

  it("retries only a rolled-back publication with fresh exact bytes and the same identity", async () => {
    vi.useFakeTimers();
    const mutationId = generateUuidV7();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused("file.concurrent-write"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mutationId, revisionIds: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["exact private bytes"], "kept.txt", { type: "text/plain" });
    const pending = upload(new ContentApi("https://files.test"), mutationId, file);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: true, value: { mutationId, revisionIds: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies: FormData[] = [];
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(fetchMock.mock.calls[0]?.[0]);
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(mutationId);
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      if (!(body instanceof FormData)) throw new Error("multipart body missing");
      bodies.push(body);
      const part = body.get("file") as File;
      expect(part.name).toBe("kept.txt");
      expect(await part.text()).toBe("exact private bytes");
    }
    expect(bodies[1]).not.toBe(bodies[0]);
    expect([...(bodies[1]?.keys() ?? [])]).toEqual([...(bodies[0]?.keys() ?? [])]);
    const metadata = operation === "import" ? "placement" : "baseRevisionId";
    expect(bodies[1]?.get(metadata)).toBe(bodies[0]?.get(metadata));
  });

  it("returns the conflict after three attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => refused("file.concurrent-write"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = upload(
      new ContentApi("https://files.test"),
      generateUuidV7(),
      new File(["bytes"], "kept.txt"),
    );
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      ok: false,
      offline: false,
      problem: { code: "file.concurrent-write" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["revision.stale-base", 409],
    ["mutation.conflict", 409],
    ["file.concurrent-write", 503],
    ["internal.unexpected", 500],
    ["http.401", 401],
  ] as const)("does not retry %s (%s)", async (code, status) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => refused(code, status));
    vi.stubGlobal("fetch", fetchMock);
    const result = await upload(
      new ContentApi("https://files.test"),
      generateUuidV7(),
      new File(["bytes"], "kept.txt"),
    );
    expect(result).toMatchObject({ ok: false, problem: { code, status } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not replay an uncertain network failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await upload(
        new ContentApi("https://files.test"),
        generateUuidV7(),
        new File(["bytes"], "kept.txt"),
      ),
    ).toMatchObject({ ok: false, offline: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
