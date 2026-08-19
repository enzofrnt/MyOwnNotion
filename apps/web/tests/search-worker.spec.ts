import { asUuid, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { createSearchWorkerRuntime } from "../src/features/search/search.worker.ts";

const id = asUuid("018f0000-0000-7000-8000-000000000401");
const revisionId = asUuid("018f0000-0000-7000-8000-000000000402");

function document(
  title: string,
  sourceVersion: number,
  options: { readonly itemId?: Uuid; readonly kind?: "page" | "folder" | "file" } = {},
) {
  return {
    itemId: options.itemId ?? id,
    revisionId,
    sourceVersion,
    kind: options.kind ?? ("page" as const),
    title,
    bodyText: "texte local",
    conflict: false,
  };
}

describe("local search worker protocol", () => {
  it("builds, queries, upserts, removes and clears an in-memory generation", () => {
    const runtime = createSearchWorkerRuntime();

    expect(runtime.handle({ type: "build", documents: [document("Avant", 0)] })).toMatchObject({
      ok: true,
      state: "ready",
      size: 1,
    });
    expect(runtime.handle({ type: "query", query: "avant", limit: 20 })).toMatchObject({
      ok: true,
      candidates: [{ itemId: id }],
    });

    runtime.handle({ type: "upsert", document: document("Après", 1) });
    expect(runtime.handle({ type: "query", query: "apres", limit: 20 })).toMatchObject({
      ok: true,
      candidates: [{ title: "Après" }],
    });

    runtime.handle({ type: "remove", itemId: id, sourceVersion: 2 });
    expect(runtime.handle({ type: "query", query: "apres", limit: 20 })).toMatchObject({
      ok: true,
      candidates: [],
    });

    expect(runtime.handle({ type: "clear" })).toMatchObject({
      ok: true,
      state: "cold",
      size: 0,
    });
  });

  it("publishes a build atomically and refuses invalid queries without retaining their text", () => {
    const runtime = createSearchWorkerRuntime();
    runtime.handle({ type: "build", documents: [document("Stable", 0)] });

    const invalid = runtime.handle({ type: "query", query: "x".repeat(513), limit: 20 });
    expect(invalid).toEqual({ ok: false, code: "query-too-long" });
    expect(JSON.stringify(invalid)).not.toContain("x".repeat(513));
    expect(runtime.handle({ type: "query", query: "stable", limit: 20 })).toMatchObject({
      ok: true,
      candidates: [{ itemId: id }],
    });
  });

  it("applies type and current-branch identity filters inside the worker", () => {
    const folderId = asUuid("018f0000-0000-7000-8000-000000000403");
    const outsideId = asUuid("018f0000-0000-7000-8000-000000000404");
    const runtime = createSearchWorkerRuntime();
    runtime.handle({
      type: "build",
      documents: [
        document("Commun", 0),
        document("Commun", 0, { itemId: folderId, kind: "folder" }),
        document("Commun", 0, { itemId: outsideId }),
      ],
    });

    expect(
      runtime.handle({
        type: "query",
        query: "commun",
        kinds: ["page"],
        itemIds: [id, folderId],
        limit: 20,
      }),
    ).toMatchObject({
      ok: true,
      candidates: [{ itemId: id, kind: "page" }],
    });
  });
});
