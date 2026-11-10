/**
 * Google Places (New) search and the browser Maps configuration.
 *
 * The server key never leaves the API process. The browser key is public by
 * design and is returned only to an authenticated owner so the map view can
 * load the Maps JavaScript API.
 */

import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

interface GooglePlace {
  readonly id?: string;
  readonly displayName?: { readonly text?: string };
  readonly formattedAddress?: string;
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
}

interface GooglePlacesResponse {
  readonly places?: readonly GooglePlace[];
  readonly error?: { readonly code?: number; readonly status?: string; readonly message?: string };
}

const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 2, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});

export function registerPlaceRoutes(app: FastifyInstance): void {
  app.get("/v1/maps/config", async () => {
    const browserKey = process.env["MYOWNNOTION_GOOGLE_MAPS_BROWSER_KEY"]?.trim() ?? "";
    return browserKey === "" ? { browserKey: null } : { browserKey };
  });

  app.get(
    "/v1/places/search",
    { schema: { querystring: SearchQuerySchema } },
    async (request, reply) => {
      const key = process.env["MYOWNNOTION_GOOGLE_MAPS_API_KEY"]?.trim() ?? "";
      if (key === "") {
        return reply.code(503).send({
          type: "https://myownnotion.dev/problems/places.unconfigured",
          title: "Google Places is not configured",
          status: 503,
          code: "places.unconfigured",
        });
      }
      const query = request.query as { q: string; limit?: number };
      let response: Response;
      try {
        response = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location",
          },
          body: JSON.stringify({
            textQuery: query.q,
            languageCode: "fr",
            maxResultCount: query.limit ?? 6,
          }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        return reply.code(502).send({
          type: "https://myownnotion.dev/problems/places.unavailable",
          title: "Google Places is unavailable",
          status: 502,
          code: "places.unavailable",
        });
      }
      if (!response.ok) {
        return reply.code(502).send({
          type: "https://myownnotion.dev/problems/places.unavailable",
          title: "Google Places rejected the search",
          status: 502,
          code: "places.unavailable",
        });
      }
      const payload = (await response.json()) as GooglePlacesResponse;
      const places = (payload.places ?? []).flatMap((place) => {
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        const name = place.displayName?.text;
        if (
          place.id === undefined ||
          name === undefined ||
          latitude === undefined ||
          longitude === undefined
        ) {
          return [];
        }
        return [
          {
            placeId: place.id,
            name,
            address: place.formattedAddress ?? null,
            latitude,
            longitude,
          },
        ];
      });
      return { places };
    },
  );
}
