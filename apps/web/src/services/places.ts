import { sessionCsrf } from "./session-csrf.ts";

export interface PlaceSuggestion {
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  /** Absent until the suggestion is resolved with `resolvePlace`. */
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface ResolvedPlace extends PlaceSuggestion {
  readonly latitude: number;
  readonly longitude: number;
}

/** @deprecated Use `ResolvedPlace`; kept for callers that only read coordinates. */
export type PlaceSearchResult = ResolvedPlace;

export type PlaceSearchFailure = "unconfigured" | "quota" | "denied" | "offline" | "unavailable";

export const PLACE_FAILURE_MESSAGES: Readonly<Record<PlaceSearchFailure, string>> = {
  unconfigured:
    "La recherche de lieux n’est pas configurée sur ce serveur (clé Google Places absente).",
  quota: "Le quota de recherche de lieux est atteint. Réessayez plus tard.",
  denied: "Google Places refuse la clé du serveur. Vérifiez ses restrictions.",
  offline: "Hors ligne : la recherche de lieux nécessite une connexion.",
  unavailable: "Le service de lieux ne répond pas.",
};

export class PlaceSearchError extends Error {
  constructor(readonly reason: PlaceSearchFailure) {
    super(PLACE_FAILURE_MESSAGES[reason]);
    this.name = "PlaceSearchError";
  }
}

const FAILURE_BY_CODE: Readonly<Record<string, PlaceSearchFailure>> = {
  "places.unconfigured": "unconfigured",
  "places.quota": "quota",
  "places.denied": "denied",
};

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const csrf = sessionCsrf("");
  let response: Response;
  try {
    // The search text travels in the body so it never appears in a request line.
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(csrf === null ? {} : { "x-csrf-token": csrf }),
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new PlaceSearchError(
      typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unavailable",
    );
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof problem?.code === "string" ? problem.code : "";
    throw new PlaceSearchError(FAILURE_BY_CODE[code] ?? "unavailable");
  }
  return (await response.json()) as T;
}

/** Opaque token grouping the keystrokes of one search with its selection. */
export function newPlaceSession(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function searchPlaces(
  query: string,
  options: { readonly signal?: AbortSignal; readonly sessionToken?: string } = {},
): Promise<readonly PlaceSuggestion[]> {
  const payload = await post<{ places?: readonly PlaceSuggestion[] }>(
    "/v1/places/search",
    {
      q: query,
      limit: 10,
      ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
    },
    options.signal,
  );
  return payload.places ?? [];
}

/** Coordinates of a suggestion; one extra request only when they are missing. */
export async function resolvePlace(
  suggestion: PlaceSuggestion,
  options: { readonly signal?: AbortSignal; readonly sessionToken?: string } = {},
): Promise<ResolvedPlace> {
  if (suggestion.latitude !== undefined && suggestion.longitude !== undefined) {
    return suggestion as ResolvedPlace;
  }
  const payload = await post<{ place?: ResolvedPlace }>(
    "/v1/places/details",
    {
      placeId: suggestion.placeId,
      ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
    },
    options.signal,
  );
  if (payload.place === undefined) throw new PlaceSearchError("unavailable");
  // Keep the label the owner picked; Google's details may word it differently.
  return { ...payload.place, name: suggestion.name };
}

let browserKeyPromise: Promise<string | null> | null = null;

/**
 * The browser key of the map. A missing key is a stable answer and is cached;
 * a failed request is not, so reopening the map after an outage tries again.
 */
export function loadMapsBrowserKey(): Promise<string | null> {
  if (browserKeyPromise !== null) return browserKeyPromise;
  const attempt = fetch("/v1/maps/config", { credentials: "same-origin" }).then(
    async (response) => {
      if (!response.ok) throw new Error("maps config unavailable");
      const payload = (await response.json()) as { browserKey?: unknown };
      return typeof payload.browserKey === "string" && payload.browserKey !== ""
        ? payload.browserKey
        : null;
    },
  );
  browserKeyPromise = attempt;
  attempt.catch(() => {
    if (browserKeyPromise === attempt) browserKeyPromise = null;
  });
  return attempt;
}
