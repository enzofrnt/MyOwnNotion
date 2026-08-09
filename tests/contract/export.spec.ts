/**
 * Export completeness, 30-day trash inclusion, and round-trip tests
 * (T087, SC-005/SC-007, FR-023/FR-025).
 */
import { createHash } from "node:crypto";
import {
  type CanonicalExportManifest,
  canonicalExportString,
  generateUuidV7,
  validateCanonicalExport,
} from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
} from "../../apps/api/tests/helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

async function runExport(): Promise<{ manifest: CanonicalExportManifest; digest: string }> {
  const created = await harness.built.app.inject({
    method: "POST",
    url: "/v1/export",
    headers: idempotencyHeaders(),
  });
  expect(created.statusCode).toBe(202);
  const exportId = (created.json() as { exportId: string }).exportId;

  let status = "pending";
  let digest = "";
  for (let attempt = 0; attempt < 50 && status === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const poll = await harness.built.app.inject({ method: "GET", url: `/v1/export/${exportId}` });
    const body = poll.json() as { status: string; digest?: string };
    status = body.status;
    digest = body.digest ?? "";
  }
  expect(status).toBe("ready");

  const artifact = await harness.built.app.inject({
    method: "GET",
    url: `/v1/export/${exportId}/artifact`,
  });
  expect(artifact.statusCode).toBe(200);
  return { manifest: artifact.json() as CanonicalExportManifest, digest };
}

describe("canonical export (T086/T088)", () => {
  it("exports every entity with zero validation issues and a verifiable digest", async () => {
    const folder = await createItemViaApi(harness, { kind: "folder", name: "Export folder" });
    const page = await createItemViaApi(harness, {
      kind: "page",
      name: "Export page",
      parentItemId: folder.itemId,
    });
    await harness.built.app.inject({
      method: "POST",
      url: "/v1/relationships",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        sourceItemId: page.itemId,
        targetItemId: folder.itemId,
        relationType: "link:references",
      },
    });

    const { manifest, digest } = await runExport();
    expect(manifest.format).toBe("myownnotion.export+json");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([folder.itemId, page.itemId]),
    );
    expect(manifest.relationships.length).toBeGreaterThan(0);
    expect(manifest.revisions.length).toBeGreaterThan(0);
    expect(manifest.counts.items).toBe(manifest.items.length);

    // Independent validation (SC-005): no missing entities.
    expect(validateCanonicalExport(manifest)).toEqual([]);

    // The digest matches an independent recomputation of the canonical string.
    const recomputed = createHash("sha256").update(canonicalExportString(manifest)).digest("hex");
    expect(recomputed).toBe(digest);
  });

  it("includes trashed items with deletion time, recovery deadline, and lineage (FR-025)", async () => {
    const doomed = await createItemViaApi(harness, { kind: "page", name: "Trashed export page" });
    await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${doomed.itemId}/trash`,
      headers: idempotencyHeaders(),
    });

    const { manifest } = await runExport();
    const trashed = manifest.items.find((item) => item.id === doomed.itemId);
    expect(trashed).toBeDefined();
    expect(trashed?.lifecycle).toBe("trashed");
    expect(trashed?.trashedAt).not.toBeNull();
    expect(trashed?.purgeAfter).not.toBeNull();
    // Lineage present for the trashed item.
    expect(manifest.revisions.some((revision) => revision.itemId === doomed.itemId)).toBe(true);
  });

  it("round-trips deterministically: same state, same canonical string", async () => {
    const first = await runExport();
    const second = await runExport();
    const normalize = (manifest: CanonicalExportManifest) =>
      canonicalExportString({ ...manifest, exportedAt: "fixed" });
    expect(normalize(first.manifest)).toBe(normalize(second.manifest));
  });
});
