import { afterEach, expect, it, vi } from "vitest";
import { SecurityApi } from "../src/services/security-api.ts";

afterEach(() => vi.unstubAllGlobals());
it("sends same-origin owner credentials and memory CSRF only for grant and revoke", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "csrf-proof" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ connection: {}, exchangeCode: "code" })))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const api = new SecurityApi("https://notes.example");
  await api.currentSession();
  await api.listMcpConnections();
  const grant = {
    label: "Assistant",
    scope: { actions: ["read" as const], allContent: true, branchRootIds: [], files: false },
    lifetimeDays: 90,
  };
  await api.grantMcpConnection(grant);
  expect((await api.revokeMcpConnection("connection-id")).ok).toBe(true);
  const read = fetchMock.mock.calls[1]?.[1];
  const write = fetchMock.mock.calls[2]?.[1];
  const revoke = fetchMock.mock.calls[3]?.[1];
  expect(read?.credentials).toBe("same-origin");
  expect(new Headers(read?.headers).has("x-csrf-token")).toBe(false);
  expect(new Headers(write?.headers).get("x-csrf-token")).toBe("csrf-proof");
  expect(write?.body).toBe(JSON.stringify(grant));
  expect(new Headers(revoke?.headers).get("x-csrf-token")).toBe("csrf-proof");
  expect(fetchMock.mock.calls[3]?.[0]).toBe(
    "https://notes.example/v1/mcp/connections/connection-id/revoke",
  );
});
it("returns network failure rather than queuing authorization", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetchMock);
  const api = new SecurityApi("");
  const result = await api.revokeMcpConnection("c1");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.problem.code).toBe("service_unavailable");
  expect(fetchMock).toHaveBeenCalledOnce();
});
