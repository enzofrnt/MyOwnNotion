/**
 * The derived index of where files are used (T012, US1, FR-004, FR-005).
 *
 * Rebuilt inside the mutation's transaction, never afterwards. A deletion
 * confirmation reads this index to tell the owner what depends on a file, so an
 * index written in a second transaction has a window in which it disagrees with
 * the documents — and the confirmation shown during that window is the one that
 * says "nothing uses this" about a file a page still shows.
 *
 * Rebuilt wholesale for the one page that changed rather than diffed. The page
 * is small, the write is rare, and a diff is one more thing that can be subtly
 * wrong in the direction that loses content.
 */

import { embeddedFiles, type FileUsage, readDocumentBody, type Uuid } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { fileUsages, items, logicalFiles } from "../../schema/index.ts";

/**
 * Replaces the `embed` usages of one page.
 *
 * Only the embeds: `attachment` and `hierarchy` usages come from placements,
 * which are rows already, and rewriting those here would mean two writers for
 * one fact.
 */
export async function rebuildEmbedUsages(
  tx: Transaction,
  pageItemId: Uuid,
  body: unknown,
): Promise<void> {
  await tx
    .delete(fileUsages)
    .where(and(eq(fileUsages.usedByItemId, pageItemId), eq(fileUsages.usageKind, "embed")));

  // Read through the domain's own reader rather than poked at directly. A body
  // that fails to validate yields no embeds instead of throwing: refusing to
  // save a document because its usage index could not be built would turn a
  // bookkeeping problem into lost work.
  const read = readDocumentBody(body);
  if (read.kind !== "blocks" || !read.result.ok) {
    return;
  }
  const found = embeddedFiles(read.result.document);
  if (found.length === 0) {
    return;
  }

  // Only embeds that point at something this workspace actually holds as a
  // file. A document may name an id that was never a file, or was purged; a row
  // for it would be a usage the owner can never reach, listed in a confirmation
  // as though it meant something.
  const known = await knownFileIds(
    tx,
    found.map((usage) => usage.fileItemId),
  );
  const rows = found
    .filter((usage) => known.has(usage.fileItemId))
    .map((usage) => ({
      fileItemId: usage.fileItemId,
      usedByItemId: pageItemId,
      usageKind: "embed" as const,
      blockId: usage.blockId,
    }));
  if (rows.length > 0) {
    // The same file embedded twice in one page is two rows with different block
    // ids, so the unique index does not collapse them. `onConflictDoNothing`
    // covers the one case that would: the same block id twice, which a
    // malformed document could carry.
    await tx.insert(fileUsages).values(rows).onConflictDoNothing();
  }
}

/** Records a placement as a usage, for attachments and hierarchy placements. */
export async function recordPlacementUsage(
  tx: Transaction,
  input: {
    readonly fileItemId: Uuid;
    readonly parentItemId: Uuid | null;
    readonly kind: "attachment" | "hierarchy";
  },
): Promise<void> {
  if (input.parentItemId === null) {
    // A file at the workspace root is placed, not used: there is no item that
    // would break if it went away, which is the question this index answers.
    return;
  }
  await tx
    .insert(fileUsages)
    .values({
      fileItemId: input.fileItemId,
      usedByItemId: input.parentItemId,
      usageKind: input.kind,
      blockId: null,
    })
    .onConflictDoNothing();
}

/** Every usage of one file, for the deletion confirmation of FR-004. */
export async function usagesOfFile(tx: Transaction, fileItemId: Uuid): Promise<FileUsage[]> {
  const rows = await tx.select().from(fileUsages).where(eq(fileUsages.fileItemId, fileItemId));
  return rows.map((row) => ({
    fileItemId: row.fileItemId as Uuid,
    usageKind: row.usageKind as FileUsage["usageKind"],
    blockId: (row.blockId as Uuid | null) ?? null,
  }));
}

/**
 * Every usage of one file, with the name of what uses it.
 *
 * The name is joined here rather than fetched by the caller because this is
 * read while an owner is deciding whether to destroy something: a list of
 * identifiers tells them nothing about what they are about to break.
 */
export async function namedUsagesOfFile(
  executor: Database | Transaction,
  fileItemId: Uuid,
): Promise<
  Array<{
    readonly usedByItemId: Uuid;
    readonly usedByName: string;
    readonly usageKind: FileUsage["usageKind"];
    readonly blockId: Uuid | null;
  }>
> {
  const rows = await executor
    .select({
      usedByItemId: fileUsages.usedByItemId,
      usedByName: items.name,
      usageKind: fileUsages.usageKind,
      blockId: fileUsages.blockId,
    })
    .from(fileUsages)
    .innerJoin(items, eq(items.id, fileUsages.usedByItemId))
    .where(eq(fileUsages.fileItemId, fileItemId));
  return rows.map((row) => ({
    usedByItemId: row.usedByItemId as Uuid,
    usedByName: row.usedByName,
    usageKind: row.usageKind as FileUsage["usageKind"],
    blockId: (row.blockId as Uuid | null) ?? null,
  }));
}

async function knownFileIds(
  tx: Transaction,
  candidates: readonly Uuid[],
): Promise<ReadonlySet<Uuid>> {
  const unique = [...new Set(candidates)];
  const known = new Set<Uuid>();
  for (const candidate of unique) {
    const [row] = await tx
      .select({ itemId: logicalFiles.itemId })
      .from(logicalFiles)
      .where(eq(logicalFiles.itemId, candidate))
      .limit(1);
    if (row !== undefined) {
      known.add(row.itemId as Uuid);
    }
  }
  return known;
}

/** Used by the hierarchy repository when a placement is removed. */
export async function removePlacementUsage(
  tx: Transaction,
  input: {
    readonly fileItemId: Uuid;
    readonly parentItemId: Uuid;
    readonly kind: "attachment" | "hierarchy";
  },
): Promise<void> {
  await tx
    .delete(fileUsages)
    .where(
      and(
        eq(fileUsages.fileItemId, input.fileItemId),
        eq(fileUsages.usedByItemId, input.parentItemId),
        eq(fileUsages.usageKind, input.kind),
      ),
    );
}
