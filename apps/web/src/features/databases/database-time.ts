/** Notion-like read-only timestamps in database views. */

/**
 * Reads the millisecond timestamp embedded in a UUIDv7 revision identity.
 * Returns null for any other UUID version so a legacy identity never produces
 * a misleading date.
 */
export function uuidV7Timestamp(value: string): string | null {
  const hex = value.replaceAll("-", "");
  if (hex.length !== 32 || hex[12] !== "7") return null;
  const millis = Number.parseInt(hex.slice(0, 12), 16);
  if (!Number.isSafeInteger(millis) || millis <= 0) return null;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDatabaseTimestamp(instant: string): string {
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? FORMATTER.format(date) : "—";
}
