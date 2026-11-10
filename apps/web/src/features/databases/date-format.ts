import {
  type DatabaseProperty,
  type DateFormat,
  dateConfigOf,
  type TimeFormat,
} from "@myownnotion/domain";
import { DATABASE_LOCALE } from "./database-copy.ts";

interface DateLike {
  readonly kind: "date" | "instant";
  readonly date?: string;
  readonly endDate?: string;
  readonly instant?: string;
  readonly endInstant?: string;
}

export const DATE_FORMAT_OPTIONS: readonly { value: DateFormat; label: string }[] = [
  { value: "full", label: "Date complète" },
  { value: "short", label: "Date courte" },
  { value: "month-day-year", label: "Mois/jour/année" },
  { value: "day-month-year", label: "Jour/mois/année" },
  { value: "year-month-day", label: "Année/mois/jour" },
  { value: "relative", label: "Relatif" },
];

export const TIME_FORMAT_OPTIONS: readonly { value: TimeFormat; label: string }[] = [
  { value: "hidden", label: "Masqué" },
  { value: "12h", label: "12 heures" },
  { value: "24h", label: "24 heures" },
];

const fullDate = new Intl.DateTimeFormat(DATABASE_LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat(DATABASE_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const time12 = new Intl.DateTimeFormat(DATABASE_LOCALE, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const time24 = new Intl.DateTimeFormat(DATABASE_LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function civilDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function civilDateAsUtc(value: string): Date | null {
  const parts = civilDateParts(value);
  if (parts === null) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function numericDate(
  value: Date,
  format: Extract<DateFormat, "month-day-year" | "day-month-year" | "year-month-day">,
  utc: boolean,
): string {
  const year = utc ? value.getUTCFullYear() : value.getFullYear();
  const month = (utc ? value.getUTCMonth() : value.getMonth()) + 1;
  const day = utc ? value.getUTCDate() : value.getDate();
  if (format === "month-day-year") return `${month}/${day}/${year}`;
  if (format === "day-month-year") return `${day}/${month}/${year}`;
  return `${year}/${month}/${day}`;
}

function relativeLabel(value: Date, utc: boolean, now = new Date()): string {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const target = utc
    ? Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    : Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const diff = Math.round((target - today) / 86_400_000);
  if (diff === 0) return "Aujourd’hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  if (diff > 1 && diff < 7) return `Dans ${diff} jours`;
  if (diff < -1 && diff > -7) return `Il y a ${Math.abs(diff)} jours`;
  return fullDate.format(value);
}

function formatDatePart(value: Date, format: DateFormat, utc: boolean): string {
  if (format === "full") return fullDate.format(value);
  if (format === "short") return shortDate.format(value);
  if (format === "relative") return relativeLabel(value, utc);
  return numericDate(value, format, utc);
}

export function formatDatabaseDate(
  value: DateLike,
  config: {
    readonly dateFormat: DateFormat;
    readonly timeFormat: TimeFormat;
  },
): string {
  const isInstant = value.kind === "instant";
  const raw = isInstant ? value.instant : value.date;
  if (raw === undefined) return "—";
  const date = isInstant ? new Date(raw) : civilDateAsUtc(raw);
  if (date === null || Number.isNaN(date.getTime())) return "—";
  const utc = !isInstant;
  const formatOne = (value: Date): string => {
    const dateText = formatDatePart(value, config.dateFormat, utc);
    if (!isInstant || config.timeFormat === "hidden") return dateText;
    const clock = (config.timeFormat === "24h" ? time24 : time12).format(value);
    return `${dateText} · ${clock}`;
  };
  const startText = formatOne(date);
  const rawEnd = isInstant ? value.endInstant : value.endDate;
  if (rawEnd === undefined) return startText;
  const end = isInstant ? new Date(rawEnd) : civilDateAsUtc(rawEnd);
  if (end === null || Number.isNaN(end.getTime())) return startText;
  return `${startText} → ${formatOne(end)}`;
}

export function formatDatabaseDateForProperty(value: DateLike, property: DatabaseProperty): string {
  return formatDatabaseDate(value, dateConfigOf(property));
}
