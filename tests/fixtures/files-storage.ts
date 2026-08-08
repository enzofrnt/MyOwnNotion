import { createHash } from "node:crypto";

export const SAFE_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

export const DOCUMENT_BYTES = new TextEncoder().encode(
  "MyOwnNotion deterministic private attachment\n",
);

export const RANGE_BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);

export const CORRUPT_OBJECT_BYTES = new TextEncoder().encode("corrupt-object");

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const FILE_STORAGE_FIXTURE = {
  image: {
    name: "aperçu privé.png",
    mediaType: "image/png",
    bytes: SAFE_PNG_BYTES,
    sha256: sha256Hex(SAFE_PNG_BYTES),
  },
  document: {
    name: 'notes "privées".txt',
    mediaType: "text/plain",
    bytes: DOCUMENT_BYTES,
    sha256: sha256Hex(DOCUMENT_BYTES),
  },
  range: {
    name: "range.bin",
    mediaType: "application/octet-stream",
    bytes: RANGE_BYTES,
    sha256: sha256Hex(RANGE_BYTES),
  },
} as const;
