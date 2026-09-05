export interface FileByteRange {
  readonly start: number;
  readonly end: number;
}

/** RFC 9110 single byte range; this endpoint explicitly refuses multipart ranges. */
export function parseFileRange(
  header: string | undefined,
  length: number,
): FileByteRange | null | "unsatisfiable" {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (match === null || length === 0) return "unsatisfiable";
  const [, first, last] = match;
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, length - suffix), end: length - 1 };
  }
  const start = Number(first);
  const end = last === "" ? length - 1 : Number(last);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || end < start)
    return "unsatisfiable";
  return { start, end: Math.min(end, length - 1) };
}
