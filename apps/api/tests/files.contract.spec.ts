/**
 * Import, placement, and file-content replacement contract tests (T052, US2).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  createApiHarness,
  createItemViaApi,
  idempotencyHeaders,
  type ApiHarness,
} from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

function multipartBody(
  fields: Record<string, string>,
  file: { name: string; type: string; content: string },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----test-${generateUuidV7()}`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\ncontent-disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
    );
  }
  parts.push(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file.name}"\r\ncontent-type: ${file.type}\r\n\r\n${file.content}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.from(parts.join(""), "utf8"),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function importFile(
  name: string,
  content: string,
  placement: { kind: string; parentItemId: string | null; positionKey: string },
): Promise<{ itemId: Uuid; revisionId: Uuid; placementId: Uuid; status: number }> {
  const { payload, headers } = multipartBody(
    { placement: JSON.stringify(placement) },
    { name, type: "text/plain", content },
  );
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/files",
    headers: { ...headers, ...idempotencyHeaders() },
    payload,
  });
  const body = response.json() as {
    revisionIds?: string[];
    item?: { id: string; placements: Array<{ id: string }> };
  };
  return {
    status: response.statusCode,
    itemId: (body.item?.id ?? "") as Uuid,
    revisionId: (body.revisionIds?.[0] ?? "") as Uuid,
    placementId: (body.item?.placements[0]?.id ?? "") as Uuid,
  };
}

describe("file import (T059)", () => {
  it("imports a file into the hierarchy (201)", async () => {
    const result = await importFile("hello.txt", "hello bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "F1x",
    });
    expect(result.status).toBe(201);
    const item = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${result.itemId}`,
    });
    const body = item.json() as { kind: string; name: string };
    expect(body.kind).toBe("file");
    expect(body.name).toBe("hello.txt");
  });

  it("imports an attachment into a page and keeps it out of the tree", async () => {
    const page = await createItemViaApi(harness, { kind: "page", name: "Attachment host" });
    const result = await importFile("attached.txt", "attachment bytes", {
      kind: "attachment",
      parentItemId: page.itemId,
      positionKey: "A1x",
    });
    expect(result.status).toBe(201);
    // Hierarchy children of the page do not include the attachment.
    const children = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items?parentItemId=${page.itemId}`,
    });
    const childIds = (children.json() as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );
    expect(childIds).not.toContain(result.itemId);
    // But the item itself shows the attachment placement.
    const item = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${result.itemId}`,
    });
    const placements = (item.json() as { placements: Array<{ kind: string }> }).placements;
    expect(placements[0]?.kind).toBe("attachment");
  });

  it("identical bytes imported twice stay independent logical files (FR-034)", async () => {
    const first = await importFile("dup.txt", "duplicated bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "D1x",
    });
    const second = await importFile("dup.txt", "duplicated bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "D2x",
    });
    expect(first.itemId).not.toBe(second.itemId);
  });

  it("rejects an import without file part (400)", async () => {
    const boundary = `----test-${generateUuidV7()}`;
    const payload = Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="placement"\r\n\r\n{}\r\n--${boundary}--\r\n`,
    );
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/files",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        ...idempotencyHeaders(),
      },
      payload,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("multi-placement resolution (FR-028..FR-031)", () => {
  it("adds placements resolving to the same logical file, then removes one", async () => {
    const pageA = await createItemViaApi(harness, { kind: "page", name: "Place A" });
    const pageB = await createItemViaApi(harness, { kind: "page", name: "Place B" });
    const file = await importFile("multi.txt", "multi-placement bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "M1x",
    });

    const attach = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${file.itemId}/placements`,
      headers: idempotencyHeaders(),
      payload: { kind: "attachment", parentItemId: pageA.itemId, positionKey: "M2x" },
    });
    expect(attach.statusCode).toBe(201);
    const attach2 = await harness.built.app.inject({
      method: "POST",
      url: `/v1/items/${file.itemId}/placements`,
      headers: idempotencyHeaders(),
      payload: { kind: "attachment", parentItemId: pageB.itemId, positionKey: "M3x" },
    });
    expect(attach2.statusCode).toBe(201);

    const item = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${file.itemId}`,
    });
    const placements = (item.json() as { placements: Array<{ id: string }> }).placements;
    expect(placements.length).toBe(3);

    const removal = await harness.built.app.inject({
      method: "DELETE",
      url: `/v1/placements/${placements[1]?.id}`,
      headers: idempotencyHeaders(),
    });
    expect(removal.statusCode).toBe(200);
    const after = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${file.itemId}`,
    });
    const remaining = after.json() as { lifecycle: string; placements: unknown[] };
    expect(remaining.lifecycle).toBe("active");
    expect(remaining.placements.length).toBe(2);
  });
});

describe("copy-on-write content replacement (FR-030/FR-036)", () => {
  it("replaces content once for every placement of one logical file only", async () => {
    const original = await importFile("original.txt", "original bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "C1x",
    });
    const independent = await importFile("independent.txt", "original bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "C2x",
    });

    const { payload, headers } = multipartBody(
      { baseRevisionId: original.revisionId },
      { name: "updated.txt", type: "text/plain", content: "updated bytes" },
    );
    const replacement = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/files/${original.itemId}/content`,
      headers: { ...headers, ...idempotencyHeaders() },
      payload,
    });
    expect(replacement.statusCode).toBe(200);

    const updated = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${original.itemId}`,
    });
    const updatedRevision = (updated.json() as { currentRevisionId: string }).currentRevisionId;
    expect(updatedRevision).not.toBe(original.revisionId);

    // The independently imported file is untouched.
    const other = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${independent.itemId}`,
    });
    expect((other.json() as { currentRevisionId: string }).currentRevisionId).toBe(
      independent.revisionId,
    );
  });

  it("a stale base yields a structured conflict (409)", async () => {
    const file = await importFile("stale.txt", "stale base bytes", {
      kind: "hierarchy",
      parentItemId: null,
      positionKey: "S1x",
    });
    const first = multipartBody(
      { baseRevisionId: file.revisionId },
      { name: "v2.txt", type: "text/plain", content: "v2" },
    );
    await harness.built.app.inject({
      method: "PUT",
      url: `/v1/files/${file.itemId}/content`,
      headers: { ...first.headers, ...idempotencyHeaders() },
      payload: first.payload,
    });
    const second = multipartBody(
      { baseRevisionId: file.revisionId },
      { name: "v3.txt", type: "text/plain", content: "v3" },
    );
    const conflict = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/files/${file.itemId}/content`,
      headers: { ...second.headers, ...idempotencyHeaders() },
      payload: second.payload,
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json() as { code: string; competingRevisionIds?: string[] };
    expect(body.code).toBe("revision.stale-base");
    expect(body.competingRevisionIds?.length).toBe(1);
  });
});
