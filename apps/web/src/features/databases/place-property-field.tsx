import type { DatabaseProperty, PlacePropertyValue } from "@myownnotion/domain";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  newPlaceSession,
  PLACE_FAILURE_MESSAGES,
  PlaceSearchError,
  type PlaceSearchFailure,
  type PlaceSuggestion,
  resolvePlace,
  searchPlaces,
} from "../../services/places.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";

const SEARCH_DELAY_MS = 250;
const MIN_QUERY = 2;

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "results"; readonly places: readonly PlaceSuggestion[] }
  | { readonly kind: "error"; readonly reason: PlaceSearchFailure };

const GEOLOCATION_MESSAGES: Readonly<Record<number, string>> = {
  1: "Autorisation de localisation refusée. Vous pouvez rechercher une adresse à la place.",
  2: "Votre position est indisponible pour le moment.",
  3: "La localisation a pris trop de temps.",
};

function failureOf(error: unknown): PlaceSearchFailure {
  return error instanceof PlaceSearchError ? error.reason : "unavailable";
}

/**
 * Notion-style place picker: a search box, « Emplacement actuel », then the
 * suggestions. Only the latest intent can win: every keystroke, clearing the
 * box and unmounting cancel the request in flight, so an older answer can
 * never replace a newer search.
 */
export function PlacePropertyField({
  property,
  value,
  disabled = false,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly value: PlacePropertyValue | null;
  readonly disabled?: boolean;
  readonly onChange: (value: PlacePropertyValue | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [editing, setEditing] = useState(value === null);
  const session = useRef(newPlaceSession());
  const selection = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const listId = useId();
  const trimmed = query.trim();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current?.abort();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` repeats the same search.
  useEffect(() => {
    setActive(-1);
    if (trimmed.length < MIN_QUERY) {
      setSearch({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setSearch({ kind: "loading" });
    const timer = window.setTimeout(() => {
      searchPlaces(trimmed, { signal: controller.signal, sessionToken: session.current }).then(
        (places) => {
          if (!controller.signal.aborted) setSearch({ kind: "results", places });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setSearch({ kind: "error", reason: failureOf(error) });
        },
      );
    }, SEARCH_DELAY_MS);
    // Cancels both the pending timer and the request already sent.
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, attempt]);

  const finish = (place: PlacePropertyValue): void => {
    onChange(place);
    setEditing(false);
    setQuery("");
    setNotice(null);
    session.current = newPlaceSession();
  };

  const choose = (suggestion: PlaceSuggestion): void => {
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setResolving(suggestion.placeId);
    setNotice(null);
    resolvePlace(suggestion, { signal: controller.signal, sessionToken: session.current })
      .then(
        (place) => {
          if (controller.signal.aborted || !mounted.current) return;
          finish({
            kind: "place",
            placeId: place.placeId,
            name: place.name,
            address: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
          });
        },
        (error: unknown) => {
          if (controller.signal.aborted || !mounted.current) return;
          setNotice(`${PLACE_FAILURE_MESSAGES[failureOf(error)]} Le lieu n’a pas été enregistré.`);
        },
      )
      .finally(() => {
        if (mounted.current && selection.current === controller) setResolving(null);
      });
  };

  const requestCurrentPosition = (): void => {
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      setNotice("La localisation n’est pas disponible dans ce navigateur.");
      return;
    }
    setLocating(true);
    setNotice(null);
    // The browser asks for permission; the position is stored as is and is
    // not sent to any third-party service.
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mounted.current) return;
        setLocating(false);
        const latitude = Number(coords.latitude.toFixed(5));
        const longitude = Number(coords.longitude.toFixed(5));
        finish({
          kind: "place",
          placeId: `geo:${latitude},${longitude}`,
          name: "Position actuelle",
          address: `${latitude}, ${longitude}`,
          latitude,
          longitude,
        });
      },
      (error) => {
        if (!mounted.current) return;
        setLocating(false);
        setNotice(GEOLOCATION_MESSAGES[error.code] ?? "Votre position est indisponible.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const places = search.kind === "results" ? search.places : [];
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (places.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + places.length) % places.length);
    } else if (event.key === "Enter") {
      const target = places[active] ?? (places.length === 1 ? places[0] : undefined);
      if (target === undefined) return;
      event.preventDefault();
      choose(target);
    } else if (event.key === "Escape" && value !== null) {
      event.stopPropagation();
      setEditing(false);
      setQuery("");
    }
  };

  if (value !== null && !editing) {
    return (
      <div className="place-property-field">
        <div className="place-property-field__selected">
          <AppIcon name="mapPin" size="small" />
          <span className="place-property-field__labels">
            <strong>{value.name}</strong>
            {value.address === null ? null : <span>{value.address}</span>}
          </span>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            Changer
          </Button>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            aria-label={`Retirer le lieu de ${property.name}`}
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setEditing(true);
            }}
          >
            <AppIcon name="close" size="small" />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="place-property-field" data-busy={search.kind === "loading" || undefined}>
      <label className="place-property-field__search">
        <span className="sr-only">Rechercher un emplacement pour {property.name}</span>
        <AppIcon name="search" size="small" />
        <input
          type="text"
          role="combobox"
          aria-expanded={places.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active < 0 ? undefined : `${listId}-${active}`}
          value={query}
          disabled={disabled}
          placeholder="Rechercher un emplacement…"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <button
        type="button"
        className="place-property-field__current"
        disabled={disabled || locating}
        onClick={requestCurrentPosition}
      >
        <AppIcon name="mapPin" size="small" />
        <span>{locating ? "Localisation en cours…" : "Emplacement actuel"}</span>
      </button>
      {notice === null ? null : (
        <p className="database-field__error place-property-field__state" role="alert">
          {notice}
        </p>
      )}
      {search.kind === "loading" ? (
        <p className="muted place-property-field__state" role="status">
          Recherche…
        </p>
      ) : null}
      {search.kind === "error" ? (
        <div className="place-property-field__state place-property-field__failure" role="alert">
          <p className="database-field__error">{PLACE_FAILURE_MESSAGES[search.reason]}</p>
          {search.reason === "unconfigured" ? null : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Réessayer
            </Button>
          )}
        </div>
      ) : null}
      {search.kind === "results" && places.length === 0 ? (
        <p className="muted place-property-field__state" role="status">
          Aucun lieu trouvé pour « {trimmed} ».
        </p>
      ) : null}
      <div
        className="place-property-field__results"
        id={listId}
        role="listbox"
        aria-label="Lieux proposés"
        hidden={places.length === 0}
      >
        {places.map((place, index) => (
          <div
            key={place.placeId}
            id={`${listId}-${index}`}
            className="place-property-field__result"
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            aria-disabled={resolving !== null}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (resolving === null) choose(place);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && resolving === null) choose(place);
            }}
          >
            <span>
              <strong>{place.name}</strong>
              {place.address === null ? null : <span>{place.address}</span>}
            </span>
            {resolving === place.placeId ? <span className="muted">…</span> : null}
          </div>
        ))}
      </div>
      {search.kind === "idle" ? null : (
        <p className="muted place-property-field__source">
          Recherche transmise à Google Places ; les résultats peuvent être limités.
        </p>
      )}
      {value === null ? null : (
        <Button type="button" size="compact" variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      )}
    </div>
  );
}
