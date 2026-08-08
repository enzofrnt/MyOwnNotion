/**
 * Create/list/reorder/move/trash/restore API contract tests (T026, US1).
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

describe("health", () => {
  it("reports readiness and schema version", async () => {
    const response = await harness.built.app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      schemaVersion: 1,
      storage: { adapter: "filesystem", status: "ready" },
    });
  });
});

describe("item creation contract", () => {
  it("creates a folder with its initial revision (201)", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Projects",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      mutationId: string;
      revisionIds: string[];
      item: { kind: string; lifecycle: string; placements: unknown[] };
    };
    expect(body.revisionIds.length).toBe(1);
    expect(body.item.kind).toBe("folder");
    expect(body.item.lifecycle).toBe("active");
    expect(body.item.placements.length).toBe(1);
  });

  it("rejects a missing Idempotency-Key (400)", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "No key",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("rejects malformed payloads with safe problems (400)", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: { id: "not-a-uuid", kind: "folder", name: "x" },
    });
    expect(response.statusCode).toBe(400);
    const problem = response.json() as { code: string };
    expect(problem.code).toBe("validation.invalid-payload");
  });

  it("replays the identical result for a duplicate mutation id", async () => {
    const mutationId = generateUuidV7();
    const payload = {
      id: generateUuidV7(),
      kind: "folder" as const,
      name: "Replayed",
      placement: { kind: "hierarchy" as const, parentItemId: null, positionKey: "Vr" },
    };
    const first = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(mutationId),
      payload,
    });
    const second = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(mutationId),
      payload: { ...payload, id: generateUuidV7(), name: "Different" },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json() as { revisionIds: string[] };
    const secondBody = second.json() as { revisionIds: string[] };
    expect(secondBody.revisionIds).toEqual(firstBody.revisionIds);
  });
});

describe("hierarchy operations contract", () => {
  it("lists children of a parent", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Parent" });
    await createItemViaApi(harness, {
      kind: "page",
      name: "Child A",
      parentItemId: folder.itemId,
      positionKey: "V",
    });
    await createItemViaApi(harness, {
      kind: "page",
      name: "Child B",
      parentItemId: folder.itemId,
      positionKey: "W",
    });
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items?parentItemId=${folder.itemId}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ name: string }> };
    expect(body.items.map((item) => item.name).sort()).toEqual(["Child A", "Child B"]);
  });

  it("reorders siblings and persists explicit order (FR-044)", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Ordered" });
    const first = await createItemViaApi(harness, {
      kind: "page",
      name: "First",
      parentItemId: folder.itemId,
      positionKey: "M",
    });
    await createItemViaApi(harness, {
      kind: "page",
      name: "Second",
      parentItemId: folder.itemId,
      positionKey: "T",
    });
    // Move "First" after "Second".
    const move = await harness.built.app.inject({
      method: "POST",
      url: `/v1/placements/${first.placementId}/move`,
      headers: idempotencyHeaders(),
      payload: { parentItemId: folder.itemId, positionKey: "X" },
    });
    expect(move.statusCode).toBe(200);
    const listing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items?parentItemId=${folder.itemId}`,
    });
    const body = listing.json() as {
      items: Array<{ name: string; placements: Array<{ positionKey: string }> }>;
    };
    const ordered = body.items
      .map((item) => ({ name: item.name, key: item.placements[0]?.positionKey ?? "" }))
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((entry) => entry.name);
    expect(ordered).toEqual(["Second", "First"]);
  });

  it("moves a branch and rejects cycles (409)", async () => {
    const a = await createItemViaApi(harness, { kind: "folder", name: "A" });
    const b = await createItemViaApi(harness, {
      kind: "folder",
      name: "B",
      parentItemId: a.itemId,
    });
    const c = await createItemViaApi(harness, {
      kind: "folder",
      name: "C",
      parentItemId: b.itemId,
    });

    const cycle = await harness.built.app.inject({
      method: "POST",
      url: `/v1/placements/${a.placementId}/move`,
      headers: idempotencyHeaders(),
      payload: { parentItemId: c.itemId, positionKey: "V" },
    });
    expect(cycle.statusCode).toBe(409);
    expect((cycle.json() as { code: string }).code).toBe("containment.cycle-rejected");

    const valid = await harness.built.app.inject({
      method: "POST",
      url: `/v1/placements/${b.placementId}/move`,
      headers: idempotencyHeaders(),
      payload: { parentItemId: null, positionKey: "Z" },
    });
    expect(valid.statusCode).toBe(200);

    const cItem = await harness.built.app.inject({ method: "GET", url: `/v1/items/${c.itemId}` });
    const cBody = cItem.json() as { placements: Array<{ parentItemId: string }> };
    expect(cBody.placements[0]?.parentItemId).toBe(b.itemId);
  });

  it("renames while preserving identity and lineage", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Before" });
    const rename = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/items/${page.itemId}`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: page.revisionId, name: "After" },
    });
    expect(rename.statusCode).toBe(200);
    const item = await harness.built.app.inject({ method: "GET", url: `/v1/items/${page.itemId}` });
    const body = item.json() as { id: string; name: string; currentRevisionId: string };
    expect(body.id).toBe(page.itemId);
    expect(body.name).toBe("After");
    expect(body.currentRevisionId).not.toBe(page.revisionId);
  });

  it("trashes and restores a branch atomically", async () => {
    const root = await createItemViaApi(harness, { kind: "folder", name: "TrashRoot" });
    const child = await createItemViaApi(harness, {
      kind: "page",
      name: "TrashChild",
      parentItemId: root.itemId,
    });

    const trash = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${root.itemId}/trash`,
      headers: idempotencyHeaders(),
    });
    expect(trash.statusCode).toBe(200);
    const trashedChild = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${child.itemId}`,
    });
    const childBody = trashedChild.json() as {
      lifecycle: string;
      trashedAt: string | null;
      purgeAfter: string | null;
    };
    expect(childBody.lifecycle).toBe("trashed");
    expect(childBody.trashedAt).not.toBeNull();
    expect(childBody.purgeAfter).not.toBeNull();
    // 30-day recovery window (FR-013).
    const windowMs =
      Date.parse(childBody.purgeAfter as string) - Date.parse(childBody.trashedAt as string);
    expect(windowMs).toBe(30 * 24 * 60 * 60 * 1000);

    const restore = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${root.itemId}/restore`,
      headers: idempotencyHeaders(),
    });
    expect(restore.statusCode).toBe(200);
    const restoredChild = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${child.itemId}`,
    });
    expect((restoredChild.json() as { lifecycle: string }).lifecycle).toBe("active");
    const restoredRoot = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${root.itemId}`,
    });
    expect((restoredRoot.json() as { placements: unknown[] }).placements.length).toBe(1);
  });

  it("returns 404 problems for unknown items", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${generateUuidV7()}`,
    });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe("item.not-found");
  });

  it("keeps duplicate sibling names as distinct identities", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "DupNames" });
    const one = await createItemViaApi(harness, {
      kind: "page",
      name: "Same",
      parentItemId: folder.itemId,
      positionKey: "V",
    });
    const two = await createItemViaApi(harness, {
      kind: "page",
      name: "Same",
      parentItemId: folder.itemId,
      positionKey: "W",
    });
    expect(one.itemId).not.toBe(two.itemId);
    const listing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items?parentItemId=${folder.itemId}`,
    });
    const body = listing.json() as { items: Array<{ id: string }> };
    expect(new Set(body.items.map((item) => item.id)).size).toBe(2);
  });
});

describe("changes feed after hierarchy operations", () => {
  it("exposes ordered contiguous changes with items", async () => {
    const response = await harness.built.app.inject({ method: "GET", url: "/v1/changes?after=" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      changes: Array<{ sequence: number }>;
      nextCursor: string;
      hasMore: boolean;
    };
    expect(body.changes.length).toBeGreaterThan(0);
    const sequences = body.changes.map((change) => change.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });
});
