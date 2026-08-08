export const MAX_FILE_BYTE_LENGTH = 256 * 1024 * 1024;
export const MAX_OFFLINE_FILE_BYTE_LENGTH = 16 * 1024 * 1024;
export const OFFLINE_FILE_CACHE_MAX_ENTRIES = 24;
export const OFFLINE_FILE_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface ByteRange {
  readonly start: number;
  readonly endInclusive: number;
}

export type ByteRangeResult =
  | { readonly ok: true; readonly range: ByteRange | null }
  | {
      readonly ok: false;
      readonly code: "range.invalid" | "range.multiple-not-supported" | "range.unsatisfiable";
    };

function finiteLength(byteLength: number): boolean {
  return Number.isSafeInteger(byteLength) && byteLength >= 0;
}

export function parseSingleByteRange(
  header: string | undefined,
  byteLength: number,
): ByteRangeResult {
  if (!finiteLength(byteLength)) {
    return { ok: false, code: "range.invalid" };
  }
  if (header === undefined) {
    return { ok: true, range: null };
  }
  if (!header.startsWith("bytes=")) {
    return { ok: false, code: "range.invalid" };
  }
  const specification = header.slice("bytes=".length);
  if (specification.includes(",")) {
    return { ok: false, code: "range.multiple-not-supported" };
  }
  const match = /^(\d*)-(\d*)$/.exec(specification);
  if (match === null || (match[1] === "" && match[2] === "")) {
    return { ok: false, code: "range.invalid" };
  }
  if (byteLength === 0) {
    return { ok: false, code: "range.unsatisfiable" };
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false, code: "range.unsatisfiable" };
    }
    return {
      ok: true,
      range: {
        start: Math.max(0, byteLength - suffixLength),
        endInclusive: byteLength - 1,
      },
    };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0) {
    return { ok: false, code: "range.invalid" };
  }
  if (start >= byteLength) {
    return { ok: false, code: "range.unsatisfiable" };
  }
  if (endText === "") {
    return { ok: true, range: { start, endInclusive: byteLength - 1 } };
  }
  const requestedEnd = Number(endText);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { ok: false, code: "range.invalid" };
  }
  return {
    ok: true,
    range: { start, endInclusive: Math.min(requestedEnd, byteLength - 1) },
  };
}

const SAFE_INLINE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function isSafeInlineMediaType(mediaType: string): boolean {
  return SAFE_INLINE_MEDIA_TYPES.has(mediaType);
}

export function sanitizeDownloadName(raw: string): string {
  const pathSegments = raw.normalize("NFC").replaceAll("\\", "/").split("/");
  const basename = pathSegments[pathSegments.length - 1] ?? "";
  const withoutControls = [...basename]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("");
  const safe = withoutControls
    .replace(/["<>:|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 255);
  return safe.length === 0 ? "file" : safe;
}

function asciiFallback(name: string): string {
  return [...name]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e && character !== '"' && character !== "\\"
        ? character
        : "_";
    })
    .join("");
}

function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
}

export function contentDispositionForFile(name: string, mediaType: string): string {
  const safeName = sanitizeDownloadName(name);
  const disposition = isSafeInlineMediaType(mediaType) ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback(safeName)}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}

export type FileCacheAdmission =
  | { readonly eligible: true; readonly reason: null }
  | {
      readonly eligible: false;
      readonly reason: "file.invalid-byte-length" | "file.too-large-for-offline-cache";
    };

export function cacheAdmissionForFile(byteLength: number): FileCacheAdmission {
  if (!finiteLength(byteLength) || byteLength > MAX_FILE_BYTE_LENGTH) {
    return { eligible: false, reason: "file.invalid-byte-length" };
  }
  if (byteLength > MAX_OFFLINE_FILE_BYTE_LENGTH) {
    return { eligible: false, reason: "file.too-large-for-offline-cache" };
  }
  return { eligible: true, reason: null };
}
