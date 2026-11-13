import type { DatabaseProperty, DatabaseView, PlacePropertyValue, Uuid } from "@myownnotion/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DatabaseViewPage } from "../../services/databases.ts";
import { loadMapsBrowserKey } from "../../services/places.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import { useTheme } from "../../ui/theme-provider.tsx";

type MapViewDefinition = Extract<DatabaseView, { type: "map" }>;

interface GoogleMap {
  fitBounds(bounds: GoogleBounds): void;
  setCenter(point: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
}
interface GoogleBounds {
  extend(point: { lat: number; lng: number }): void;
}
interface GoogleMarker {
  setMap(map: GoogleMap | null): void;
  addListener(event: "click", handler: () => void): void;
}
interface GoogleMapsApi {
  importLibrary?: (name: "maps") => Promise<unknown>;
  Map: new (
    element: HTMLElement,
    options: {
      center: { lat: number; lng: number };
      zoom: number;
      mapTypeControl: boolean;
      streetViewControl: boolean;
      fullscreenControl: boolean;
      styles?: readonly unknown[];
    },
  ) => GoogleMap;
  Marker: new (options: {
    position: { lat: number; lng: number };
    map: GoogleMap;
    title: string;
  }) => GoogleMarker;
  LatLngBounds: new () => GoogleBounds;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsApi };
  }
}

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
] as const;

let mapsLoader: Promise<GoogleMapsApi | null> | null = null;

function loadGoogleMaps(key: string): Promise<GoogleMapsApi | null> {
  if (window.google?.maps !== undefined) return Promise.resolve(window.google.maps);
  mapsLoader ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.async = true;
    script.onload = () => {
      let settled = false;
      const finish = (maps: GoogleMapsApi | null): void => {
        if (settled) return;
        settled = true;
        resolve(maps);
      };
      const check = (): boolean => {
        const maps = window.google?.maps;
        if (maps === undefined) return false;
        if (typeof maps.importLibrary === "function") {
          void maps
            .importLibrary("maps")
            .then((library) =>
              finish(
                (window.google?.maps as GoogleMapsApi | undefined) ??
                  (library as unknown as GoogleMapsApi | null) ??
                  maps,
              ),
            )
            .catch(() => finish(maps));
          return true;
        }
        if (typeof maps.Map === "function") {
          finish(maps);
          return true;
        }
        return false;
      };
      if (check()) return;
      // With `loading=async`, onload fires before the namespace exposes Map or
      // importLibrary. Poll briefly instead of resolving a half-built loader.
      const timer = window.setInterval(() => {
        if (check()) window.clearInterval(timer);
      }, 50);
      window.setTimeout(() => {
        window.clearInterval(timer);
        finish(window.google?.maps ?? null);
      }, 8_000);
    };
    script.onerror = () => {
      script.remove();
      resolve(null);
    };
    document.head.append(script);
  });
  const attempt = mapsLoader;
  // A failed load is not remembered: « Réessayer » must really try again.
  void attempt.then((maps) => {
    if (maps === null && mapsLoader === attempt) mapsLoader = null;
  });
  return attempt;
}

/** Notion shows at most this many places on a map at once. */
const MAP_MARKER_LIMIT = 100;

type MapStatus = "loading" | "ready" | "unconfigured" | "config-error" | "script-error";

const MAP_STATUS_MESSAGES: Readonly<Record<Exclude<MapStatus, "loading" | "ready">, string>> = {
  unconfigured:
    "La carte n’est pas configurée sur ce serveur (clé Google Maps navigateur absente).",
  "config-error": "La configuration de la carte n’a pas pu être chargée.",
  "script-error": "La carte Google Maps n’a pas pu être chargée. Vérifiez la connexion.",
};

function placeValueOf(
  row: DatabaseViewPage["rows"][number],
  propertyId: Uuid,
): PlacePropertyValue | null {
  const value = row.values[propertyId];
  return value !== undefined && value.kind === "place" ? value : null;
}

