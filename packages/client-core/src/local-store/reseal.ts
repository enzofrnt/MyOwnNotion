/**
 * Resealing a projection that predates the device key (T121, FR-012, FR-024).
 *
 * An installation upgraded from an earlier client has a local database full of
 * readable titles and page bodies. Dexie's own upgrade hook cannot fix that:
 * upgrades run inside a version-change transaction, and sealing is WebCrypto,
 * which ends that transaction the moment it is awaited. The result would be a
 * migration that appears to succeed and reseals nothing.
 *
 * So this runs after the database is open, on first unlock, outside any
 * transaction.
 *
 * Three properties matter, and each is a way this could go wrong quietly:
 *
 *   - **it is idempotent.** A row that is already sealed is left alone. An
 *     interrupted pass therefore costs the rows it had not reached, and a
 *     second run finishes the job rather than double-sealing what it did.
 *   - **it never leaves a half-sealed row.** Each row is replaced in one
 *     write, so a crash between reading and writing leaves the plaintext row
 *     exactly as it was — recoverable — rather than a row whose title is
 *     ciphertext and whose body is not.
 *   - **it fails closed on a row it cannot handle.** A row that neither looks
 *     plaintext nor opens as sealed is left untouched and reported. Deleting it
 *     would be destroying content to make a migration look clean.
 */

import type { LocalRecordCodec } from "../security/local-record-codec.ts";
import type {
  ConflictRecordRow,
  LocalDatabase,
  LocalItemRow,
  OutboxMutationRow,
  SealedLocalItemRow,
} from "./schema.ts";

export interface ResealOutcome {
  /** Rows converted from plaintext by this pass. */
  readonly resealed: number;
  /** Rows already sealed, left alone. */
  readonly alreadySealed: number;
  /** Rows that could not be classified, left exactly as they were. */
  readonly skipped: number;
}

/**
 * Whether a stored row still holds its payload in the clear.
 *
 * Tested by the presence of the plaintext field rather than the absence of the
 * sealed one, because a partially written row — which this function exists to
 * be robust against — could have neither.
 */
function isPlaintextRow(row: unknown): row is LocalItemRow {
  return typeof row === "object" && row !== null && typeof (row as LocalItemRow).name === "string";
}

function isSealedRow(row: unknown): row is SealedLocalItemRow {
  return (
    typeof row === "object" && row !== null && (row as SealedLocalItemRow).sealedName !== undefined
  );
}

export async function resealPlaintextProjection(
  db: LocalDatabase,
  codec: LocalRecordCodec,
): Promise<ResealOutcome> {
  // Read everything first. The rows are small — identifiers, a title, a
  // document body — and holding them briefly costs less than a cursor that
  // walks a table being rewritten underneath it.
  const rows = (await db.items.toArray()) as unknown[];

  let resealed = 0;
  let alreadySealed = 0;
  let skipped = 0;

  for (const row of rows) {
    if (isSealedRow(row)) {
      alreadySealed += 1;
      continue;
    }
    if (!isPlaintextRow(row)) {
      // Neither shape. Left alone and counted: deleting it would be destroying
      // content to make this function's report look tidy.
      skipped += 1;
      continue;
    }

    const sealed = await codec.sealItem(row);
    // One write per row, replacing it whole. A read-modify-write split across
    // two statements is what produces a row whose title is ciphertext and
    // whose body is not.
    await db.items.put(sealed);
    resealed += 1;
  }

  // Outbox and conflict stores existed before their codec was wired into the
  // live write path. Upgrade those payloads too: database definitions, values,
  // filters and all three conflict versions can otherwise remain readable on
  // disk even though the main projection is sealed.
  for (const row of (await db.outbox.toArray()) as unknown[]) {
    if (typeof row === "object" && row !== null && "payload" in row) {
      await db.outbox.put(
        (await codec.sealOutbox(row as OutboxMutationRow)) as unknown as OutboxMutationRow,
      );
    }
  }
  for (const row of (await db.conflicts.toArray()) as unknown[]) {
    if (typeof row === "object" && row !== null && "payload" in row) {
      await db.conflicts.put(
        (await codec.sealConflict(row as ConflictRecordRow)) as unknown as ConflictRecordRow,
      );
    }
  }

  return { resealed, alreadySealed, skipped };
}
