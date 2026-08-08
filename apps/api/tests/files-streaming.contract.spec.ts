import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, idempotencyHeaders } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

function multipart(input: {
  readonly fields: Readonly<Record<string, string>>;
  readonly name: string;
  readonly mediaType?: string;
  readonly bytes: Uint8Array;
}): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----streaming-${generateUuidV7()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(input.fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${input.name}"\r\ncontent-type: ${input.mediaType ?? "application/octet-stream"}\r\n\r\n`,
    ),
    Buffer.from(input.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function hierarchyPlacement(parentItemId: Uuid | null = null): string {
  return JSON.stringify({ kind: "hierarchy", parentItemId, positionKey: "V" });
}

async function importFile(bytes: Uint8Array): Promise<{ itemId: Uuid; revisionId: Uuid }> {
  const body = multipart({
    fields: { placement: hierarchyPlacement() },
    name: "stream.bin",
    bytes,
  });
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/files",
    headers: { ...body.headers, ...idempotencyHeaders() },
    payload: body.payload,
  });
  expect(response.statusCode).toBe(201);
  const result = response.json() as { item: { id: Uuid }; revisionIds: Uuid[] };
  return { itemId: result.item.id, revisionId: result.revisionIds[0] as Uuid };
}

describe("bounded streaming file ingest", () => {
  it("uses the multipart byte stream directly and never calls toBuffer", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../src/routes/files.ts"),
      "utf8",
    );
    expect(source).toContain("part.file");
    expect(source).not.toContain(".toBuffer()");
  });

  it("accepts a zero-byte immutable file", async () => {
    const file = await importFile(new Uint8Array());
    const head = await harness.built.app.inject({
      method: "HEAD",
      url: `/v1/files/${file.itemId}/content?revisionId=${file.revisionId}`,
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-length"]).toBe("0");
  });

  it("removes its newly persisted object when the canonical transaction is rejected", async () => {
    const before = await harness.built.context.contentStore.blobStore.list();
    const unique = new TextEncoder().encode(`rejected-${generateUuidV7()}`);
    const body = multipart({
      fields: { placement: hierarchyPlacement(generateUuidV7()) },
      name: "rejected.bin",
      bytes: unique,
    });
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/files",
      headers: { ...body.headers, ...idempotencyHeaders() },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(409);
    expect(await harness.built.context.contentStore.blobStore.list()).toEqual(before);
  });

  it("cleans persisted bytes when a multipart field is invalid", async () => {
    const before = await harness.built.context.contentStore.blobStore.list();
    const body = multipart({
      fields: { placement: "not-json" },
      name: "invalid-field.bin",
      bytes: new TextEncoder().encode(`invalid-${generateUuidV7()}`),
    });
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/files",
      headers: { ...body.headers, ...idempotencyHeaders() },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(await harness.built.context.contentStore.blobStore.list()).toEqual(before);
  });

  it("cleans temporary bytes when the multipart source aborts", async () => {
    const before = await harness.built.context.contentStore.blobStore.list();
    const boundary = `----aborted-${generateUuidV7()}`;
    async function* abortedBody(): AsyncIterable<Uint8Array> {
      yield Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="placement"\r\n\r\n${hierarchyPlacement()}\r\n` +
          `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="aborted.bin"\r\ncontent-type: application/octet-stream\r\n\r\n`,
      );
      yield Buffer.alloc(1024, 3);
      throw new Error("client upload aborted");
    }
    await expect(
      harness.built.app.inject({
        method: "POST",
        url: "/v1/files",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          ...idempotencyHeaders(),
        },
        payload: Readable.from(abortedBody()),
      }),
    ).rejects.toThrow("client upload aborted");
    expect(await harness.built.context.contentStore.blobStore.list()).toEqual(before);
  });

  it("reuses byte-equal physical content while preserving independent logical files", async () => {
    const bytes = new TextEncoder().encode(`shared-${generateUuidV7()}`);
    const before = (await harness.built.context.contentStore.blobStore.list()).length;
    const first = await importFile(bytes);
    const second = await importFile(bytes);
    expect(second.itemId).not.toBe(first.itemId);
    expect(second.revisionId).not.toBe(first.revisionId);
    expect((await harness.built.context.contentStore.blobStore.list()).length).toBe(before + 1);
  });

  it("replays replacement idempotently without creating another object or revision", async () => {
    const file = await importFile(new TextEncoder().encode("original"));
    const mutationId = generateUuidV7();
    const replacementBytes = new TextEncoder().encode(`replacement-${generateUuidV7()}`);
    const makeBody = () =>
      multipart({
        fields: { baseRevisionId: file.revisionId },
        name: "stream.bin",
        bytes: replacementBytes,
      });
    const firstBody = makeBody();
    const first = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/files/${file.itemId}/content`,
      headers: { ...firstBody.headers, ...idempotencyHeaders(mutationId) },
      payload: firstBody.payload,
    });
    expect(first.statusCode).toBe(200);
    const firstResult = first.json() as { revisionIds: string[] };
    const objectCount = (await harness.built.context.contentStore.blobStore.list()).length;

    const replayBody = makeBody();
    const replay = await harness.built.app.inject({
      method: "PUT",
      url: `/v1/files/${file.itemId}/content`,
      headers: { ...replayBody.headers, ...idempotencyHeaders(mutationId) },
      payload: replayBody.payload,
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { revisionIds: string[] }).revisionIds).toEqual(
      firstResult.revisionIds,
    );
    expect((await harness.built.context.contentStore.blobStore.list()).length).toBe(objectCount);
  });
});
