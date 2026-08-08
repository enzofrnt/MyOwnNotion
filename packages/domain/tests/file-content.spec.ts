import {
  cacheAdmissionForFile,
  contentDispositionForFile,
  isSafeInlineMediaType,
  parseSingleByteRange,
  sanitizeDownloadName,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("single byte ranges", () => {
  it.each([
    [undefined, 10, null],
    ["bytes=0-4", 10, { start: 0, endInclusive: 4 }],
    ["bytes=5-", 10, { start: 5, endInclusive: 9 }],
    ["bytes=-3", 10, { start: 7, endInclusive: 9 }],
    ["bytes=0-99", 10, { start: 0, endInclusive: 9 }],
  ] as const)("parses %s", (header, length, expected) => {
    expect(parseSingleByteRange(header, length)).toEqual({ ok: true, range: expected });
  });

  it.each([
    ["items=0-1", 10, "range.invalid"],
    ["bytes=0-1,4-5", 10, "range.multiple-not-supported"],
    ["bytes=a-b", 10, "range.invalid"],
    ["bytes=3-2", 10, "range.invalid"],
    ["bytes=10-", 10, "range.unsatisfiable"],
    ["bytes=-0", 10, "range.unsatisfiable"],
  ] as const)("rejects %s", (header, length, code) => {
    expect(parseSingleByteRange(header, length)).toEqual({ ok: false, code });
  });
});

describe("private file presentation", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])(
    "allows safe raster %s inline",
    (mediaType) => expect(isSafeInlineMediaType(mediaType)).toBe(true),
  );

  it.each(["image/svg+xml", "text/html", "application/pdf", "IMAGE/PNG"])(
    "keeps %s as a download",
    (mediaType) => expect(isSafeInlineMediaType(mediaType)).toBe(false),
  );

  it("sanitizes path, controls, quotes, and blank names", () => {
    expect(sanitizeDownloadName('../secret\u0000 "notes".txt')).toBe("secret _notes_.txt");
    expect(sanitizeDownloadName("   ")).toBe("file");
  });

  it("emits ASCII fallback and RFC 5987 filename without active content", () => {
    const disposition = contentDispositionForFile("aperçu privé.png", "image/png");
    expect(disposition).toContain("inline;");
    expect(disposition).toContain('filename="aper_u priv_.png"');
    expect(disposition).toContain("filename*=UTF-8''aper%C3%A7u%20priv%C3%A9.png");
    expect(contentDispositionForFile("vector.svg", "image/svg+xml")).toContain("attachment;");
  });

  it("admits only bounded complete revisions into the offline cache", () => {
    expect(cacheAdmissionForFile(16 * 1024 * 1024)).toEqual({ eligible: true, reason: null });
    expect(cacheAdmissionForFile(16 * 1024 * 1024 + 1)).toEqual({
      eligible: false,
      reason: "file.too-large-for-offline-cache",
    });
    expect(cacheAdmissionForFile(-1)).toEqual({
      eligible: false,
      reason: "file.invalid-byte-length",
    });
  });
});
