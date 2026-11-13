import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPlaceRoutes } from "../src/routes/places.ts";

describe("place routes during the GET to POST transition", () => {
  const previous = process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"];
  beforeEach(() => {
    delete process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"];
  });
  afterEach(() => {
    if (previous === undefined) delete process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"];
    else process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"] = previous;
  });

  it("answers an older client's GET ?q= exactly like the POST route", async () => {
    const app = Fastify();
    registerPlaceRoutes(app);
    const legacy = await app.inject({ method: "GET", url: "/v1/places/search?q=louvre&limit=6" });
    const current = await app.inject({
      method: "POST",
      url: "/v1/places/search",
      payload: { q: "louvre" },
    });
    expect(legacy.statusCode).toBe(503);
    expect(legacy.json()).toMatchObject({ code: "places.unconfigured" });
    expect(current.statusCode).toBe(legacy.statusCode);
    expect(current.json()).toEqual(legacy.json());
    await app.close();
  });

  it("still rejects a search that is too short on both routes", async () => {
    const app = Fastify();
    registerPlaceRoutes(app);
    expect((await app.inject({ method: "GET", url: "/v1/places/search?q=a" })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: "POST", url: "/v1/places/search", payload: { q: "a" } }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });
});
