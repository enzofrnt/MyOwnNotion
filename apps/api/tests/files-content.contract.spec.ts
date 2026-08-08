import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { schema } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FILE_STORAGE_FIXTURE } from "../../../tests/fixtures/workspace.ts";
import { type ApiHarness, createApiHarness, idempotencyHeaders } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

function multipartFile(input: {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----files-content-${generateUuidV7()}`;
  const placement = JSON.stringify({
    kind: "hierarchy",
    parentItemId: null,
    positionKey: `F${generateUuidV7().slice(-8)}`,
  });
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="placement"\r\n\r\n${placement}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${input.name}"\r\ncontent-type: ${input.mediaType}\r\n\r\n`,
    ),
    Buffer.from(input.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function importFixture(
  fixture: (typeof FILE_STORAGE_FIXTURE)[keyof typeof FILE_STORAGE_FIXTURE],
): Promise<{ itemId: Uuid; revisionId: Uuid; placementId: Uuid }> {
  const multipart = multipartFile(fixture);
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/files",
    headers: { ...multipart.headers, ...idempotencyHeaders() },
    payload: multipart.payload,
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as {
    item: { id: string; placements: Array<{ id: string }> };
    revisionIds: string[];
  };
  return {
    itemId: body.item.id as Uuid,
    revisionId: body.revisionIds[0] as Uuid,
    placementId: body.item.placements[0]?.id as Uuid,
  };
}

function contentUrl(file: { itemId: Uuid; revisionId: Uuid }): string {
  return `/v1/files/${file.itemId}/content?revisionId=${file.revisionId}`;
}

async function storagePath(itemId: Uuid): Promise<string> {
  const files = await harness.built.context.db
    .select()
    .from(schema.logicalFiles)
    .where(eq(schema.logicalFiles.itemId, itemId));
  const contentId = files[0]?.contentId;
  const contents = await harness.built.context.db
    .select()
    .from(schema.fileContents)
    .where(eq(schema.fileContents.id, contentId as string));
  const key = contents[0]?.storageKey;
  if (key === undefined) throw new Error("test content is missing");
  return path.join(harness.blobRoot, key.slice(0, 2), key);
}

describe("revision-qualified file content", () => {
  it("returns exact HEAD metadata and a complete safe raster response", async () => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.image);
    const itemResponse = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${file.itemId}`,
    });
    expect(itemResponse.json()).toMatchObject({
      file: {
        mediaType: "image/png",
        byteLength: FILE_STORAGE_FIXTURE.image.bytes.byteLength,
        sha256: FILE_STORAGE_FIXTURE.image.sha256,
        cacheEligibility: true,
      },
    });
    expect(itemResponse.body).not.toContain("storageKey");
    const head = await harness.built.app.inject({ method: "HEAD", url: contentUrl(file) });
    expect(head.statusCode).toBe(200);
    expect(head.rawPayload.byteLength).toBe(0);
    expect(head.headers).toMatchObject({
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=31536000, immutable",
      "content-length": String(FILE_STORAGE_FIXTURE.image.bytes.byteLength),
      "content-type": "image/png",
      "x-content-id": expect.any(String),
      "x-content-sha256": FILE_STORAGE_FIXTURE.image.sha256,
      "x-content-type-options": "nosniff",
      "x-file-revision-id": file.revisionId,
      etag: `"${FILE_STORAGE_FIXTURE.image.sha256}"`,
    });
    expect(head.headers["content-disposition"]).toContain("inline;");
    expect(head.headers["content-disposition"]).not.toContain("storage");

    const full = await harness.built.app.inject({ method: "GET", url: contentUrl(file) });
    expect(full.statusCode).toBe(200);
    expect(new Uint8Array(full.rawPayload)).toEqual(FILE_STORAGE_FIXTURE.image.bytes);
    expect(full.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
  });

  it.each([
    ["closed", "bytes=10-19", 10, 19],
    ["open-ended", "bytes=250-", 250, 255],
    ["suffix", "bytes=-6", 250, 255],
  ])("serves one %s range with exact bounds", async (_label, range, start, end) => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.range);
    const response = await harness.built.app.inject({
      method: "GET",
      url: contentUrl(file),
      headers: { range },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes ${start}-${end}/256`);
    expect(response.headers["content-length"]).toBe(String(end - start + 1));
    expect(new Uint8Array(response.rawPayload)).toEqual(
      FILE_STORAGE_FIXTURE.range.bytes.slice(start, end + 1),
    );
  });

  it.each([
    ["bytes=invalid", 400, "file.range-invalid"],
    ["items=0-1", 400, "file.range-invalid"],
    ["bytes=0-1,4-5", 400, "file.range-multiple-not-supported"],
    ["bytes=999-1000", 416, "file.range-unsatisfiable"],
  ])("rejects range %s predictably", async (range, status, code) => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.range);
    const response = await harness.built.app.inject({
      method: "GET",
      url: contentUrl(file),
      headers: { range },
    });
    expect(response.statusCode).toBe(status);
    expect((response.json() as { code: string }).code).toBe(code);
    if (status === 416) expect(response.headers["content-range"]).toBe("bytes */256");
  });

  it("rejects missing, invalid, and stale revision identities", async () => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.document);
    const missing = await harness.built.app.inject({
      method: "GET",
      url: `/v1/files/${file.itemId}/content`,
    });
    expect(missing.statusCode).toBe(400);
    const invalid = await harness.built.app.inject({
      method: "GET",
      url: `/v1/files/${file.itemId}/content?revisionId=invalid`,
    });
    expect(invalid.statusCode).toBe(400);
    const stale = await harness.built.app.inject({
      method: "GET",
      url: `/v1/files/${file.itemId}/content?revisionId=${generateUuidV7()}`,
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { code: string }).code).toBe("file.stale-revision");
  });

  it("refuses trashed content without substituting bytes", async () => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.document);
    const trash = await harness.built.app.inject({
      method: "DELETE",
      url: `/v1/placements/${file.placementId}`,
      headers: idempotencyHeaders(),
    });
    expect(trash.statusCode).toBe(200);
    const current = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${file.itemId}`,
    });
    const trashedRevisionId = (current.json() as { currentRevisionId: Uuid }).currentRevisionId;
    const response = await harness.built.app.inject({
      method: "GET",
      url: contentUrl({ ...file, revisionId: trashedRevisionId }),
    });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe("file.content-unavailable");
  });

  it.each(["corrupt", "missing"])("fails closed for %s physical content", async (fault) => {
    const file = await importFixture(FILE_STORAGE_FIXTURE.document);
    const objectPath = await storagePath(file.itemId);
    if (fault === "corrupt") {
      await writeFile(objectPath, Buffer.from("different private bytes"));
    } else {
      await rm(objectPath);
    }
    const response = await harness.built.app.inject({ method: "GET", url: contentUrl(file) });
    expect(response.statusCode).toBe(502);
    expect(response.rawPayload.toString("utf8")).not.toContain("different private bytes");
    expect((response.json() as { code: string }).code).toBe(
      fault === "corrupt" ? "file.integrity-failed" : "storage.unavailable",
    );
  });
});
