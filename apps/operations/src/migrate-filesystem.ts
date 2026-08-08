import { createHash } from "node:crypto";
import type { BlobStore } from "@myownnotion/blob-store";
import {
  type Database,
  listVerifiedReferencedContent,
  runMutation,
  updateVerifiedContentStorageKey,
} from "@myownnotion/database";

export interface FilesystemMigrationReport {
  readonly dryRun: boolean;
  readonly counts: {
    readonly scanned: number;
    readonly eligible: number;
    readonly migrated: number;
    readonly alreadyPresent: number;
    readonly missing: number;
    readonly mismatched: number;
    readonly failed: number;
  };
}

export interface FilesystemMigrationInput {
  readonly db: Database;
  readonly source: BlobStore;
  readonly destination: BlobStore;
  readonly confirm: boolean;
}

async function observedObject(
  store: BlobStore,
  storageKey: string,
): Promise<{ byteLength: number; sha256: string } | null> {
  const opened = await store.open(storageKey);
  if (opened === null) return null;
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of opened.body) {
    byteLength += chunk.byteLength;
    hash.update(chunk);
  }
  return { byteLength, sha256: hash.digest("hex") };
}

function exact(
  observed: Awaited<ReturnType<typeof observedObject>>,
  expected: { readonly byteLength: number; readonly sha256: string },
): boolean {
  return (
    observed !== null &&
    observed.byteLength === expected.byteLength &&
    observed.sha256 === expected.sha256
  );
}

/** Dry-run-first, per-object verified and idempotent legacy migration. */
export async function migrateFilesystemContent(
  input: FilesystemMigrationInput,
): Promise<FilesystemMigrationReport> {
  const inventory = await runMutation(input.db, listVerifiedReferencedContent);
  const counts = {
    scanned: inventory.length,
    eligible: 0,
    migrated: 0,
    alreadyPresent: 0,
    missing: 0,
    mismatched: 0,
    failed: 0,
  };

  for (const expected of inventory) {
    try {
      const destinationAtCurrentKey = await observedObject(input.destination, expected.storageKey);
      if (exact(destinationAtCurrentKey, expected)) {
        counts.alreadyPresent += 1;
        continue;
      }

      const sourceObserved = await observedObject(input.source, expected.storageKey);
      if (sourceObserved === null) {
        counts.missing += 1;
        continue;
      }
      if (!exact(sourceObserved, expected)) {
        counts.mismatched += 1;
        continue;
      }
      counts.eligible += 1;
      if (!input.confirm) continue;

      const source = await input.source.open(expected.storageKey);
      if (source === null) {
        counts.missing += 1;
        counts.eligible -= 1;
        continue;
      }
      const stored = await input.destination.put(source.body, {
        maxByteLength: expected.byteLength,
      });
      const replacement = await observedObject(input.destination, stored.storageKey);
      if (!exact(replacement, expected)) {
        if (stored.created) await input.destination.delete(stored.storageKey);
        counts.mismatched += 1;
        counts.eligible -= 1;
        continue;
      }
      const updated = await runMutation(input.db, (tx) =>
        updateVerifiedContentStorageKey(tx, {
          contentId: expected.contentId,
          expectedStorageKey: expected.storageKey,
          replacementStorageKey: stored.storageKey,
          verifiedSha256: expected.sha256,
          verifiedByteLength: expected.byteLength,
          verifiedAt: stored.verifiedAt,
        }),
      );
      if (!updated) {
        if (stored.created) await input.destination.delete(stored.storageKey);
        counts.failed += 1;
        counts.eligible -= 1;
        continue;
      }
      counts.migrated += 1;
    } catch {
      counts.failed += 1;
    }
  }

  return { dryRun: !input.confirm, counts };
}
