import type {
  DatabaseProperty,
  DatabaseView,
  NonRelationPropertyValue,
  Uuid,
} from "@myownnotion/domain";
import { useRef, useState } from "react";
import type { DatabaseViewPage, DatabaseViewRow } from "../../services/databases.ts";
import { DATABASE_COPY, DATABASE_LOCALE } from "./database-copy.ts";
import type { DatabaseCellUpdate } from "./table-view.tsx";

type CalendarViewDefinition = Extract<DatabaseView, { type: "calendar" }>;
type DateProperty = Extract<DatabaseProperty, { type: "date" }>;
type CalendarValue = Extract<NonRelationPropertyValue, { kind: "date" | "instant" }>;

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US-u-hc-h23", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function dateKey(parts: Pick<ZonedParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function calendarDateKey(value: CalendarValue | undefined, timeZone: string): string | null {
  if (value === undefined) return null;
  if (value.kind === "date") return value.date;
  return dateKey(zonedParts(new Date(value.instant), timeZone));
}

function localDateTimeToInstant(parts: ZonedParts, timeZone: string, milliseconds = 0): string {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    milliseconds,
  );
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = zonedParts(new Date(candidate), timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      milliseconds,
    );
    const difference = desired - renderedAsUtc;
    candidate += difference;
    if (difference === 0) break;
  }
  return new Date(candidate).toISOString();
}

export function calendarMoveUpdate(
  property: DateProperty,
  targetDate: string,
  currentValue: NonRelationPropertyValue | undefined,
  timeZone: string,
): DatabaseCellUpdate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(targetDate);
  if (match === null) return null;
  if (property.config.mode === "date") {
    return {
      kind: "property",
      propertyId: property.id,
      value: { kind: "date", date: targetDate },
    };
  }
  const existing =
    currentValue?.kind === "instant"
      ? zonedParts(new Date(currentValue.instant), timeZone)
      : { hour: 9, minute: 0, second: 0 };
  const instant = localDateTimeToInstant(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: existing.hour,
      minute: existing.minute,
      second: existing.second,
    },
    timeZone,
    currentValue?.kind === "instant" ? new Date(currentValue.instant).getUTCMilliseconds() : 0,
  );
  return {
    kind: "property",
    propertyId: property.id,
    value: { kind: "instant", instant },
  };
}

export function calendarRows(
  rows: readonly DatabaseViewRow[],
  property: DateProperty,
  timeZone: string,
): {
  readonly days: ReadonlyMap<string, readonly DatabaseViewRow[]>;
  readonly unscheduled: readonly DatabaseViewRow[];
} {
  const days = new Map<string, DatabaseViewRow[]>();
  const unscheduled: DatabaseViewRow[] = [];
  for (const row of rows) {
    const value = row.values[property.id];
    const key =
      value?.kind === "date" || value?.kind === "instant" ? calendarDateKey(value, timeZone) : null;
    if (key === null) {
      unscheduled.push(row);
    } else {
      days.set(key, [...(days.get(key) ?? []), row]);
    }
  }
  return { days, unscheduled };
}

function shiftDate(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount));
  return dateKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function shiftMonth(value: string, amount: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysForMonth(month: string): readonly string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year ?? 0, (monthNumber ?? 1) - 1, 1));
  const dayCount = new Date(Date.UTC(year ?? 0, monthNumber ?? 1, 0)).getUTCDate();
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  return [
    ...Array.from({ length: mondayOffset }, (_, index) => `empty:${month}:${index}`),
    ...Array.from({ length: dayCount }, (_, index) =>
      dateKey({ year: year ?? 0, month: monthNumber ?? 1, day: index + 1 }),
    ),
  ];
}

function monthLabel(month: string, timeZone: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(DATABASE_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(Date.UTC(year ?? 0, (monthNumber ?? 1) - 1, 15, 12)));
}

