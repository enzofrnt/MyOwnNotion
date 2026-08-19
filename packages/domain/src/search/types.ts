import type { ItemKind } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";

export const MAX_SEARCH_QUERY_LENGTH = 512;
export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;

export type SearchMatchedField = "title" | "fileName" | "body";
export type LocalAvailability = "present" | "offloaded" | "never-fetched";

/** One active, transient projection entry. It is never serialized. */
export interface SearchDocument {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  /** Monotonic within one source (server change sequence or local commit order). */
  readonly sourceVersion: number;
  readonly kind: ItemKind;
  readonly title: string;
  readonly bodyText: string;
  readonly conflict: boolean;
}

export interface PreparedSearchQuery {
  /** Normalised terms only. The private original query is deliberately absent. */
  readonly normalised: string;
  readonly terms: readonly string[];
}

export type SearchQueryValidationResult =
  | { readonly ok: true; readonly value: PreparedSearchQuery }
  | { readonly ok: false; readonly code: "empty-query" | "query-too-long" };

export interface SearchIndexQueryOptions {
  readonly kinds?: ReadonlySet<ItemKind>;
  readonly itemIds?: ReadonlySet<Uuid>;
  readonly limit?: number;
  /** Internal page offset after the deterministic sort. */
  readonly offset?: number;
}

export interface SearchCandidate {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly bodyText: string;
  readonly conflict: boolean;
  readonly score: number;
  readonly matchedFields: readonly SearchMatchedField[];
  readonly matchedTerms: readonly string[];
  readonly orderKey: readonly [rank: number, normalisedTitle: string, itemId: Uuid];
}

export interface SearchPathSegment {
  readonly itemId: Uuid;
  readonly title: string;
}

export interface SearchResult {
  readonly itemId: Uuid;
  readonly revisionId: Uuid;
  readonly kind: ItemKind;
  readonly title: string;
  readonly path: readonly SearchPathSegment[];
  readonly matchedField: SearchMatchedField;
  readonly snippet: string | null;
  readonly conflict: boolean;
  readonly localAvailability?: LocalAvailability;
  readonly source: "local" | "server";
}
