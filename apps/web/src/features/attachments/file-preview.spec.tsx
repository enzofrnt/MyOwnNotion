import type { FileContentMetadataDto } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentApi } from "../../services/content-api.ts";
import { type FilePreviewState, FilePreviewView } from "./file-preview.tsx";

const ITEM_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd7" as Uuid;
const REVISION_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd8" as Uuid;
const CONTENT_ID = "019c3e8e-3140-7a75-af40-7a4b74df0dd9" as const;

const metadata: FileContentMetadataDto = {
  itemId: ITEM_ID,
  revisionId: REVISION_ID,
  contentId: CONTENT_ID,
  name: "preview.png",
  mediaType: "image/png",
  byteLength: 68,
  sha256: "a".repeat(64),
  disposition: "inline",
  cacheEligibility: true,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function markup(state: FilePreviewState): string {
  return renderToStaticMarkup(
    <FilePreviewView
      name="preview.png"
      downloadUrl={`/v1/files/${ITEM_ID}/content?revisionId=${REVISION_ID}`}
      state={state}
    />,
  );
}

describe("file preview states", () => {
  it("shows labelled safe-raster metadata, preview, and download actions", () => {
    const html = markup({ kind: "available", metadata, source: "network", previewUrl: null });
    expect(html).toContain("Metadata for preview.png");
    expect(html).toContain("image/png");
    expect(html).toContain("68 B");
    expect(html).toContain("aaaaaaaaaaaa…");
    expect(html).toContain("Preview preview.png");
    expect(html).toContain("Download preview.png");
    expect(html).not.toContain("storageKey");
  });

  it("distinguishes cached, online-only, stale, and unavailable states", () => {
    expect(
      markup({ kind: "available", metadata, source: "offline-cache", previewUrl: "blob:cached" }),
    ).toContain("Cached revision — available offline");
    expect(
      markup({
        kind: "available",
        metadata: { ...metadata, byteLength: 17 * 1024 * 1024, cacheEligibility: false },
        source: "network",
        previewUrl: null,
      }),
    ).toContain("Available online only");
    const problem = {
      type: "about:blank",
      title: "Unavailable",
      status: 409,
      code: "file.stale-revision",
    };
    expect(markup({ kind: "unavailable", reason: "stale", problem })).toContain(
      "a newer file revision exists",
    );
    expect(markup({ kind: "unavailable", reason: "not-cached", problem })).toContain(
      "was not cached",
    );
  });
});

describe("typed file-content client", () => {
  it("builds immutable URLs and parses exact public HEAD metadata", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: {
            "content-disposition": "inline; filename=\"preview.png\"; filename*=UTF-8''preview.png",
            "content-length": "68",
            "content-type": "image/png",
            "x-content-id": CONTENT_ID,
            "x-content-sha256": "a".repeat(64),
            "x-file-revision-id": REVISION_ID,
          },
        }),
    ) as typeof fetch;
    const api = new ContentApi("http://127.0.0.1:3001/");
    expect(api.fileContentUrl(ITEM_ID, REVISION_ID)).toBe(
      `http://127.0.0.1:3001/v1/files/${ITEM_ID}/content?revisionId=${REVISION_ID}`,
    );
    await expect(api.inspectFileContent(ITEM_ID, REVISION_ID, "fallback.png")).resolves.toEqual({
      ok: true,
      value: metadata,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining(REVISION_ID), {
      method: "HEAD",
    });
  });

  it("rejects incomplete metadata without accepting a private locator", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "x-storage-key": "private/key", "content-length": "68" },
        }),
    ) as typeof fetch;
    const result = await new ContentApi().inspectFileContent(ITEM_ID, REVISION_ID, "fallback.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe("file.integrity-failed");
    expect(JSON.stringify(result)).not.toContain("private/key");
  });
});
