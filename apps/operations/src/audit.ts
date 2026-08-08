import { createHash, createHmac } from "node:crypto";
import type { BlobStore } from "@myownnotion/blob-store";
import type { ContentAuditInventoryRecord } from "@myownnotion/database";

export type AuditFindingKind =
  | "referenced"
  | "missing"
  | "mismatched"
  | "temporary"
  | "unreferenced";

export interface AuditFinding {
  readonly kind: AuditFindingKind;
  readonly safeId: string;
  readonly lengthMatches?: boolean;
  readonly digestMatches?: boolean;
}

export interface StorageAuditReport {
  readonly counts: Readonly<Record<AuditFindingKind, number>>;
  readonly findings: readonly AuditFinding[];
  readonly truncated: boolean;
}

export interface StorageAuditInput {
  readonly inventory: readonly ContentAuditInventoryRecord[];
  readonly blobStore: BlobStore;
  readonly hmacKey: Uint8Array;
  readonly limit?: number;
}

function safeIdentifier(hmacKey: Uint8Array, kind: AuditFindingKind, identifier: string): string {
  return createHmac("sha256", hmacKey)
    .update(kind)
    .update("\0")
    .update(identifier)
    .digest("hex")
    .slice(0, 24);
}

async function hashStoredObject(
  blobStore: BlobStore,
  storageKey: string,
): Promise<{ byteLength: number; sha256: string } | null> {
  const opened = await blobStore.open(storageKey);
  if (opened === null) return null;
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of opened.body) {
    byteLength += chunk.byteLength;
    hash.update(chunk);
  }
  return { byteLength, sha256: hash.digest("hex") };
}

/** Performs a bounded, read-only comparison of canonical metadata and physical objects. */
export async function auditContentStorage(input: StorageAuditInput): Promise<StorageAuditReport> {
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
    throw new RangeError("audit report limit is invalid");
  }
  if (input.hmacKey.byteLength < 32) {
    throw new RangeError("audit HMAC key must contain at least 32 bytes");
  }

  const counts: Record<AuditFindingKind, number> = {
    referenced: 0,
    missing: 0,
    mismatched: 0,
    temporary: 0,
    unreferenced: 0,
  };
  const findings: AuditFinding[] = [];
  let observedFindings = 0;
  const record = (
    kind: AuditFindingKind,
    identifier: string,
    comparison: Pick<AuditFinding, "lengthMatches" | "digestMatches"> = {},
  ): void => {
    counts[kind] += 1;
    observedFindings += 1;
    if (findings.length < limit) {
      findings.push({
        kind,
        safeId: safeIdentifier(input.hmacKey, kind, identifier),
        ...comparison,
      });
    }
  };

  const referencedKeys = new Set<string>();
  for (const expected of [...input.inventory].sort((left, right) =>
    left.contentId.localeCompare(right.contentId),
  )) {
    referencedKeys.add(expected.storageKey);
    let observed: Awaited<ReturnType<typeof hashStoredObject>>;
    try {
      observed = await hashStoredObject(input.blobStore, expected.storageKey);
    } catch {
      record("missing", expected.storageKey);
      continue;
    }
    if (observed === null) {
      record("missing", expected.storageKey);
      continue;
    }
    const lengthMatches = observed.byteLength === expected.byteLength;
    const digestMatches = expected.verified && observed.sha256 === expected.sha256;
    record(lengthMatches && digestMatches ? "referenced" : "mismatched", expected.storageKey, {
      lengthMatches,
      digestMatches,
    });
  }

  const physicalKeys = await input.blobStore.list({ includeTemporary: true });
  for (const storageKey of physicalKeys) {
    if (storageKey.startsWith(".tmp/")) {
      record("temporary", storageKey);
    } else if (!referencedKeys.has(storageKey)) {
      record("unreferenced", storageKey);
    }
  }

  return { counts, findings, truncated: observedFindings > findings.length };
}
