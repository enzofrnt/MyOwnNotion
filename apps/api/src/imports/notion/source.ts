import { createHash } from "node:crypto";

export class NotionImportError extends Error {
  constructor(
    readonly code: string,
    readonly sourcePath?: string,
  ) {
    super(code);
  }
}
export const SOURCE_LIMITS = {
  entries: 10_000,
  depth: 32,
  textBytes: 8 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
} as const;
export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}
export interface ImportSnapshot {
  files: SourceFile[];
  digest: string;
  totalBytes: number;
}
export function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
