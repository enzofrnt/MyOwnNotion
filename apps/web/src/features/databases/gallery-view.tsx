import type { DatabaseProperty, DatabaseView, Uuid } from "@myownnotion/domain";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { StableActionButton } from "../../ui/stable-action-button.tsx";
import { DATABASE_COPY } from "./database-copy.ts";
import { displayDatabaseValue } from "./database-value.ts";

type GalleryViewDefinition = Extract<DatabaseView, { type: "gallery" }>;

export type GalleryPreview =
  | { readonly kind: "page"; readonly text: string }
  | { readonly kind: "file"; readonly src: string; readonly alt: string };

export function galleryProperties(
  view: GalleryViewDefinition,
  properties: readonly DatabaseProperty[],
): readonly DatabaseProperty[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  return view.options.cardPropertyIds.flatMap((id) => {
    const property = byId.get(id);
    return property === undefined || property.state !== "active" || property.type === "title"
      ? []
      : [property];
  });
}

function safeImageSource(source: string): boolean {
  return source.startsWith("blob:") || /^data:image\/(?:png|jpeg|webp|gif);base64,/u.test(source);
}

export function safeGalleryPreview(
  mode: GalleryViewDefinition["options"]["preview"],
  preview: GalleryPreview | undefined,
): GalleryPreview | null {
  if (
    preview === undefined ||
    mode === "none" ||
    preview.kind !== mode.replace("first-safe-", "")
  ) {
    return null;
  }
  if (preview.kind === "file" && !safeImageSource(preview.src)) return null;
  return preview;
}

function GalleryCard({
  row,
  index,
  rowCount,
  selectedProperties,
  preview,
  previewMode,
  onOpenEntry,
  onFocusChange,
  dataIndex,
  measureElement,
  style,
}: {
  readonly row: DatabaseViewRow;
  readonly index: number;
  readonly rowCount: number;
  readonly selectedProperties: readonly DatabaseProperty[];
  readonly preview: GalleryPreview | null;
  readonly previewMode: GalleryViewDefinition["options"]["preview"];
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onFocusChange: (focused: boolean) => void;
  readonly dataIndex: number | undefined;
  readonly measureElement: ((element: Element | null) => void) | undefined;
  readonly style: CSSProperties | undefined;
}) {
  return (
    <li
      ref={measureElement}
      data-index={dataIndex}
      aria-posinset={index + 1}
      aria-setsize={rowCount}
      className={`database-gallery__card${style === undefined ? "" : " database-gallery__virtual-item"}`}
      style={style}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange(false);
      }}
    >
      <div className="database-gallery__preview">
        {previewMode === "none" ? (
          <span>{DATABASE_COPY.gallery.previewDisabled}</span>
        ) : preview?.kind === "page" ? (
          <p>{preview.text}</p>
        ) : preview?.kind === "file" ? (
          <img src={preview.src} alt={preview.alt} />
        ) : (
          <span>{DATABASE_COPY.gallery.noSafePreview}</span>
        )}
      </div>
      <StableActionButton
        type="button"
        className="link database-card__title"
        data-entry-trigger={row.entryId}
        onActivate={(trigger) => onOpenEntry(row.entryId as Uuid, trigger)}
      >
        {row.title}
      </StableActionButton>
      {selectedProperties.length === 0 ? null : (
        <dl>
          {selectedProperties.map((property) => (
            <div key={property.id}>
              <dt>{property.name}</dt>
              <dd>{displayDatabaseValue(row, property)}</dd>
            </div>
          ))}
        </dl>
      )}
      {row.syncState === "synced" ? null : (
        <span className={`database-sync database-sync--${row.syncState}`}>
          {row.syncState === "pending"
            ? DATABASE_COPY.common.savedLocally
            : DATABASE_COPY.common.conflict}
        </span>
      )}
    </li>
  );
}

