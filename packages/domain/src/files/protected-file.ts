/** Authenticated shape rules shared by completed files and accepted upload prefixes. */
import { isUuid } from "../ids/uuid.ts";

export const PROTECTED_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const EMPTY_FILE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface ProtectedFileIdentity {
  readonly kind: "content" | "upload";
  readonly id: string;
  readonly recordVersion: number;
}

export interface ProtectedFileChunk {
  readonly index: number;
  readonly byteLength: number;
  readonly storageKey: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
}

interface ManifestBase extends ProtectedFileIdentity {
  readonly format: "myownnotion.protected-file";
  readonly formatVersion: 1;
  /** The authenticated completed length or durably accepted upload prefix. */
  readonly byteLength: number;
  readonly chunks: readonly ProtectedFileChunk[];
}

export type ProtectedFileManifest =
  | (ManifestBase & { readonly kind: "content"; readonly sha256: string })
  | (ManifestBase & {
      readonly kind: "upload";
      readonly declaredLength: number;
      readonly sha256: null;
    });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function length(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function version(value: unknown): boolean {
  return length(value) && value > 0 && value < 2 ** 31;
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function invalid(): never {
  throw new TypeError("Invalid or inconsistent protected file inventory.");
}

/**
 * Call only after opening the protected envelope under its trusted identity.
 * This validates shape, not ciphertext authentication. The total length fixes
 * the expected final chunk count, detecting tail removal as well as gaps.
 */
export function readProtectedFileManifest(
  value: unknown,
  expected: ProtectedFileIdentity,
): ProtectedFileManifest {
  if (
    !record(value) ||
    value["format"] !== "myownnotion.protected-file" ||
    value["formatVersion"] !== 1 ||
    (value["kind"] !== "content" && value["kind"] !== "upload") ||
    value["kind"] !== expected.kind ||
    !isUuid(value["id"]) ||
    value["id"] !== expected.id ||
    !version(value["recordVersion"]) ||
    value["recordVersion"] !== expected.recordVersion ||
    !length(value["byteLength"])
  )
    invalid();

  const byteLength = value["byteLength"];
  if (value["kind"] === "content") {
    if (!digest(value["sha256"]) || (byteLength === 0 && value["sha256"] !== EMPTY_FILE_SHA256))
      invalid();
  } else if (
    !length(value["declaredLength"]) ||
    value["declaredLength"] < byteLength ||
    value["sha256"] !== null
  )
    invalid();

  const chunks = value["chunks"];
  if (
    !Array.isArray(chunks) ||
    chunks.length !== Math.ceil(byteLength / PROTECTED_FILE_CHUNK_BYTES)
  )
    invalid();
  for (const [index, chunk] of chunks.entries()) {
    if (
      !record(chunk) ||
      chunk["index"] !== index ||
      chunk["byteLength"] !==
        Math.min(PROTECTED_FILE_CHUNK_BYTES, byteLength - index * PROTECTED_FILE_CHUNK_BYTES) ||
      !digest(chunk["storageKey"]) ||
      !version(chunk["keyGeneration"]) ||
      !version(chunk["recordVersion"])
    )
      invalid();
  }
  return value as unknown as ProtectedFileManifest;
}
