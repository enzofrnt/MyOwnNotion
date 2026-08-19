import MiniSearch, { type SearchResult as MiniSearchResult } from "minisearch";
import type { ItemKind } from "../content/types.ts";
import type { Uuid } from "../ids/uuid.ts";
import { normaliseSearchText, segmentSearchTerms } from "./normalise.ts";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  type PreparedSearchQuery,
  type SearchCandidate,
  type SearchDocument,
  type SearchIndexQueryOptions,
  type SearchMatchedField,
} from "./types.ts";

type UpdateResult = "inserted" | "updated" | "ignored";
type RemovalResult = "removed" | "ignored";

function assertSourceVersion(sourceVersion: number): void {
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
    throw new TypeError("Search source version must be a non-negative safe integer");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function containsEverySearchTerm(value: string, terms: readonly string[]): boolean {
  const indexedTerms = segmentSearchTerms(value);
  return terms.every((term) => indexedTerms.some((indexedTerm) => indexedTerm.startsWith(term)));
}

function fieldsOf(
  result: MiniSearchResult,
  document: SearchDocument,
  query: PreparedSearchQuery,
): SearchMatchedField[] {
  const miniSearchFields = new Set(Object.values(result.match).flat());
  const fields: SearchMatchedField[] = [];
  const titleField = document.kind === "file" ? "fileName" : "title";
  const titleMatchesEveryTerm = containsEverySearchTerm(document.title, query.terms);
  const bodyMatchesEveryTerm = containsEverySearchTerm(document.bodyText, query.terms);
  if (titleMatchesEveryTerm) {
    fields.push(titleField);
  }
  if (bodyMatchesEveryTerm || (!titleMatchesEveryTerm && miniSearchFields.has("bodyText"))) {
    fields.push("body");
  }
  if (!titleMatchesEveryTerm && miniSearchFields.has("title")) {
    fields.push(titleField);
  }
  return fields;
}

function rankOf(document: SearchDocument, query: PreparedSearchQuery): number {
  const title = normaliseSearchText(document.title);
  if (document.kind !== "file" && title === query.normalised) {
    return 0;
  }
  if (document.kind !== "file" && title.startsWith(query.normalised)) {
    return 1;
  }
  if (containsEverySearchTerm(document.title, query.terms)) {
    return document.kind === "file" ? 3 : 2;
  }
  return 4;
}

export class WorkspaceSearchIndex {
  readonly #index: MiniSearch<SearchDocument>;
  readonly #documents = new Map<Uuid, SearchDocument>();
  readonly #versions = new Map<Uuid, number>();

  constructor(documents: readonly SearchDocument[] = []) {
    this.#index = new MiniSearch<SearchDocument>({
      fields: ["title", "bodyText"],
      idField: "itemId",
      storeFields: ["revisionId", "sourceVersion", "kind", "title", "bodyText", "conflict"],
      tokenize: segmentSearchTerms,
      processTerm: (term) => term,
      logger: () => undefined,
      searchOptions: {
        combineWith: "AND",
        prefix: true,
        fuzzy: false,
        boost: { title: 8, bodyText: 1 },
      },
    });
    for (const document of documents) {
      this.upsert(document);
    }
  }

  get size(): number {
    return this.#documents.size;
  }

  upsert(document: SearchDocument): UpdateResult {
    assertSourceVersion(document.sourceVersion);
    const knownVersion = this.#versions.get(document.itemId);
    if (knownVersion !== undefined) {
      if (document.sourceVersion < knownVersion) {
        return "ignored";
      }
      if (document.sourceVersion === knownVersion) {
        const knownDocument = this.#documents.get(document.itemId);
        if (knownDocument === undefined || knownDocument.revisionId === document.revisionId) {
          return "ignored";
        }
        throw new Error("Conflicting revisions claim the same search source version");
      }
    }

    const previous = this.#documents.get(document.itemId);
    if (previous === undefined) {
      this.#index.add(document);
    } else {
      this.#index.replace(document);
    }
    this.#documents.set(document.itemId, document);
    this.#versions.set(document.itemId, document.sourceVersion);
    return previous === undefined ? "inserted" : "updated";
  }

  remove(itemId: Uuid, sourceVersion: number): RemovalResult {
    assertSourceVersion(sourceVersion);
    const knownVersion = this.#versions.get(itemId);
    if (knownVersion !== undefined && sourceVersion <= knownVersion) {
      return "ignored";
    }

    const previous = this.#documents.get(itemId);
    if (previous !== undefined) {
      this.#index.discard(itemId);
      this.#documents.delete(itemId);
    }
    this.#versions.set(itemId, sourceVersion);
    return previous === undefined ? "ignored" : "removed";
  }

  search(query: PreparedSearchQuery, options: SearchIndexQueryOptions = {}): SearchCandidate[] {
    if (query.terms.length === 0) {
      return [];
    }
    // One extra candidate lets the API determine whether another page exists.
    // The public contract still caps a returned page at MAX_SEARCH_LIMIT.
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT + 1,
    );
    const offset = Math.max(options.offset ?? 0, 0);
    const matches = this.#index.search(query.normalised, {
      filter: (result) => {
        const kind = result["kind"] as ItemKind;
        return (
          (options.kinds === undefined || options.kinds.has(kind)) &&
          (options.itemIds === undefined || options.itemIds.has(result.id as Uuid))
        );
      },
    });

    return matches
      .map((match): SearchCandidate => {
        const itemId = match.id as Uuid;
        const document = this.#documents.get(itemId);
        if (document === undefined) {
          throw new Error("Search engine returned an unknown document identity");
        }
        const matchedFields = fieldsOf(match, document, query);
        const rank = rankOf(document, query);
        const normalisedTitle = normaliseSearchText(document.title);
        return {
          itemId,
          revisionId: document.revisionId,
          kind: document.kind,
          title: document.title,
          bodyText: document.bodyText,
          conflict: document.conflict,
          score: match.score,
          matchedFields,
          matchedTerms: [...new Set(match.terms)].sort(compareText),
          orderKey: [rank, normalisedTitle, itemId],
        };
      })
      .sort((left, right) => {
        const byRank = left.orderKey[0] - right.orderKey[0];
        if (byRank !== 0) {
          return byRank;
        }
        const byScore = right.score - left.score;
        if (byScore !== 0) {
          return byScore;
        }
        const byTitle = compareText(left.orderKey[1], right.orderKey[1]);
        return byTitle !== 0 ? byTitle : compareText(left.itemId, right.itemId);
      })
      .slice(offset, offset + limit);
  }
}