function GalleryCards({
  page,
  selectedProperties,
  previews,
  previewMode,
  onOpenEntry,
  scrollTop,
  onScroll,
}: {
  readonly page: DatabaseViewPage;
  readonly selectedProperties: readonly DatabaseProperty[];
  readonly previews: ReadonlyMap<Uuid, GalleryPreview>;
  readonly previewMode: GalleryViewDefinition["options"]["preview"];
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly scrollTop: number;
  readonly onScroll: ((scrollTop: number) => void) | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState(1);
  const [focusedEntryId, setFocusedEntryId] = useState<Uuid | null>(null);
  const focusedIndex = page.rows.findIndex(({ entryId }) => entryId === focusedEntryId);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || page.rows.length <= 60 || typeof ResizeObserver === "undefined") {
      return;
    }
    const updateLanes = (): void => {
      setLanes(Math.max(1, Math.floor((element.clientWidth + 12) / 252)));
    };
    updateLanes();
    const observer = new ResizeObserver(updateLanes);
    observer.observe(element);
    return () => observer.disconnect();
  }, [page.rows.length]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element !== null && Math.abs(element.scrollTop - scrollTop) >= 1) {
      element.scrollTop = scrollTop;
    }
  }, [scrollTop]);
  const virtualizer = useVirtualizer({
    count: page.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 330,
    getItemKey: (index) => page.rows[index]?.entryId ?? index,
    lanes,
    overscan: lanes * 2,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
      return indexes.sort((left, right) => left - right);
    },
  });
  const virtualRows = virtualizer.getVirtualItems();
  const virtualized = page.rows.length > 60 && virtualRows.length > 0;
  const renderedRows = virtualized
    ? virtualRows.map((item) => ({
        row: page.rows[item.index],
        index: item.index,
        lane: item.lane,
        start: item.start,
      }))
    : page.rows.map((row, index) => ({ row, index, lane: 0, start: null }));

  return (
    <div
      ref={scrollRef}
      className="database-gallery-viewport"
      data-virtualized={virtualized ? "true" : undefined}
      onScroll={(event) => onScroll?.(event.currentTarget.scrollTop)}
    >
      <ul
        className={`database-gallery${virtualized ? " database-gallery--virtualized" : ""}`}
        style={
          virtualized ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined
        }
      >
        {renderedRows.map(({ row, index, lane, start }) => {
          if (row === undefined) return null;
          const preview = safeGalleryPreview(previewMode, previews.get(row.entryId as Uuid));
          const width = `calc(${100 / lanes}% - ${(12 * (lanes - 1)) / lanes}px)`;
          const left = `calc(${(lane * 100) / lanes}% + ${(lane * 12) / lanes}px)`;
          return (
            <GalleryCard
              key={row.entryId}
              row={row}
              index={index}
              rowCount={page.rows.length}
              selectedProperties={selectedProperties}
              preview={preview}
              previewMode={previewMode}
              onOpenEntry={onOpenEntry}
              onFocusChange={(focused) => setFocusedEntryId(focused ? (row.entryId as Uuid) : null)}
              dataIndex={start === null ? undefined : index}
              measureElement={start === null ? undefined : virtualizer.measureElement}
              style={
                start === null
                  ? undefined
                  : {
                      left,
                      position: "absolute",
                      transform: `translateY(${start}px)`,
                      width,
                    }
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

export function GalleryView({
  properties,
  view,
  page,
  previews = new Map(),
  onOpenEntry,
  onChangeView,
  scrollTop = 0,
  onScroll,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: GalleryViewDefinition;
  readonly page: DatabaseViewPage;
  readonly previews?: ReadonlyMap<Uuid, GalleryPreview>;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onChangeView: (view: GalleryViewDefinition) => void | Promise<void>;
  readonly scrollTop?: number;
  readonly onScroll?: (scrollTop: number) => void;
}) {
  const selectedProperties = galleryProperties(view, properties);
  const configurableProperties = properties.filter(
    ({ state, type }) => state === "active" && type !== "title",
  );

  return (
    <section
      className="database-view database-gallery-scroll"
      aria-label={DATABASE_COPY.gallery.viewLabel(view.name)}
    >
      <details className="database-gallery-settings">
        <summary>{DATABASE_COPY.gallery.settings}</summary>
        <label className="database-view-setting">
          {DATABASE_COPY.gallery.preview}
          <select
            value={view.options.preview}
            onChange={(event) =>
              void onChangeView({
                ...view,
                options: {
                  ...view.options,
                  preview: event.target.value as GalleryViewDefinition["options"]["preview"],
                },
              })
            }
          >
            <option value="none">{DATABASE_COPY.gallery.none}</option>
            <option value="page">{DATABASE_COPY.gallery.page}</option>
            <option value="first-safe-file">{DATABASE_COPY.gallery.file}</option>
          </select>
        </label>
        <fieldset>
          <legend>{DATABASE_COPY.gallery.properties}</legend>
          {configurableProperties.map((property) => (
            <label key={property.id}>
              <input
                type="checkbox"
                checked={view.options.cardPropertyIds.includes(property.id)}
                onChange={(event) => {
                  const cardPropertyIds = event.target.checked
                    ? [...view.options.cardPropertyIds, property.id]
                    : view.options.cardPropertyIds.filter((id) => id !== property.id);
                  void onChangeView({ ...view, options: { ...view.options, cardPropertyIds } });
                }}
              />
              {property.name}
            </label>
          ))}
        </fieldset>
      </details>
      {page.rows.length === 0 ? (
        <p className="empty-state">
          {page.coverage === "partial"
            ? DATABASE_COPY.common.noCardsAvailable
            : DATABASE_COPY.common.noCards}
        </p>
      ) : (
        <GalleryCards
          page={page}
          selectedProperties={selectedProperties}
          previews={previews}
          previewMode={view.options.preview}
          onOpenEntry={onOpenEntry}
          scrollTop={scrollTop}
          onScroll={onScroll}
        />
      )}
    </section>
  );
}
