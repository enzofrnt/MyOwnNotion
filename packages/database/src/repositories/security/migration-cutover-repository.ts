/**
 * The cutover and the scrub (T097, US6, FR-028, FR-029, SC-010).
 *
 * This is the only module in the codebase that deliberately destroys owner
 * data. Everything in it is written on the assumption that it will one day be
 * called by mistake.
 *
 * **Every destructive statement carries the migration's state in its `WHERE`
 * clause.** Not checked first and executed after — carried, so the check and
 * the deletion are one statement and there is no window between them. A scrub
 * issued against a migration that has since failed updates nothing and says
 * so.
 *
 * **The scrub overwrites rather than deletes.** `items.name` is not nullable
 * and the row must survive: what the migration removes is the *plaintext*, not
 * the record. Deleting rows would take the hierarchy, the ordering, and the
 * revision lineage with them — the encrypted copy holds the title, not the
 * item.
 *
 * **Nothing here runs outside a transaction.** A scrub interrupted half way
 * through a batch must leave either all of that batch scrubbed or none of it,
 * because "some titles are gone and we do not know which" is the one state
 * from which an operator cannot reason.
 */

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { Transaction } from "../../client.ts";
import { items, pageDocuments } from "../../schema/index.ts";
import { encryptionMigrations } from "../../schema/security/index.ts";

/**
 * What a scrubbed plaintext column holds afterwards.
 *
 * A single U+FFFD, the Unicode replacement character, and the choice is
 * constrained from both sides.
 *
 * It cannot be empty: `items_name_check` requires between 1 and 512
 * characters, and that is a feature-001 invariant. Relaxing it so the
 * migration could write an empty string would mean the migration changed the
 * schema's rules about what an item is, which is exactly the kind of thing a
 * migration must not do.
 *
 * It is not a word either — no "[encrypted]", no "(migrated)". A phrase would
 * leak into any tool reading the table directly and would read as content
 * someone wrote. U+FFFD is one character, is never typed by a person, and
 * already means precisely "the content is not representable here".
 */
export const SCRUBBED_PLACEHOLDER = "\uFFFD";

/**
 * Removes the plaintext titles of specific items.
 *
 * By id list rather than by a sweeping predicate. The caller has just verified
 * these exact records exist in encrypted form; a `WHERE` clause matching
 * "everything before the boundary" would scrub records the verification never
 * covered if the boundary were wrong by so much as one row.
 */
export async function scrubItemNames(
  tx: Transaction,
  input: { migrationId: string; itemIds: readonly string[] },
): Promise<number> {
  if (input.itemIds.length === 0) {
    return 0;
  }
  const permitted = await migrationIsScrubbing(tx, input.migrationId);
  if (!permitted) {
    // The migration is not at the scrub stage — it failed, or it has not got
    // there. Either way this call is a mistake, and the mistake is worth
    // nothing rather than some titles.
    return 0;
  }
  const rows = await tx
    .update(items)
    .set({ name: SCRUBBED_PLACEHOLDER })
    .where(and(inArray(items.id, [...input.itemIds]), ne(items.name, SCRUBBED_PLACEHOLDER)))
    .returning({ id: items.id });
  return rows.length;
}

/**
 * Removes the plaintext bodies of specific pages.
 *
 * The body becomes an empty JSON object rather than null: the column is not
 * nullable, and a document format that suddenly permitted null would be a
 * change to feature-001's schema made by the migration, which is exactly the
 * kind of thing a migration must not do.
 */
export async function scrubPageBodies(
  tx: Transaction,
  input: { migrationId: string; pageIds: readonly string[] },
): Promise<number> {
  if (input.pageIds.length === 0) {
    return 0;
  }
  const permitted = await migrationIsScrubbing(tx, input.migrationId);
  if (!permitted) {
    return 0;
  }
  const rows = await tx
    .update(pageDocuments)
    .set({ body: sql`'{}'::jsonb` })
    .where(inArray(pageDocuments.pageId, [...input.pageIds]))
    .returning({ id: pageDocuments.pageId });
  return rows.length;
}

/**
 * Whether the migration is at the stage where scrubbing is permitted.
 *
 * Read inside the caller's transaction, so the answer cannot go stale between
 * the check and the statement that depends on it.
 */
async function migrationIsScrubbing(tx: Transaction, migrationId: string): Promise<boolean> {
  const rows = await tx
    .select({ state: encryptionMigrations.state })
    .from(encryptionMigrations)
    .where(
      and(
        eq(encryptionMigrations.id, migrationId),
        eq(encryptionMigrations.state, "scrub-plaintext"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * How much plaintext is left, within the migration's boundary.
 *
 * The evidence behind SC-010, and the reason it counts rather than samples: a
 * migration that scrubbed 99% of an installation has not finished, and the
 * remaining 1% is precisely the part nobody would notice.
 *
 * **Bounded**, for the same reason the scrub is. A note taken while the
 * migration ran has no encrypted copy and must keep its plaintext; counting it
 * as "left to scrub" would leave the migration reporting unfinished work it
 * must never do, and looping on it forever.
 */
export async function countRemainingPlaintext(
  tx: Transaction,
  bounds: { itemBoundary?: string; pageBoundary?: string } = {},
): Promise<{ items: number; pages: number }> {
  const itemRows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        ne(items.name, SCRUBBED_PLACEHOLDER),
        ...(bounds.itemBoundary === undefined || bounds.itemBoundary === ""
          ? []
          : [lte(items.id, bounds.itemBoundary)]),
      ),
    );
  const pageRows = await tx
    .select({ id: pageDocuments.pageId })
    .from(pageDocuments)
    .where(
      and(
        sql`${pageDocuments.body} <> '{}'::jsonb`,
        ...(bounds.pageBoundary === undefined || bounds.pageBoundary === ""
          ? []
          : [lte(pageDocuments.pageId, bounds.pageBoundary)]),
      ),
    );
  return { items: itemRows.length, pages: pageRows.length };
}
