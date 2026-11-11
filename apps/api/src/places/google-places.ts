/**
 * Google Places (New) behind the API process.
 *
 * Suggestions combine two calls. Autocomplete ranks partial input the way a
 * person types it ("musée du lou"); Text Search understands a whole query and
 * already carries coordinates. A suggestion without coordinates is resolved
 * with Place Details when the owner picks it.
 *
 * Nothing here logs the query, the coordinates or the key.
 */

export interface PlaceSuggestion {
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  /** Absent for an autocomplete-only suggestion: resolve it before storing. */
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface ResolvedPlace {
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number;
  readonly longitude: number;
}

export type PlacesFailure = "quota" | "denied" | "unavailable";

export class PlacesError extends Error {
  constructor(readonly reason: PlacesFailure) {
    super(`Google Places ${reason}`);
    this.name = "PlacesError";
  }
}

export interface PlacesSearchInput {
  readonly query: string;
  readonly limit: number;
  readonly language: string;
  /** Groups the keystrokes of one search and its final selection. */
  readonly sessionToken?: string | undefined;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface GooglePlace {
  readonly id?: string;
  readonly displayName?: { readonly text?: string };
  readonly formattedAddress?: string;
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
}

interface GoogleAutocomplete {
  readonly suggestions?: readonly {
    readonly placePrediction?: {
      readonly placeId?: string;
      readonly text?: { readonly text?: string };
      readonly structuredFormat?: {
        readonly mainText?: { readonly text?: string };
        readonly secondaryText?: { readonly text?: string };
      };
    };
  }[];
}

const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 8_000;
const PLACE_FIELDS = "id,displayName,formattedAddress,location";

function failureOf(status: number): PlacesFailure {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "denied";
  return "unavailable";
}

async function call<T>(fetcher: Fetch, url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new PlacesError("unavailable");
  }
  if (!response.ok) throw new PlacesError(failureOf(response.status));
  try {
    return (await response.json()) as T;
  } catch {
    throw new PlacesError("unavailable");
  }
}

function resolved(place: GooglePlace): ResolvedPlace | null {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const name = place.displayName?.text;
  if (
    place.id === undefined ||
    name === undefined ||
    name.trim() === "" ||
    typeof latitude !== "number" ||
    typeof longitude !== "number"
  ) {
    return null;
  }
  return { placeId: place.id, name, address: place.formattedAddress ?? null, latitude, longitude };
}

export function createGooglePlaces(key: string, fetcher: Fetch = fetch) {
  const headers = (fieldMask?: string): Record<string, string> => ({
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key,
    ...(fieldMask === undefined ? {} : { "X-Goog-FieldMask": fieldMask }),
  });

  async function textSearch(input: PlacesSearchInput): Promise<readonly ResolvedPlace[]> {
    const payload = await call<{ readonly places?: readonly GooglePlace[] }>(
      fetcher,
      `${BASE}/places:searchText`,
      {
        method: "POST",
        headers: headers("places.id,places.displayName,places.formattedAddress,places.location"),
        body: JSON.stringify({
          textQuery: input.query,
          languageCode: input.language,
          maxResultCount: Math.min(input.limit, 20),
        }),
      },
    );
    return (payload.places ?? []).flatMap((place) => resolved(place) ?? []);
  }

  async function autocomplete(input: PlacesSearchInput): Promise<readonly PlaceSuggestion[]> {
    const payload = await call<GoogleAutocomplete>(fetcher, `${BASE}/places:autocomplete`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        input: input.query,
        languageCode: input.language,
        ...(input.sessionToken === undefined ? {} : { sessionToken: input.sessionToken }),
      }),
    });
    return (payload.suggestions ?? []).flatMap(({ placePrediction }) => {
      const placeId = placePrediction?.placeId;
      const name = placePrediction?.structuredFormat?.mainText?.text ?? placePrediction?.text?.text;
      if (placeId === undefined || name === undefined || name.trim() === "") return [];
      return [
        {
          placeId,
          name,
          address: placePrediction?.structuredFormat?.secondaryText?.text ?? null,
        },
      ];
    });
  }

  return {
    /** Ranked suggestions; fails only when neither Google call answered. */
    async search(input: PlacesSearchInput): Promise<readonly PlaceSuggestion[]> {
      const [predicted, found] = await Promise.allSettled([autocomplete(input), textSearch(input)]);
      if (predicted.status === "rejected" && found.status === "rejected") {
        // The more specific cause (quota, refusal) is the one worth reporting.
        const reasons = [predicted.reason, found.reason].filter(
          (reason): reason is PlacesError => reason instanceof PlacesError,
        );
        throw (
          reasons.find(({ reason }) => reason !== "unavailable") ??
          reasons[0] ??
          new PlacesError("unavailable")
        );
      }
      const located = new Map(
        (found.status === "fulfilled" ? found.value : []).map((place) => [place.placeId, place]),
      );
      const merged: PlaceSuggestion[] = [];
      const seen = new Set<string>();
      for (const suggestion of predicted.status === "fulfilled" ? predicted.value : []) {
        if (seen.has(suggestion.placeId)) continue;
        seen.add(suggestion.placeId);
        merged.push(located.get(suggestion.placeId) ?? suggestion);
      }
      for (const place of located.values()) {
        if (seen.has(place.placeId)) continue;
        seen.add(place.placeId);
        merged.push(place);
      }
      return merged.slice(0, input.limit);
    },

    async details(
      placeId: string,
      language: string,
      sessionToken?: string,
    ): Promise<ResolvedPlace | null> {
      const parameters = new URLSearchParams({ languageCode: language });
      if (sessionToken !== undefined) parameters.set("sessionToken", sessionToken);
      const place = await call<GooglePlace>(
        fetcher,
        `${BASE}/places/${encodeURIComponent(placeId)}?${parameters.toString()}`,
        { method: "GET", headers: headers(PLACE_FIELDS) },
      );
      return resolved(place);
    },
  };
}
