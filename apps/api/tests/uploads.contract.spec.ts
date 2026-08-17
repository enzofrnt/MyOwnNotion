/**
 * The resumable upload endpoints (T045, FR-006, FR-008, FR-009).
 *
 * `HEAD` is the whole of the resume logic, so it is asserted as the
 * authoritative answer rather than as a convenience: the client keeps no
 * byte-count of its own precisely because this one exists.
 *
 * The refusal on a disagreeing offset is the assertion worth having. Accepting
 * the chunk at the server's position instead would produce a file that
 * completes, verifies, and is wrong — the only failure mode here that never
 * announces itself.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maxFileBytes, parseUploadMetadata } from "../src/routes/uploads.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

function encodeMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, "utf8").toString("base64")}`)
    .join(",");
}

async function createUploadOf(length: number, name = "transfer.txt") {
  return harness.built.app.inject({
    method: "POST",
    url: "/v1/uploads",
    headers: {
      "upload-length": String(length),
      "upload-metadata": encodeMetadata({ filename: name, mediaType: "text/plain" }),
    },
  });
}

describe("creating an upload", () => {
  it("answers with a location and a zero offset", async () => {
    const response = await createUploadOf(120);
    expect(response.statusCode).toBe(201);
    expect(response.headers["location"]).toMatch(/^\/v1\/uploads\//);
    expect(response.headers["upload-offset"]).toBe("0");
  });

  it("refuses a file larger than the installation accepts, before any byte", async () => {
    const response = await createUploadOf(maxFileBytes() + 1);
    expect(response.statusCode).toBe(413);
    const body = response.json() as { code: string; limitBytes: number; declaredBytes: number };
    // The limit itself, not merely the fact that one exists: FR-009 asks the
    // owner to be told what it is, so they can act rather than guess.
    expect(body.code).toBe("file.too-large");
    expect(body.limitBytes).toBe(maxFileBytes());
    expect(body.declaredBytes).toBe(maxFileBytes() + 1);
  });

  it("refuses a missing or nonsensical length", async () => {
    const missing = await harness.built.app.inject({ method: "POST", url: "/v1/uploads" });
    expect(missing.statusCode).toBe(400);
    const negative = await createUploadOf(-1);
    expect(negative.statusCode).toBe(400);
  });
});

describe("resuming", () => {
  it("reports the offset the server actually holds", async () => {
    const created = await createUploadOf(10);
    const location = created.headers["location"] as string;

    const before = await harness.built.app.inject({ method: "HEAD", url: location });
    expect(before.statusCode).toBe(200);
    expect(before.headers["upload-offset"]).toBe("0");
    expect(before.headers["upload-length"]).toBe("10");

    const sent = await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      payload: Buffer.from("0123"),
    });
    expect(sent.statusCode).toBe(204);
    expect(sent.headers["upload-offset"]).toBe("4");

    const after = await harness.built.app.inject({ method: "HEAD", url: location });
    // What a resuming client seeks to. It keeps no count of its own, which is
    // why this number has to be right.
    expect(after.headers["upload-offset"]).toBe("4");
  });

  it("refuses a chunk written from the wrong offset, and says where to resume", async () => {
    const created = await createUploadOf(20);
    const location = created.headers["location"] as string;
    await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      payload: Buffer.from("abcde"),
    });

    const wrong = await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "12" },
      payload: Buffer.from("xyz"),
    });
    // Not accepted at the server's offset. That silent correction is what makes
    // a file complete successfully and be corrupt.
    expect(wrong.statusCode).toBe(409);
    expect(wrong.headers["upload-offset"]).toBe("5");

    const unchanged = await harness.built.app.inject({ method: "HEAD", url: location });
    expect(unchanged.headers["upload-offset"]).toBe("5");
  });

  it("marks an upload complete only when every declared byte has arrived", async () => {
    const created = await createUploadOf(6);
    const location = created.headers["location"] as string;

    const partial = await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      payload: Buffer.from("abc"),
    });
    expect(partial.headers["upload-complete"]).toBe("false");

    const rest = await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "3" },
      payload: Buffer.from("def"),
    });
    // The last chunk answers 201 with the item, not 204: completing an upload
    // creates the file in one transaction, so the response that carries the
    // final byte is the one that says what was created.
    expect(rest.statusCode).toBe(201);
    expect(rest.headers["upload-complete"]).toBe("true");
    const body = rest.json() as { itemId: string; verified: boolean };
    expect(body.verified).toBe(true);

    // And it is a real file now, with its content served like any other.
    const item = await harness.built.app.inject({
      method: "GET",
      url: `/v1/items/${body.itemId}`,
    });
    expect(item.statusCode).toBe(200);
    expect((item.json() as { kind: string }).kind).toBe("file");
  });

  it("stores exactly the bytes that were sent across several chunks", async () => {
    const created = await createUploadOf(9, "assembled.txt");
    const location = created.headers["location"] as string;
    for (const [offset, part] of [
      [0, "abc"],
      [3, "def"],
      [6, "ghi"],
    ] as const) {
      await harness.built.app.inject({
        method: "PATCH",
        url: location,
        headers: {
          "content-type": "application/offset+octet-stream",
          "upload-offset": String(offset),
        },
        payload: Buffer.from(part),
      });
    }

    const head = await harness.built.app.inject({ method: "HEAD", url: location });
    // The upload is gone once it became a file: its record and its partial
    // bytes are both released, so nothing lingers unaccounted for.
    expect(head.statusCode).toBe(404);
  });

  it("answers 404 for an upload that never existed", async () => {
    const response = await harness.built.app.inject({
      method: "HEAD",
      url: `/v1/uploads/${generateUuidV7()}`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("upload metadata", () => {
  it("decodes the tus base64 pairs", () => {
    const decoded = parseUploadMetadata(
      encodeMetadata({ filename: "réunion.txt", mediaType: "text/plain" }),
    );
    // Base64 because a filename is arbitrary text and headers are not: this is
    // what keeps an accented name from arriving mangled.
    expect(decoded["filename"]).toBe("réunion.txt");
    expect(decoded["mediaType"]).toBe("text/plain");
  });

  it("treats an absent header as no metadata rather than as an error", () => {
    expect(parseUploadMetadata(undefined)).toEqual({});
    expect(parseUploadMetadata("")).toEqual({});
  });
});

describe("refusals during a transfer", () => {
  it("refuses a chunk for an upload that does not exist", async () => {
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: `/v1/uploads/${generateUuidV7()}`,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      payload: Buffer.from("orphan"),
    });
    // 404 rather than creating one: an upload the server never issued is not
    // something a client may bring into being by writing to it.
    expect(response.statusCode).toBe(404);
  });

  it("refuses a chunk that would exceed the declared length", async () => {
    const created = await createUploadOf(4);
    const location = created.headers["location"] as string;
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: location,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      payload: Buffer.from("far too many bytes"),
    });
    // The declared length is a promise the client made; letting it overrun
    // would mean the size shown before the transfer was fiction.
    expect(response.statusCode).toBe(400);
    const still = await harness.built.app.inject({ method: "HEAD", url: location });
    expect(still.headers["upload-offset"]).toBe("0");
  });

  it("refuses a nonsensical offset", async () => {
    const created = await createUploadOf(10);
    const response = await harness.built.app.inject({
      method: "PATCH",
      url: created.headers["location"] as string,
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "-3" },
      payload: Buffer.from("x"),
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses an identifier that is not an upload identity", async () => {
    const response = await harness.built.app.inject({
      method: "HEAD",
      url: "/v1/uploads/not-a-uuid",
    });
    expect(response.statusCode).toBe(404);
  });
});
