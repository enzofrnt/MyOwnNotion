import {
  MAX_SEARCH_QUERY_LENGTH,
  type PreparedSearchQuery,
  type SearchQueryValidationResult,
} from "./types.ts";

const SEARCH_LOCALE = "fr";
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/gu;
const DIACRITIC_MARK = /\p{M}/gu;
const WHITESPACE = /\s+/gu;
const VISIBLE_CHARACTER = /[^\p{Cc}\p{Cf}\p{Z}]/u;

const wordSegmenter = new Intl.Segmenter(SEARCH_LOCALE, { granularity: "word" });

/** Counts Unicode code points rather than UTF-16 code units. */
export function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

/** Shared deterministic normalisation for indexed fields and query text. */
export function normaliseSearchText(value: string): string {
  return value
    .replace(INVISIBLE_OR_CONTROL, " ")
    .normalize("NFKD")
    .replace(DIACRITIC_MARK, "")
    .toLocaleLowerCase(SEARCH_LOCALE)
    .replace(WHITESPACE, " ")
    .trim();
}

/** Locale-aware word segmentation used by MiniSearch in Node and browsers. */
export function segmentSearchTerms(value: string): string[] {
  const normalised = normaliseSearchText(value);
  const terms: string[] = [];
  for (const segment of wordSegmenter.segment(normalised)) {
    if (segment.isWordLike && segment.segment.length > 0) {
      terms.push(segment.segment);
    }
  }
  return terms;
}

export function prepareSearchQuery(query: string): SearchQueryValidationResult {
  if (countUnicodeCharacters(query) > MAX_SEARCH_QUERY_LENGTH) {
    return { ok: false, code: "query-too-long" };
  }
  if (!VISIBLE_CHARACTER.test(query)) {
    return { ok: false, code: "empty-query" };
  }

  const normalised = normaliseSearchText(query);
  const value: PreparedSearchQuery = {
    normalised,
    terms: segmentSearchTerms(normalised),
  };
  return { ok: true, value };
}
