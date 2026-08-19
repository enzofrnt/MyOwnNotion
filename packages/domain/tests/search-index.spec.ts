import {
  asUuid,
  prepareSearchQuery,
  type SearchDocument,
  WorkspaceSearchIndex,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const itemIds = {
  exact: asUuid("018f0000-0000-7000-8000-000000000011"),
  prefix: asUuid("018f0000-0000-7000-8000-000000000012"),
  body: asUuid("018f0000-0000-7000-8000-000000000013"),
  file: asUuid("018f0000-0000-7000-8000-000000000014"),
};

function document(
  itemId: SearchDocument["itemId"],
  title: string,
  bodyText: string,
  sourceVersion: number,
  kind: SearchDocument["kind"] = "page",
): SearchDocument {
  return {
    itemId,
    revisionId: asUuid(`018f0000-0000-7000-8000-${String(sourceVersion).padStart(12, "0")}`),
    sourceVersion,
    kind,
    title,
    bodyText,
    conflict: false,
  };
}

function query(raw: string) {
  const prepared = prepareSearchQuery(raw);
  if (!prepared.ok) {
    throw new Error(`unexpected invalid query: ${prepared.code}`);
  }
  return prepared.value;
}

describe("WorkspaceSearchIndex", () => {
  it("ranks exact and prefix titles before title terms, filenames and body matches", () => {
    const index = new WorkspaceSearchIndex();
    index.upsert(document(itemIds.body, "Notes", "architecture résiliente", 1));
    index.upsert(document(itemIds.file, "architecture résiliente.pdf", "", 1, "file"));
    index.upsert(document(itemIds.prefix, "Architecture résiliente — décisions", "", 1));
    index.upsert(document(itemIds.exact, "Architecture résiliente", "", 1));

    const results = index.search(query("architecture resiliente"));
    expect(results.map(({ itemId }) => itemId)).toEqual([
      itemIds.exact,
      itemIds.prefix,
      itemIds.file,
      itemIds.body,
    ]);
    expect(results.map(({ matchedFields }) => matchedFields)).toEqual([
      ["title"],
      ["title"],
      ["fileName"],
      ["body"],
    ]);
  });

  it("requires every term while allowing case, accents and final-term prefixes", () => {
    const index = new WorkspaceSearchIndex([
      document(itemIds.exact, "Reprise Atomique Résiliente", "", 1),
      document(itemIds.body, "Reprise seulement", "", 1),
    ]);

    expect(index.search(query("REPRISE resil"))).toHaveLength(1);
    expect(index.search(query("REPRISE resil"))[0]?.itemId).toBe(itemIds.exact);
  });

  it("uses the body as the primary match when a title contains only one query term", () => {
    const index = new WorkspaceSearchIndex([
      document(itemIds.exact, "Priorité search token", "", 1),
      document(itemIds.body, "Notes search archive", "Priorité search token", 1),
    ]);

    const results = index.search(query("priorite search token"));
    expect(results.map(({ itemId }) => itemId)).toEqual([itemIds.exact, itemIds.body]);
    expect(results[1]?.matchedFields[0]).toBe("body");
  });

  it("filters kinds and applies a deterministic identity tie-break", () => {
    const index = new WorkspaceSearchIndex([
      document(itemIds.file, "Alpha", "", 1, "file"),
      document(itemIds.prefix, "Alpha", "", 1, "folder"),
      document(itemIds.exact, "Alpha", "", 1),
    ]);

    expect(index.search(query("alpha")).map(({ itemId }) => itemId)).toEqual([
      itemIds.exact,
      itemIds.prefix,
      itemIds.file,
    ]);
    expect(
      index.search(query("alpha"), { kinds: new Set(["folder", "file"]) }).map(({ kind }) => kind),
    ).toEqual(["folder", "file"]);
  });

  it("ignores stale and replayed upserts without duplicating an identity", () => {
    const index = new WorkspaceSearchIndex();
    expect(index.upsert(document(itemIds.exact, "Current", "", 4))).toBe("inserted");
    expect(index.upsert(document(itemIds.exact, "Current", "", 4))).toBe("ignored");
    expect(index.upsert(document(itemIds.exact, "Stale", "", 3))).toBe("ignored");
    expect(index.search(query("current"))).toHaveLength(1);
    expect(index.search(query("stale"))).toHaveLength(0);
    expect(index.size).toBe(1);
  });

  it("makes removal idempotent and prevents a stale upsert from resurrecting an item", () => {
    const index = new WorkspaceSearchIndex([document(itemIds.exact, "Disposable", "", 4)]);

    expect(index.remove(itemIds.exact, 5)).toBe("removed");
    expect(index.remove(itemIds.exact, 5)).toBe("ignored");
    expect(index.upsert(document(itemIds.exact, "Ghost", "", 4))).toBe("ignored");
    expect(index.search(query("disposable"))).toHaveLength(0);
    expect(index.search(query("ghost"))).toHaveLength(0);
  });

  it("refuses two different revisions claiming the same source version", () => {
    const index = new WorkspaceSearchIndex([document(itemIds.exact, "First", "", 7)]);
    const inconsistent = {
      ...document(itemIds.exact, "Second", "", 7),
      revisionId: asUuid("018f0000-0000-7000-8000-999999999999"),
    };

    expect(() => index.upsert(inconsistent)).toThrow(/source version/i);
    expect(index.search(query("first"))).toHaveLength(1);
  });
});
