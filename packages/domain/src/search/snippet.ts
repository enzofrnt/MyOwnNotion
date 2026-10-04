const SNIPPET_LIMIT = 320;

/** Slice original text using offsets in the caller’s comparable text. */
export function safeSearchSnippet(
  bodyText: string,
  matchedTerms: readonly string[],
  comparable: string,
): string | null {
  if (bodyText.length === 0) {
    return null;
  }
  const firstMatch = matchedTerms.reduce((best, term) => {
    const position = comparable.indexOf(term);
    return position < 0 || (best >= 0 && best <= position) ? best : position;
  }, -1);
  const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - 100);
  const value = bodyText
    .slice(start, start + SNIPPET_LIMIT)
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return value.length === 0
    ? null
    : `${start > 0 ? "…" : ""}${value}${start + SNIPPET_LIMIT < bodyText.length ? "…" : ""}`;
}
