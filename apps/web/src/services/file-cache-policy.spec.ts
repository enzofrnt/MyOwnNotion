import { describe, expect, it } from "vitest";
import { admitCompleteFileResponse, isRevisionQualifiedFileRequest } from "./file-cache-policy.ts";

const ITEM_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7";
const REVISION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd8";
const CONTENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd9";

function request(url: string, range?: string): { url: URL; request: Request } {
  return {
    url: new URL(url),
    request: new Request(url, { ...(range === undefined ? {} : { headers: { range } }) }),
  };
}

function response(overrides: Record<string, string> = {}, status = 200): Response {
  return new Response(new Uint8Array(68), {
    status,
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-length": "68",
      "x-content-id": CONTENT_ID,
      "x-content-sha256": "a".repeat(64),
      "x-file-revision-id": REVISION_ID,
      ...overrides,
    },
  });
}

describe("immutable file revision cache admission", () => {
  it("matches only one exact revision-qualified complete GET", () => {
    expect(
      isRevisionQualifiedFileRequest(
        request(`https://app.local/v1/files/${ITEM_ID}/content?revisionId=${REVISION_ID}`),
      ),
    ).toBe(true);
    expect(
      isRevisionQualifiedFileRequest(request(`https://app.local/v1/files/${ITEM_ID}/content`)),
    ).toBe(false);
    expect(
      isRevisionQualifiedFileRequest(
        request(
          `https://app.local/v1/files/${ITEM_ID}/content?revisionId=${REVISION_ID}`,
          "bytes=0-9",
        ),
      ),
    ).toBe(false);
    expect(
      isRevisionQualifiedFileRequest(
        request(`https://app.local/v1/files/${ITEM_ID}/content?revisionId=${REVISION_ID}&other=1`),
      ),
    ).toBe(false);
  });

  it("admits only complete verified immutable responses up to 16 MiB", () => {
    expect(admitCompleteFileResponse(response())).toBe(true);
    expect(
      admitCompleteFileResponse(response({ "content-length": String(17 * 1024 * 1024) })),
    ).toBe(false);
    expect(admitCompleteFileResponse(response({ "content-range": "bytes 0-9/68" }, 206))).toBe(
      false,
    );
    expect(admitCompleteFileResponse(response({ "x-content-sha256": "invalid" }))).toBe(false);
    expect(admitCompleteFileResponse(response({ "cache-control": "no-store" }))).toBe(false);
  });
});
