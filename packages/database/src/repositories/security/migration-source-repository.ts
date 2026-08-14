/**
 * Reading the plaintext an encryption migration copies (T096, US6, FR-024, FR-028, FR-029).
 *
 * This module reads the feature-001 tables as they were before encryption
 * existed, and it does exactly that: **reads**. Nothing here writes, deletes,
 * or nulls a source column. The scrub is a separate, later, deliberately
 * guarded step, and a module that could both read and destroy the source would
 * make every bug in the sweep a candidate for data loss.
 *
 * Two decisions govern the queries.
 *
 * **The cursor is the row's own primary key.** Unique, totally ordered, and
 * unchanged by the migration — a batch resumes exactly where the last one
 * stopped with no window that skips or repeats. Ordering by an updated
 * timestamp would be ambiguous between rows written in the same millisecond,
 * and ambiguity here means a record neither side believes it owns.
 *
 * **The capture boundary is an upper bound in the query, not a filter
 * applied afterwards.** Everything at or before it is the backfill's to copy;
 * everything after it was written by the encrypted path and needs no copy.
 * Fetching first and discarding later would work and would make the batch size
 * meaningless, which on a long migration is the difference between predictable
 * progress and a sweep that appears to stall.
 */

import { and, asc, count, desc, eq, gt, lte } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { items, pageDocuments } from "../../schema/index.ts";

type Executor = Database | Transaction;

/** One plaintext payload waiting to be sealed. */
export interface PlaintextRecord {
  /** The row id, which is also the resume cursor. */
  readonly cursor: string;
  readonly entityId: string;
  readonly recordVersion: number;
  readonly value: unknown;
}

/**
 * Item titles still in the clear.
 *
 * Titles first, and separately from bodies, because they are the most exposed
 * field in a database dump: a list of titles describes a person's life without
 * a single body being read.
 */
export async function listPlaintextItemNames(
  executor: Executor,
  input: { afterCursor: string; boundaryCursor: string; limit: number },
): Promise<readonly PlaintextRecord[]> {
  const rows = await executor
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(
      and(
        ...(input.afterCursor === "" ? [] : [gt(items.id, input.afterCursor)]),
        ...(input.boundaryCursor === "" ? [] : [lte(items.id, input.boundaryCursor)]),
      ),
    )
    .orderBy(asc(items.id))
    .limit(input.limit);
  return rows.map((row) => ({
    cursor: row.id,
    entityId: row.id,
    // Feature-001 items carry no per-field version; the sealed record starts
    // at 1, matching what the ordinary write path produces for a new item.
    recordVersion: 1,
    value: row.name,
  }));
}

/** Page bodies still in the clear. */
export async function listPlaintextPageBodies(
  executor: Executor,
  input: { afterCursor: string; boundaryCursor: string; limit: number },
): Promise<readonly PlaintextRecord[]> {
  const rows = await executor
    .select({ pageId: pageDocuments.pageId, body: pageDocuments.body })
    .from(pageDocuments)
    .where(
      and(
        ...(input.afterCursor === "" ? [] : [gt(pageDocuments.pageId, input.afterCursor)]),
        ...(input.boundaryCursor === "" ? [] : [lte(pageDocuments.pageId, input.boundaryCursor)]),
      ),
    )
    .orderBy(asc(pageDocuments.pageId))
    .limit(input.limit);
  return rows.map((row) => ({
    // The page id is the item id: feature-001 stores one document per page
    // item, keyed by that item. The cursor and the entity are the same value,
    // and saying so is clearer than a join that pretends otherwise.
    cursor: row.pageId,
    entityId: row.pageId,
    recordVersion: 1,
    value: row.body,
  }));
}

/**
 * The highest row id at this instant, which becomes the capture boundary.
 *
 * Taken once, at the boundary stage, and stored. Recomputing it later would
 * move the line the migration is measured against, and a moving boundary means
 * a backfill that never terminates on a workspace still being written to.
 */
export async function currentSourceBoundary(
  executor: Executor,
): Promise<{ itemCursor: string; pageCursor: string }> {
  const [lastItem] = await executor
    .select({ id: items.id })
    .from(items)
    .orderBy(desc(items.id))
    .limit(1);
  const [lastPage] = await executor
    .select({ id: pageDocuments.pageId })
    .from(pageDocuments)
    .orderBy(desc(pageDocuments.pageId))
    .limit(1);
  return {
    // The empty string for an empty table, which the queries above read as "no
    // upper bound" — correctly, because there is nothing to bound.
    itemCursor: lastItem?.id ?? "",
    pageCursor: lastPage?.id ?? "",
  };
}

/** How much there is to copy, for progress an operator can plan around. */
export async function countPlaintextSources(
  executor: Executor,
  input: { itemBoundary: string; pageBoundary: string },
): Promise<{ items: number; pages: number; total: number }> {
  const [itemRow] = await executor
    .select({ value: count() })
    .from(items)
    .where(input.itemBoundary === "" ? undefined : lte(items.id, input.itemBoundary));
  const [pageRow] = await executor
    .select({ value: count() })
    .from(pageDocuments)
    .where(input.pageBoundary === "" ? undefined : lte(pageDocuments.pageId, input.pageBoundary));
  const itemCount = itemRow?.value ?? 0;
  const pageCount = pageRow?.value ?? 0;
  return { items: itemCount, pages: pageCount, total: itemCount + pageCount };
}

/**
 * Every source identifier, for the identity digest.
 *
 * Identifiers, never payloads. What the verification proves is that the same
 * *records* exist on both sides — feature-001's canonical identity, preserved
 * verbatim through the migration. Hashing the contents instead would compare
 * plaintext against ciphertext and prove nothing.
 */
export async function readSourceIdentities(
  executor: Executor,
): Promise<{ items: string[]; pages: string[] }> {
  const itemRows = await executor.select({ id: items.id }).from(items).orderBy(items.id);
  const pageRows = await executor
    .select({ id: pageDocuments.pageId })
    .from(pageDocuments)
    .orderBy(pageDocuments.pageId);
  return {
    items: itemRows.map((row) => row.id),
    pages: pageRows.map((row) => row.id),
  };
}

/** Whether a specific item still has its plaintext title. Used by the scrub check. */
export async function itemHasPlaintextName(executor: Executor, itemId: string): Promise<boolean> {
  const rows = await executor
    .select({ name: items.name })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  const row = rows[0];
  return row !== undefined && row.name.length > 0;
}
