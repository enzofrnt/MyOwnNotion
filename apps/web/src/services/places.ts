export interface PlaceSearchResult {
  readonly placeId: string;
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number;
  readonly longitude: number;
}

interface PlacesResponse {
  readonly places?: readonly PlaceSearchResult[];
}

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<readonly PlaceSearchResult[]> {
  const response = await fetch(`/v1/places/search?q=${encodeURIComponent(query)}&limit=6`, {
    credentials: "same-origin",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("La recherche de lieux est indisponible.");
  const payload = (await response.json()) as PlacesResponse;
  return payload.places ?? [];
}

let browserKeyPromise: Promise<string | null> | null = null;

export function loadMapsBrowserKey(): Promise<string | null> {
  browserKeyPromise ??= fetch("/v1/maps/config", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as { browserKey?: unknown };
      return typeof payload.browserKey === "string" && payload.browserKey !== ""
        ? payload.browserKey
        : null;
    })
    .catch(() => null);
  return browserKeyPromise;
}
