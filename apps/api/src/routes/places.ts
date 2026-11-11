/**
 * Place search and the browser Maps configuration.
 *
 * The server key never leaves the API process. The browser key is public by
 * design and is returned only to an authenticated owner so the map view can
 * load the Maps JavaScript API.
 *
 * Searches travel in a request body, never in the URL: an intermediary that
 * records request lines must not learn what the owner looked for.
 */

import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply } from "fastify";
import { createGooglePlaces, PlacesError, type PlacesFailure } from "../places/google-places.ts";

const SearchBodySchema = Type.Object(
  {
    q: Type.String({ minLength: 2, maxLength: 200 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    sessionToken: Type.Optional(
      Type.String({ minLength: 8, maxLength: 36, pattern: "^[A-Za-z0-9_-]+$" }),
    ),
  },
  { additionalProperties: false },
);

const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 2, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
});

const DetailsBodySchema = Type.Object(
  {
    placeId: Type.String({ minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" }),
    sessionToken: Type.Optional(
      Type.String({ minLength: 8, maxLength: 36, pattern: "^[A-Za-z0-9_-]+$" }),
    ),
  },
  { additionalProperties: false },
);

const FAILURES: Readonly<Record<PlacesFailure, { status: number; code: string; title: string }>> = {
  quota: { status: 429, code: "places.quota", title: "Google Places quota is exhausted" },
  denied: { status: 502, code: "places.denied", title: "Google Places refused the server key" },
  unavailable: { status: 502, code: "places.unavailable", title: "Google Places is unavailable" },
};

function problem(reply: FastifyReply, status: number, code: string, title: string) {
  return reply.code(status).send({
    type: `https://myownnotion.dev/problems/${code}`,
    title,
    status,
    code,
  });
}

function fail(reply: FastifyReply, error: unknown) {
  const failure = FAILURES[error instanceof PlacesError ? error.reason : "unavailable"];
  return problem(reply, failure.status, failure.code, failure.title);
}

/** First language of the request, limited to a plain language tag. */
function languageOf(header: string | undefined): string {
  const tag = header?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/u.test(tag) ? tag : "fr";
}

export function registerPlaceRoutes(app: FastifyInstance): void {
  const places = () => {
    const key = process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"]?.trim() ?? "";
    return key === "" ? null : createGooglePlaces(key);
  };
  const unconfigured = (reply: FastifyReply) =>
    problem(reply, 503, "places.unconfigured", "Google Places is not configured");

  app.get("/v1/maps/config", async () => {
    const browserKey = process.env["MYOWNNOTION_GOOGLE_MAPS_BROWSER_KEY"]?.trim() ?? "";
    return browserKey === "" ? { browserKey: null } : { browserKey };
  });

  async function runSearch(
    reply: FastifyReply,
    acceptLanguage: string | undefined,
    input: { q: string; limit?: number; sessionToken?: string },
  ) {
    const provider = places();
    if (provider === null) return unconfigured(reply);
    try {
      return {
        places: await provider.search({
          query: input.q.trim(),
          limit: input.limit ?? 10,
          language: languageOf(acceptLanguage),
          sessionToken: input.sessionToken,
        }),
      };
    } catch (error) {
      return fail(reply, error);
    }
  }

  app.post("/v1/places/search", { schema: { body: SearchBodySchema } }, async (request, reply) =>
    runSearch(
      reply,
      request.headers["accept-language"],
      request.body as { q: string; limit?: number; sessionToken?: string },
    ),
  );

  /**
   * Transitional alias for web clients built before searches moved to the
   * request body (they send `?q=`). It answers like the POST route and can be
   * removed once no such client remains. The logger drops query strings, so
   * the search text still never reaches the server logs.
   */
  app.get(
    "/v1/places/search",
    { schema: { querystring: SearchQuerySchema } },
    async (request, reply) =>
      runSearch(
        reply,
        request.headers["accept-language"],
        request.query as { q: string; limit?: number },
      ),
  );

  app.post(
    "/v1/places/details",
    { schema: { body: DetailsBodySchema } },
    async (request, reply) => {
      const provider = places();
      if (provider === null) return unconfigured(reply);
      const body = request.body as { placeId: string; sessionToken?: string };
      try {
        const place = await provider.details(
          body.placeId,
          languageOf(request.headers["accept-language"]),
          body.sessionToken,
        );
        return place === null
          ? problem(reply, 404, "places.not-found", "This place has no usable location")
          : { place };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
