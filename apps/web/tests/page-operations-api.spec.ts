import {
  type ActivePageSyncRequestDto,
  CSRF_TOKEN_HEADER,
  PAGE_OPERATION_PROTOCOL_VERSION,
} from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageOperationsApi } from "../src/services/page-operations-api.ts";

const digest = "a".repeat(64);

function request(): ActivePageSyncRequestDto {
  return {
    mode: "active",
    requestId: generateUuidV7(),
    operationalVersion: 1,
    persistedVersionVector: "",
    knownServerPageSequence: 0,
    updates: [],
    maxRemoteBytes: 1024,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PageOperationsApi", () => {
  it("sends protocol, session cookie and CSRF token on the same-origin sync route", async () => {
    const pageId = generateUuidV7();
    const body = request();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "active",
          requestId: body.requestId,
          pageId,
          accepted: [],
          repeated: [],
          remoteUpdates: [],
          serverVersionVector: "",
          throughPageSequence: 0,
          latestPageSequence: 0,
          hasMore: false,
          canonical: {
            format: "myownnotion.document+json",
            formatVersion: 3,
            digest,
            lastConsolidatedRevisionId: null,
            hasUnconsolidatedChanges: false,
          },
          ambiguities: [],
          fileRequirements: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = new PageOperationsApi({
      baseUrl: "https://workspace.test/",
      csrfToken: () => "csrf-secret",
    });

    await expect(api.sync(pageId, body)).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://workspace.test/v1/page-operations/${pageId}/sync`);
    expect(init?.credentials).toBe("same-origin");
    const headers = new Headers(init?.headers);
    expect(headers.get(CSRF_TOKEN_HEADER)).toBe("csrf-secret");
    expect(headers.get("x-myownnotion-client-protocol")).toBe(
      String(PAGE_OPERATION_PROTOCOL_VERSION),
    );
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });

  it("does not issue a write when this tab has no CSRF token", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const api = new PageOperationsApi({ csrfToken: () => null });

    await expect(api.sync(generateUuidV7(), request())).resolves.toEqual({
      ok: false,
      offline: false,
      problem: {
        code: "csrf_validation_failed",
        message: "The authenticated session must be refreshed before synchronization.",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns network failures and stable server problems into retry-safe transport results", async () => {
    const pageId = generateUuidV7();
    const body = request();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "page-operations.protocol-read-only",
            message: "Update this client.",
            requiredProtocol: 3,
            readAllowed: true,
          }),
          { status: 426, headers: { "content-type": "application/problem+json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const api = new PageOperationsApi({ csrfToken: () => "csrf-secret" });

    await expect(api.sync(pageId, body)).resolves.toMatchObject({
      ok: false,
      offline: true,
      problem: { code: "network.unreachable" },
    });
    await expect(api.sync(pageId, body)).resolves.toEqual({
      ok: false,
      offline: false,
      problem: {
        code: "page-operations.protocol-read-only",
        message: "Update this client.",
      },
    });
  });
});
