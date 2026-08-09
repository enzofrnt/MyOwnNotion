/**
 * Ordered changes, verified snapshot fallback, and mutation-batch contract
 * tests (T037, US6).
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, createItemViaApi } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe("mutation batch (idempotent submission)", () => {
  it("accepts queued mutations and returns per-mutation results", async () => {
    const mutationId = generateUuidV7();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId,
            commandType: "item.create",
            baseRevisionIds: [],
            payload: {
              id: generateUuidV7(),
              kind: "folder",
              name: "Queued folder",
              placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
            },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      results: Array<{ mutationId: string; status: string; revisionIds?: string[] }>;
    };
    expect(body.results[0]?.mutationId).toBe(mutationId);
    expect(body.results[0]?.status).toBe("accepted");
    expect(body.results[0]?.revisionIds?.length).toBe(1);
  });

  it("duplicate delivery replays already-accepted without side effects (SC-014)", async () => {
    const mutationId = generateUuidV7();
    const mutation = {
      mutationId,
      commandType: "item.create",
      baseRevisionIds: [],
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Delivered twice",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "W" },
      },
    };
    const first = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: { mutations: [mutation] },
    });
    const second = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: { mutations: [mutation] },
    });
    const firstResult = (
      first.json() as { results: Array<{ status: string; revisionIds: string[] }> }
    ).results[0];
    const secondResult = (
      second.json() as { results: Array<{ status: string; revisionIds: string[] }> }
    ).results[0];
    expect(firstResult?.status).toBe("accepted");
    expect(secondResult?.status).toBe("already-accepted");
    expect(secondResult?.revisionIds).toEqual(firstResult?.revisionIds);

    // Exactly one item was created.
    const listing = await harness.built.app.inject({
      method: "GET",
      url: "/v1/items?parentItemId=root",
    });
    const names = (listing.json() as { items: Array<{ name: string }> }).items.filter(
      (item) => item.name === "Delivered twice",
    );
    expect(names.length).toBe(1);
  });

  it("a stale causal base returns a structured conflict with competing revisions", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Conflict page" });
    // First edit advances the head.
    const okEdit = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "page.document.replace",
            baseRevisionIds: [page.revisionId],
            payload: {
              itemId: page.itemId,
              baseRevisionId: page.revisionId,
              document: {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: { text: "first" },
              },
            },
          },
        ],
      },
    });
    const acceptedResult = (
      okEdit.json() as { results: Array<{ status: string; revisionIds: string[] }> }
    ).results[0];
    expect(acceptedResult?.status).toBe("accepted");

    // Second edit from the same (now stale) base conflicts.
    const staleEdit = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: generateUuidV7(),
            commandType: "page.document.replace",
            baseRevisionIds: [page.revisionId],
            payload: {
              itemId: page.itemId,
              baseRevisionId: page.revisionId,
              document: {
                format: "myownnotion.document+json",
                formatVersion: 1,
                body: { text: "stale" },
              },
            },
          },
        ],
      },
    });
    const conflictResult = (
      staleEdit.json() as {
        results: Array<{
          status: string;
          competingRevisionIds?: string[];
          problem?: { code: string };
        }>;
      }
    ).results[0];
    expect(conflictResult?.status).toBe("conflict");
    expect(conflictResult?.competingRevisionIds).toEqual(acceptedResult?.revisionIds);
    expect(conflictResult?.problem?.code).toBe("revision.stale-base");
  });

  it("malformed queued payloads are rejected per-mutation, not per-batch", async () => {
    const good = generateUuidV7();
    const bad = generateUuidV7();
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [
          {
            mutationId: bad,
            commandType: "item.create",
            baseRevisionIds: [],
            payload: { id: "broken" },
          },
          {
            mutationId: good,
            commandType: "item.create",
            baseRevisionIds: [],
            payload: {
              id: generateUuidV7(),
              kind: "folder",
              name: "Still accepted",
              placement: { kind: "hierarchy", parentItemId: null, positionKey: "X" },
            },
          },
        ],
      },
    });
    const results = (
      response.json() as {
        results: Array<{ mutationId: string; status: string }>;
      }
    ).results;
    expect(results.find((result) => result.mutationId === bad)?.status).toBe("rejected");
    expect(results.find((result) => result.mutationId === good)?.status).toBe("accepted");
  });
});

describe("ordered change feed", () => {
  it("returns contiguous ordered changes with monotonic sequences", async () => {
    const response = await harness.built.app.inject({ method: "GET", url: "/v1/changes?after=" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      changes: Array<{ sequence: number; mutationId: string; revisionIds: string[] }>;
      nextCursor: string;
      hasMore: boolean;
    };
    const sequences = body.changes.map((change) => change.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(body.nextCursor).toBe(String(sequences[sequences.length - 1]));
  });

  it("paginates with hasMore and a resumable cursor", async () => {
    const first = await harness.built.app.inject({
      method: "GET",
      url: "/v1/changes?after=&limit=1",
    });
    const firstBody = first.json() as {
      changes: Array<{ sequence: number }>;
      nextCursor: string;
      hasMore: boolean;
    };
    expect(firstBody.changes.length).toBe(1);
    expect(firstBody.hasMore).toBe(true);

    const second = await harness.built.app.inject({
      method: "GET",
      url: `/v1/changes?after=${firstBody.nextCursor}&limit=1000`,
    });
    const secondBody = second.json() as { changes: Array<{ sequence: number }> };
    expect(secondBody.changes[0]?.sequence).toBeGreaterThan(
      firstBody.changes[0]?.sequence as number,
    );
  });

  it("an unparseable cursor reports compaction (409 cursor.compacted)", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/changes?after=not-a-cursor",
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { code: string }).code).toBe("cursor.compacted");
  });
});

describe("verified snapshot", () => {
  it("returns the complete projection, cursor, and digest", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/snapshots/current",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      workspaceId: string;
      schemaVersion: number;
      cursor: string;
      digest: string;
      items: unknown[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.items.length).toBeGreaterThan(0);
    // The cursor matches the latest change sequence.
    const changes = await harness.built.app.inject({ method: "GET", url: "/v1/changes?after=" });
    const changesBody = changes.json() as { nextCursor: string };
    expect(body.cursor).toBe(changesBody.nextCursor);
  });
});
