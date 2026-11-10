import type { DatabaseProperty, PlacePropertyValue } from "@myownnotion/domain";
import { useEffect, useRef, useState } from "react";
import { type PlaceSearchResult, searchPlaces } from "../../services/places.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";

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
  const [results, setResults] = useState<readonly PlaceSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(value === null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const timer = window.setTimeout(() => {
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setBusy(true);
      setError(null);
      void searchPlaces(trimmed, next.signal)
        .then((places) => {
          if (!next.signal.aborted) setResults(places);
        })
        .catch((cause) => {
          if (!next.signal.aborted) {
            setResults([]);
            setError(cause instanceof Error ? cause.message : "Recherche indisponible.");
          }
        })
        .finally(() => {
          if (!next.signal.aborted) setBusy(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);
  const choose = (result: PlaceSearchResult): void => {
    onChange({
      kind: "place",
      placeId: result.placeId,
      name: result.name,
      address: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
    });
    setEditing(false);
    setQuery("");
    setResults([]);
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
    <div className="place-property-field">
      <label className="place-property-field__search">
        <span className="sr-only">Rechercher un lieu</span>
        <AppIcon name="search" size="small" />
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Rechercher un lieu…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {busy ? <p className="muted">Recherche…</p> : null}
      {error === null ? null : <p className="database-field__error">{error}</p>}
      {query.trim().length >= 2 && !busy && error === null && results.length === 0 ? (
        <p className="muted">Aucun lieu trouvé.</p>
      ) : null}
      {results.length === 0 ? null : (
        <ul className="place-property-field__results">
          {results.map((result) => (
            <li key={result.placeId}>
              <button type="button" onClick={() => choose(result)}>
                <AppIcon name="mapPin" size="small" />
                <span>
                  <strong>{result.name}</strong>
                  {result.address === null ? null : <span>{result.address}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value === null ? null : (
        <Button type="button" size="compact" variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      )}
    </div>
  );
}
