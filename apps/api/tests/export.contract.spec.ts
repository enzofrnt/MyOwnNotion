import { createHash } from "node:crypto";
import { schema } from "@myownnotion/database";
import {
  type CanonicalExportManifest,
  canonicalExportString,
  type DatabaseDefinition,
  generateUuidV7,
  validateCanonicalExport,
} from "@myownnotion/domain";
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
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

async function exportArtifact(): Promise<{ manifest: CanonicalExportManifest; digest: string }> {
  const started = await harness.built.app.inject({ method: "POST", url: "/v1/export" });
  expect(started.statusCode, started.body).toBe(202);
  const exportId = (started.json() as { exportId: string }).exportId;
  let status: { status: string; digest?: string } = { status: "pending" };
  for (let attempt = 0; attempt < 50 && status.status === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = (
      await harness.built.app.inject({ method: "GET", url: `/v1/export/${exportId}` })
    ).json() as typeof status;
  }
  expect(status.status).toBe("ready");
  const artifact = await harness.built.app.inject({
    method: "GET",
    url: `/v1/export/${exportId}/artifact`,
  });
  expect(artifact.statusCode, artifact.body).toBe(200);
  return { manifest: artifact.json() as CanonicalExportManifest, digest: status.digest ?? "" };
}

describe("structured canonical export (T074)", () => {
  it("exports definitions, entry values, property relations, counts, and a stable digest", async () => {
    const databaseId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const textPropertyId = generateUuidV7();
    const relationPropertyId = generateUuidV7();
    const viewId = generateUuidV7();
    const created = await harness.built.app.inject({
      method: "POST",
      url: "/v1/databases",
      headers: idempotencyHeaders(),
      payload: {
        id: databaseId,
        name: "Exported projects",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
        titlePropertyId,
        initialViewId: viewId,
        initialViewName: "Table",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdBody = created.json() as {
      database: { definitionRevisionId: string; definition: DatabaseDefinition };
    };
    const definition: DatabaseDefinition = {
      ...createdBody.database.definition,
      properties: [
        ...createdBody.database.definition.properties,
        {
          id: textPropertyId,
          name: "Private note",
          type: "text",
          positionKey: "b",
          state: "active",
          config: {},
        },
        {
          id: relationPropertyId,
          name: "Related",
          type: "relation",
          positionKey: "c",
          state: "active",
          config: { cardinality: "many" },
        },
      ],
      views: createdBody.database.definition.views.map((view) => ({
        ...view,
        properties: [
          ...view.properties,
          { propertyId: textPropertyId, visible: true, positionKey: "b" },
          { propertyId: relationPropertyId, visible: true, positionKey: "c" },
        ],
      })),
    };
    const replaced = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/databases/${databaseId}/definition`,
      headers: idempotencyHeaders(),
      payload: { baseRevisionId: createdBody.database.definitionRevisionId, definition },
    });
    expect(replaced.statusCode, replaced.body).toBe(200);

    const target = await createItemViaApi(harness, { kind: "page", name: "Export target" });
    const entryId = generateUuidV7();
    const sentinel = "structured-export-sentinel";
    const entry = await harness.built.app.inject({
      method: "POST",
      url: `/v1/databases/${databaseId}/entries`,
      headers: idempotencyHeaders(),
      payload: {
        id: entryId,
        title: "Export entry",
        placement: { id: generateUuidV7(), parentItemId: databaseId, positionKey: "a" },
        values: { [textPropertyId]: { kind: "text", value: sentinel } },
        relationTargets: { [relationPropertyId]: [target.itemId] },
      },
    });
    expect(entry.statusCode, entry.body).toBe(201);

    const { manifest, digest } = await exportArtifact();
    expect(validateCanonicalExport(manifest)).toEqual([]);
    expect(manifest.counts.databases).toBe(manifest.databases.length);
    expect(manifest.counts.databaseEntries).toBe(manifest.databaseEntries.length);
    expect(manifest.databases.find((row) => row.databaseId === databaseId)?.definition).toEqual(
      definition,
    );
    expect(
      manifest.databaseEntries.find((row) => row.entryId === entryId)?.values.values[
        textPropertyId
      ],
    ).toEqual({ kind: "text", value: sentinel });
    expect(manifest.relationships).toContainEqual(
      expect.objectContaining({
        sourceItemId: entryId,
        targetItemId: target.itemId,
        relationType: "database:property",
        metadata: expect.objectContaining({ databaseId, propertyId: relationPropertyId }),
      }),
    );
    expect(createHash("sha256").update(canonicalExportString(manifest)).digest("hex")).toBe(digest);
  });
});

describe("export status and artifacts", () => {
  it("reports a pending job without a digest or download path", async () => {
    const exportId = generateUuidV7();
    await harness.built.context.db.insert(schema.exports).values({
      id: exportId,
      workspaceId: harness.built.context.workspaceId,
      status: "pending",
    });
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${exportId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ exportId, status: "pending" });
  });

  it("returns a not-found problem for an unknown export", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${generateUuidV7()}`,
    });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe("item.not-found");
  });

  it("refuses the artifact until a verified manifest is stored", async () => {
    const pendingId = generateUuidV7();
    const readyWithoutManifestId = generateUuidV7();
    await harness.built.context.db.insert(schema.exports).values([
      {
        id: pendingId,
        workspaceId: harness.built.context.workspaceId,
        status: "pending",
      },
      {
        id: readyWithoutManifestId,
        workspaceId: harness.built.context.workspaceId,
        status: "ready",
        ready: true,
        digest: "abc",
        manifest: null,
      },
    ]);
    const pending = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${pendingId}/artifact`,
    });
    expect(pending.statusCode).toBe(404);
    const missingManifest = await harness.built.app.inject({
      method: "GET",
      url: `/v1/export/${readyWithoutManifestId}/artifact`,
    });
    expect(missingManifest.statusCode).toBe(404);
  });
});