export function MapView({
  properties,
  view,
  page,
  onOpenEntry,
  onChangeView,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: MapViewDefinition;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onChangeView: (view: MapViewDefinition) => void | Promise<void>;
}) {
  const placeProperties = properties.filter(
    (property): property is Extract<DatabaseProperty, { type: "place" }> =>
      property.state === "active" && property.type === "place",
  );
  const property =
    placeProperties.find(({ id }) => id === view.options.placePropertyId) ?? placeProperties[0];
  const [browserKey, setBrowserKey] = useState<string | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const { resolvedTheme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMap | null>(null);
  const markers = useRef<GoogleMarker[]>([]);
  const locatedRows = useMemo(
    () =>
      property === undefined
        ? []
        : page.rows.flatMap((row) => {
            const place = placeValueOf(row, property.id);
            return place === null ? [] : [{ row, place }];
          }),
    [page.rows, property],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the load on retry.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadMapsBrowserKey().then(
      (key) => {
        if (cancelled) return;
        setBrowserKey(key);
        if (key === null) setStatus("unconfigured");
      },
      () => {
        if (!cancelled) setStatus("config-error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` rebuilds the map on retry.
  useEffect(() => {
    if (browserKey === null || container.current === null || property === undefined) return;
    let cancelled = false;
    void loadGoogleMaps(browserKey).then((maps) => {
      if (cancelled || container.current === null) return;
      if (maps === null || typeof maps.Map !== "function") {
        setStatus("script-error");
        return;
      }
      const instance = new maps.Map(container.current, {
        center: { lat: 46.6, lng: 2.4 },
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        ...(resolvedTheme === "dark" ? { styles: DARK_MAP_STYLES } : {}),
      });
      map.current = instance;
      const bounds = new maps.LatLngBounds();
      const shown = locatedRows.slice(0, MAP_MARKER_LIMIT);
      for (const { row, place } of shown) {
        const position = { lat: place.latitude, lng: place.longitude };
        const marker = new maps.Marker({
          position,
          map: instance,
          title: `${row.title} — ${place.name}`,
        });
        marker.addListener("click", () => onOpenEntry(row.entryId as Uuid, null));
        markers.current.push(marker);
        bounds.extend(position);
      }
      const only = shown.length === 1 ? shown[0] : undefined;
      if (only !== undefined) {
        // Fitting a single point would zoom to the building: keep the street in view.
        instance.setCenter({ lat: only.place.latitude, lng: only.place.longitude });
        instance.setZoom(14);
      } else if (shown.length > 1) {
        instance.fitBounds(bounds);
      }
      setStatus("ready");
    });
    return () => {
      cancelled = true;
      for (const marker of markers.current) marker.setMap(null);
      markers.current = [];
      map.current = null;
    };
  }, [browserKey, property, locatedRows, onOpenEntry, resolvedTheme, attempt]);

  if (property === undefined) {
    return (
      <section className="database-view" aria-label="Carte">
        <div className="database-map__empty">
          <AppIcon name="mapPin" size="medium" />
          <p>Ajoutez une propriété Lieu pour afficher cette vue.</p>
        </div>
      </section>
    );
  }
  const located = locatedRows.length;
  const failed = status !== "loading" && status !== "ready";
  return (
    <section className="database-view database-map" aria-label={property.name}>
      <div className="database-map__toolbar">
        <label>
          <span>Lieu</span>
          <select
            value={property.id}
            onChange={(event) =>
              void onChangeView({
                ...view,
                options: { placePropertyId: event.currentTarget.value as Uuid },
              })
            }
          >
            {placeProperties.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {located} page{located === 1 ? "" : "s"} localisée{located === 1 ? "" : "s"}
        </span>
      </div>
      {status === "loading" ? (
        <p className="database-map__state" role="status">
          Chargement de la carte…
        </p>
      ) : null}
      {failed ? (
        <div className="database-map__state database-map__failure" role="alert">
          <p className="database-field__error">{MAP_STATUS_MESSAGES[status]}</p>
          {status === "unconfigured" ? null : (
            <Button type="button" size="compact" onClick={() => setAttempt((value) => value + 1)}>
              Réessayer
            </Button>
          )}
        </div>
      ) : null}
      {located > MAP_MARKER_LIMIT && !failed ? (
        <p className="database-map__state muted">
          La carte affiche {MAP_MARKER_LIMIT} lieux à la fois. Filtrez la vue pour voir les autres.
        </p>
      ) : null}
      <div
        ref={container}
        className="database-map__canvas"
        data-testid="database-map"
        hidden={failed}
      />
      {failed && located > 0 ? (
        // The places are stored locally: they stay readable without the map.
        <ul className="database-map__list" aria-label="Lieux de cette vue">
          {locatedRows.map(({ row, place }) => (
            <li key={row.entryId}>
              <button
                type="button"
                onClick={(event) => onOpenEntry(row.entryId as Uuid, event.currentTarget)}
              >
                <AppIcon name="mapPin" size="small" />
                <span>
                  <strong>{row.title === "" ? "Sans titre" : row.title}</strong>
                  <span>
                    {place.name}
                    {place.address === null ? "" : ` — ${place.address}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {located > 0 ? null : (
        <p className="database-map__state">Aucune page avec un lieu pour l’instant.</p>
      )}
    </section>
  );
}
