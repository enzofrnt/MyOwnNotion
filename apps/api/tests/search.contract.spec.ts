import {
  ProblemSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  SearchUnavailableProblemSchema,
} from "@myownnotion/contracts";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../src/plugins/errors.ts";
import { registerSearchRoutes } from "../src/routes/search.ts";
import type { SearchService } from "../src/search/search-service.ts";
import { SearchRequestError, SearchUnavailableError } from "../src/search/search-service.ts";
import { attachRequestContext, createRequestContext } from "../src/security/request-context.ts";

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function createApp(input: { owner: boolean; search: SearchService["search"] }) {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.addHook("onRequest", async (request) => {
    attachRequestContext(
      request,
      createRequestContext({
        principal: input.owner
          ? {
              kind: "owner",
              ownerId: "owner",
              sessionId: "session",
              deviceId: "device",
              recentAuthAt: new Date(),
            }
          : { kind: "anonymous" },
      }),
    );
  });
  registerErrorHandling(app);
  registerSearchRoutes(app, {
    service: { search: input.search } as SearchService,
  });
  return app;
}

describe("POST /v1/search", () => {
  it("accepts a private JSON body and returns the complete typed page", async () => {
    const search = vi.fn<SearchService["search"]>().mockResolvedValue({
      coverage: "complete",
      generation: 1,
      results: [],
      nextCursor: null,
    });
    const app = createApp({ owner: true, search });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: { query: "architecture", kinds: ["page"], limit: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      coverage: "complete",
      generation: 1,
      results: [],
      nextCursor: null,
    });
    expect(search).toHaveBeenCalledWith({ query: "architecture", kinds: ["page"], limit: 20 });
  });

  it("passes type, branch and opaque-cursor filters only through the JSON body", async () => {
    const search = vi.fn<SearchService["search"]>().mockResolvedValue({
      coverage: "complete",
      generation: 2,
      results: [],
      nextCursor: null,
    });
    const app = createApp({ owner: true, search });
    const branchRootItemId = "018f0000-0000-7000-8000-000000000901";
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: {
        query: "architecture",
        kinds: ["folder", "page"],
        branchRootItemId,
        limit: 10,
        cursor: "opaque-page-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith({
      query: "architecture",
      kinds: ["folder", "page"],
      branchRootItemId,
      limit: 10,
      cursor: "opaque-page-token",
    });
  });

  it("rejects invalid filter shapes before invoking the service", async () => {
    const search = vi.fn<SearchService["search"]>();
    const app = createApp({ owner: true, search });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/search",
        payload: { query: "architecture", kinds: ["page", "page"] },
      }),
      app.inject({
        method: "POST",
        url: "/v1/search",
        payload: { query: "architecture", branchRootItemId: "not-a-uuid" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/search",
        payload: { query: "architecture", limit: 51 },
      }),
    ]);

    expect(responses.map(({ statusCode }) => statusCode)).toEqual([400, 400, 400]);
    expect(search).not.toHaveBeenCalled();
  });

  it("returns a redacted 409 when a cursor belongs to another query or generation", async () => {
    const search = vi
      .fn<SearchService["search"]>()
      .mockRejectedValue(new SearchRequestError("search.cursor-stale", 409));
    const app = createApp({ owner: true, search });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: { query: "sentinel-private-query", cursor: "sentinel-private-cursor" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, code: "search.cursor-stale" });
    expect(response.body).not.toContain("sentinel-private-query");
    expect(response.body).not.toContain("sentinel-private-cursor");
  });

  it("refuses an anonymous caller without invoking the search service", async () => {
    const search = vi.fn<SearchService["search"]>();
    const app = createApp({ owner: false, search });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: { query: "sentinel-private-query" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ status: 401, code: "authentication_required" });
    expect(response.body).not.toContain("sentinel-private-query");
    expect(search).not.toHaveBeenCalled();
  });

  it("returns a redacted 503 while the complete index is unavailable", async () => {
    const search = vi
      .fn<SearchService["search"]>()
      .mockRejectedValue(new SearchUnavailableError("degraded", 3, 7));
    const app = createApp({ owner: true, search });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: { query: "sentinel-private-query" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 503,
      code: "search.degraded",
      searchState: "degraded",
      indexedCount: 3,
      expectedCount: 7,
    });
    expect(response.body).not.toContain("sentinel-private-query");
  });

  it("rejects overlong input before the service and exposes no GET query route", async () => {
    const search = vi.fn<SearchService["search"]>();
    const app = createApp({ owner: true, search });
    const overlong = "s".repeat(513);
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      payload: { query: overlong },
    });
    const get = await app.inject({ method: "GET", url: "/v1/search?query=secret" });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(overlong);
    expect(get.statusCode).toBe(404);
    expect(search).not.toHaveBeenCalled();
  });

  it("registers the executable request, response and problem schemas", () => {
    expect(SearchRequestSchema.required).toContain("query");
    expect(SearchResponseSchema.required).toEqual([
      "coverage",
      "generation",
      "results",
      "nextCursor",
    ]);
    expect(ProblemSchema.required).toEqual(["type", "title", "status", "code"]);
    expect(SearchUnavailableProblemSchema).toHaveProperty("allOf");
  });
});