export function CalendarView({
  properties,
  view,
  page,
  onOpenEntry,
  onUpdateEntry,
  onChangeView,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  referenceDate = new Date(),
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: CalendarViewDefinition;
  readonly page: DatabaseViewPage;
  readonly onOpenEntry: (entryId: Uuid, trigger: HTMLElement | null) => void;
  readonly onUpdateEntry?: (entryId: Uuid, update: DatabaseCellUpdate) => void | Promise<void>;
  readonly onChangeView: (view: CalendarViewDefinition) => void | Promise<void>;
  readonly timeZone?: string;
  readonly referenceDate?: Date;
}) {
  const dateProperties = properties.filter(
    (property): property is DateProperty => property.state === "active" && property.type === "date",
  );
  const property =
    dateProperties.find(({ id }) => id === view.options.datePropertyId) ?? dateProperties[0];
  const initialDate = dateKey(zonedParts(referenceDate, timeZone)).slice(0, 7);
  const [visibleMonth, setVisibleMonth] = useState(initialDate);
  const draggedEntryId = useRef<Uuid | null>(null);
  const [announcement, setAnnouncement] = useState("");

  if (property === undefined) {
    return (
      <section className="database-view" aria-label={DATABASE_COPY.calendar.viewLabel(view.name)}>
        <p role="alert">{DATABASE_COPY.calendar.needsProperty}</p>
      </section>
    );
  }
  const grouped = calendarRows(page.rows, property, timeZone);

  const move = async (row: DatabaseViewRow, targetDate: string): Promise<void> => {
    const storedValue = row.values[property.id];
    const currentValue =
      storedValue?.kind === "date" || storedValue?.kind === "instant" ? storedValue : undefined;
    const update = calendarMoveUpdate(property, targetDate, currentValue, timeZone);
    if (update === null || onUpdateEntry === undefined) return;
    try {
      await onUpdateEntry(row.entryId as Uuid, update);
      setAnnouncement(DATABASE_COPY.calendar.scheduled(row.title, targetDate));
    } catch {
      setAnnouncement(DATABASE_COPY.calendar.scheduleFailed(row.title));
    }
  };

  const card = (row: DatabaseViewRow, scheduledDate: string | null) => (
    <li
      key={row.entryId}
      className="database-calendar__card"
      draggable
      onDragStart={(event) => {
        draggedEntryId.current = row.entryId as Uuid;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.entryId);
      }}
      onDragEnd={() => {
        draggedEntryId.current = null;
      }}
    >
      <button
        type="button"
        className="link database-card__title"
        data-entry-trigger={row.entryId}
        onClick={(event) => onOpenEntry(row.entryId as Uuid, event.currentTarget)}
      >
        {row.title}
      </button>
      <input
        type="date"
        aria-label={DATABASE_COPY.calendar.schedule(row.title)}
        value={scheduledDate ?? ""}
        disabled={onUpdateEntry === undefined}
        onChange={(event) => void move(row, event.target.value)}
      />
      {scheduledDate === null ? null : (
        <div className="database-calendar__move-actions">
          <button
            type="button"
            aria-label={DATABASE_COPY.calendar.movePrevious(row.title)}
            disabled={onUpdateEntry === undefined}
            onClick={() => void move(row, shiftDate(scheduledDate, -1))}
          >
            {DATABASE_COPY.calendar.previousDay}
          </button>
          <button
            type="button"
            aria-label={DATABASE_COPY.calendar.moveNext(row.title)}
            disabled={onUpdateEntry === undefined}
            onClick={() => void move(row, shiftDate(scheduledDate, 1))}
          >
            {DATABASE_COPY.calendar.nextDay}
          </button>
        </div>
      )}
    </li>
  );

  return (
    <section
      className="database-view database-calendar"
      aria-label={DATABASE_COPY.calendar.viewLabel(view.name)}
    >
      <div className="database-calendar__toolbar">
        <label className="database-view-setting">
          {DATABASE_COPY.calendar.dateProperty}
          <select
            value={property.id}
            onChange={(event) => {
              const next = dateProperties.find(({ id }) => id === event.target.value);
              if (next !== undefined) {
                void onChangeView({
                  ...view,
                  options: { ...view.options, datePropertyId: next.id },
                });
              }
            }}
          >
            {dateProperties.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <div className="database-calendar__navigation">
          <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, -1))}>
            {DATABASE_COPY.calendar.previousMonth}
          </button>
          <h3 aria-live="polite">{monthLabel(visibleMonth, timeZone)}</h3>
          <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, 1))}>
            {DATABASE_COPY.calendar.nextMonth}
          </button>
        </div>
      </div>
      <div className="database-calendar__month-scroll">
        <ol className="database-calendar__weekdays" aria-hidden="true">
          {DATABASE_COPY.calendar.weekdays.map((day) => (
            <li key={day}>{day}</li>
          ))}
        </ol>
        <ol className="database-calendar__days" aria-label={monthLabel(visibleMonth, timeZone)}>
          {daysForMonth(visibleMonth).map((day) =>
            day.startsWith("empty:") ? (
              <li key={day} aria-hidden="true" />
            ) : (
              <li
                key={day}
                className="database-calendar__day"
                data-calendar-day={day}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const entryId =
                    draggedEntryId.current ??
                    (event.dataTransfer.getData("text/plain") as Uuid | "");
                  const row = page.rows.find(({ entryId: candidate }) => candidate === entryId);
                  if (row !== undefined) void move(row, day);
                  draggedEntryId.current = null;
                }}
              >
                <h4>{Number(day.slice(-2))}</h4>
                <ul>{(grouped.days.get(day) ?? []).map((row) => card(row, day))}</ul>
              </li>
            ),
          )}
        </ol>
      </div>
      <section
        className="database-calendar__unscheduled"
        aria-labelledby={`unscheduled-${view.id}`}
      >
        <h3 id={`unscheduled-${view.id}`}>
          {DATABASE_COPY.calendar.unscheduled} · {grouped.unscheduled.length}
        </h3>
        {grouped.unscheduled.length === 0 ? (
          <p className="muted">{DATABASE_COPY.calendar.allScheduled}</p>
        ) : (
          <ul>{grouped.unscheduled.map((row) => card(row, null))}</ul>
        )}
      </section>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
