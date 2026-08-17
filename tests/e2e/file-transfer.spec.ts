/**
 * An interrupted transfer resumes (T052, US1, FR-006).
 *
 * Driven through the API rather than the attachment control, deliberately. What
 * is being asserted is the protocol behaviour an owner depends on — that the
 * server's offset survives an interruption and that a half-sent file is not a
 * file — and the interface's upload control still uses the single-request path.
 * Testing through it would assert the old path and quietly claim the new one.
 *
 * `validation.md` records that boundary rather than letting this file imply
 * more than it checks.
 */

import { expect, test } from "./fixtures.ts";
import { openWorkspace, uniqueName } from "./helpers.ts";

const API = "http://127.0.0.1:3001";

function metadata(filename: string): string {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
  return `filename ${encode(filename)},mediaType ${encode("text/plain")}`;
}

test.describe("a transfer that is interrupted", () => {
  test("continues from the offset the server holds, not from zero", async ({ request }) => {
    const name = `${uniqueName("resumed")}.txt`;
    const body = "abcdefghijklmnopqrst";

    const created = await request.post(`${API}/v1/uploads`, {
      headers: { "upload-length": String(body.length), "upload-metadata": metadata(name) },
    });
    expect(created.status()).toBe(201);
    const location = created.headers()["location"];

    // First half arrives, then the transfer "stops".
    const first = await request.patch(`${API}${location}`, {
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      data: Buffer.from(body.slice(0, 8)),
    });
    expect(first.status()).toBe(204);

    // A resuming client asks where to continue. This number is the whole of the
    // resume logic, which is why it is asserted rather than assumed.
    const head = await request.head(`${API}${location}`);
    expect(head.headers()["upload-offset"]).toBe("8");

    const rest = await request.patch(`${API}${location}`, {
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "8" },
      data: Buffer.from(body.slice(8)),
    });
    // The last chunk creates the file, so the response carrying it says what
    // was created.
    expect(rest.status()).toBe(201);
    const created2 = (await rest.json()) as { itemId: string; verified: boolean };
    expect(created2.verified).toBe(true);

    // And the file holds exactly what was sent, across the interruption.
    const content = await request.get(`${API}/v1/files/${created2.itemId}/content`);
    expect(await content.text()).toBe(body);
  });

  test("refuses a chunk from the wrong offset instead of accepting it silently", async ({
    request,
  }) => {
    const created = await request.post(`${API}/v1/uploads`, {
      headers: { "upload-length": "10", "upload-metadata": metadata("mismatch.txt") },
    });
    const location = created.headers()["location"];
    await request.patch(`${API}${location}`, {
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      data: Buffer.from("abc"),
    });

    const wrong = await request.patch(`${API}${location}`, {
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "7" },
      data: Buffer.from("xyz"),
    });
    // Accepting this at the server's position is what makes a file complete,
    // verify, and be corrupt.
    expect(wrong.status()).toBe(409);
    expect(wrong.headers()["upload-offset"]).toBe("3");
  });

  test("a partial transfer never appears in the tree", async ({ page, request }) => {
    const name = `${uniqueName("halfsent")}.txt`;
    const created = await request.post(`${API}/v1/uploads`, {
      headers: { "upload-length": "20", "upload-metadata": metadata(name) },
    });
    const location = created.headers()["location"];
    await request.patch(`${API}${location}`, {
      headers: { "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      data: Buffer.from("only half of it"),
    });

    await openWorkspace(page);
    // Half a file is not a file. The upload owns no item and no placement until
    // it completes, so this is a property of the model rather than a filter
    // somewhere in the tree.
    await expect(page.getByTestId(`tree-item-${name}`)).toHaveCount(0);
  });

  test("states the limit when a file is too large, before sending anything", async ({
    request,
  }) => {
    const created = await request.post(`${API}/v1/uploads`, {
      headers: {
        // Larger than any configured maximum could reasonably be.
        "upload-length": String(9_999_999_999),
        "upload-metadata": metadata("enormous.bin"),
      },
    });
    expect(created.status()).toBe(413);
    const problem = (await created.json()) as { code: string; limitBytes: number };
    // FR-009: the limit itself, so an owner can act rather than guess.
    expect(problem.code).toBe("file.too-large");
    expect(problem.limitBytes).toBeGreaterThan(0);
  });
});
