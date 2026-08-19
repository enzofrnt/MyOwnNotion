import {
  countUnicodeCharacters,
  MAX_SEARCH_QUERY_LENGTH,
  normaliseSearchText,
  prepareSearchQuery,
  segmentSearchTerms,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("workspace search normalisation", () => {
  it("normalises French casing, accents and canonically equivalent text", () => {
    expect(normaliseSearchText("  RÉSUMÉ\tRésilient  ")).toBe("resume resilient");
    expect(normaliseSearchText("re\u0301sume\u0301")).toBe("resume");
  });

  it("segments words without retaining punctuation or control characters", () => {
    expect(segmentSearchTerms("L’architecture, reprise-atomique\u0000 sûre.")).toEqual([
      "l’architecture",
      "reprise",
      "atomique",
      "sure",
    ]);
  });

  it("accepts one visible character and rejects blank input", () => {
    expect(prepareSearchQuery("é")).toMatchObject({
      ok: true,
      value: { normalised: "e", terms: ["e"] },
    });
    expect(prepareSearchQuery(" \n\t ")).toEqual({ ok: false, code: "empty-query" });
  });

  it("retains visible symbols when a query has no word-like term", () => {
    expect(prepareSearchQuery("🧠")).toMatchObject({
      ok: true,
      value: { normalised: "🧠", terms: ["🧠"] },
    });
    expect(prepareSearchQuery("/")).toMatchObject({
      ok: true,
      value: { normalised: "/", terms: ["/"] },
    });
  });

  it("counts Unicode code points and enforces the 512-character boundary", () => {
    const accepted = "🧠".repeat(MAX_SEARCH_QUERY_LENGTH);
    expect(countUnicodeCharacters(accepted)).toBe(MAX_SEARCH_QUERY_LENGTH);
    expect(prepareSearchQuery(accepted).ok).toBe(true);
    expect(prepareSearchQuery(`${accepted}a`)).toEqual({
      ok: false,
      code: "query-too-long",
    });
  });

  it("does not mutate or retain the caller's original query", () => {
    const query = "  Secret Résilient  ";
    const prepared = prepareSearchQuery(query);
    expect(query).toBe("  Secret Résilient  ");
    expect(prepared).toEqual({
      ok: true,
      value: {
        normalised: "secret resilient",
        terms: ["secret", "resilient"],
      },
    });
  });
});
