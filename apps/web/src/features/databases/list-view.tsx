import type { DatabaseProperty, DatabaseView, Uuid } from "@myownnotion/domain";
import { useLayoutEffect, useRef } from "react";
import type { DatabaseViewPage } from "../../services/databases.ts";
import { displayDatabaseValue } from "./database-value.ts";

export function ListView({
  properties,
  view,
  page,
  onOpenEntry,
  scrollTop = 0,
  onScroll,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const scrollRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element !== null && Math.abs(element.scrollTop - scrollTop) >= 1) {
      element.scrollTop = scrollTop;
    }
  }, [scrollTop]);
  const configured =
    view.type === "list"
      ? view.options.secondaryPropertyIds
      : view.properties.filter(({ visible }) => visible).map(({ propertyId }) => propertyId);
  const secondary = configured.flatMap((propertyId) => {
    const property = properties.find(
      (candidate) => candidate.id === propertyId && candidate.state === "active",
    );
    return property === undefined || property.type === "title" ? [] : [property];
  });
  return (
    <section
      ref={scrollRef}
      className="database-view database-list-scroll"
      aria-label={`${view.name} list view`}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
    >
      {page.rows.length === 0 ? (
        <p className="empty-state">
          {page.coverage === "partial"
            ? "No entries in the data available on this device."
            : "No entries in this view."}
        </p>
      ) : (
        <ul
          className={`database-list database-list--${view.type === "list" ? view.options.density : "comfortable"}`}
        >
          {page.rows.map((row) => (
            <li key={row.entryId} className="database-list__entry">
              <button
                type="button"
                className="link database-list__title"
                data-entry-trigger={row.entryId}
                onClick={(event) => onOpenEntry(row.entryId as Uuid, event.currentTarget)}
              >
                {row.title}
              </button>
              {secondary.length === 0 ? null : (
                <dl>
                  {secondary.map((property) => (
                    <div key={property.id}>
                      <dt>{property.name}</dt>
                      <dd>{displayDatabaseValue(row, property)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {row.syncState === "synced" ? null : (
                <span className={`database-sync database-sync--${row.syncState}`}>
                  {row.syncState === "pending" ? "Saved locally" : "Conflict"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
