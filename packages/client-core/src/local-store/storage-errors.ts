/** Dexie may wrap DOM quota errors in inner. */
export function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "QuotaExceededError" ||
      (error as { inner?: { name?: string } }).inner?.name === "QuotaExceededError")
  );
}
