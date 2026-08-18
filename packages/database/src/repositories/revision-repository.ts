/**
 * Append-only revision persistence (T082, US5).
 *
 * Revisions and their parent edges are written atomically with the mutation
 * that produced them. Superseding a head stamps the previous snapshot with
 * its 24-hour expiry; headers and parent edges are never deleted.
 */
import { createHash } from "node:crypto";
import {
  canonicalLineageString,
  type RevisionHeader,
  type RevisionWithSnapshot,
  snapshotExpiry,
  type Uuid,
} from "@myownnotion/domain";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database, Transaction } from "../client.ts";
import {
  authorizedDevices,
  items,
  logicalFiles,
  mutations,
  pageDocuments,
  placements,
  revisionParents,
  revisions,
} from "../schema/index.ts";

export interface InsertRevisionInput {
  readonly id: Uuid;
  readonly itemId: Uuid;
  readonly mutationId: Uuid;
  readonly parentRevisionIds: ReadonlyArray<Uuid>;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly acceptedAt: Date;
}

export async function insertRevision(tx: Transaction, input: InsertRevisionInput): Promise<void> {
  const digest = createHash("sha256")
    .update(
      canonicalLineageString({
        id: input.id,
        itemId: input.itemId,
        mutationId: input.mutationId,
        parentRevisionIds: input.parentRevisionIds,
      }),
    )
    .digest("hex");
  await tx.insert(revisions).values({
    id: input.id,
    itemId: input.itemId,
    mutationId: input.mutationId,
    acceptedAt: input.acceptedAt,
    snapshot: input.snapshot,
    snapshotExpiresAt: null,
    lineageDigest: digest,
  });
  if (input.parentRevisionIds.length > 0) {
    await tx.insert(revisionParents).values(
      input.parentRevisionIds.map((parentRevisionId) => ({
        revisionId: input.id,
        parentRevisionId,
      })),
    );
  }
}

/**
 * Records which device produced this mutation's revisions (T037, FR-022).
 *
 * One statement keyed by the mutation rather than a parameter on
 * `insertRevision`. Fifteen call sites construct a revision — every command,
 * every file operation, a conversion — and threading an attribution through all
 * of them would mean fifteen chances to forget, in a set that grows with every
 * feature. Keyed by the mutation, a revision this mutation wrote cannot be
 * missed, including one written by a path added later.
 *
 * The device comes from the authenticated request, never from the payload. A
 * client-asserted author is a history an owner cannot trust, and the one thing
 * a history is for is being trusted.
 */
export async function attributeRevisionsToDevice(
  tx: Transaction,
  input: { readonly mutationId: Uuid; readonly deviceId: string },
): Promise<void> {
  await tx
    .update(revisions)
    .set({ authoredByDeviceId: input.deviceId })
    .where(eq(revisions.mutationId, input.mutationId));
}

/**
 * What a history entry says about a revision's author and nature (FR-022).
 *
 * Both fields are nullable and both mean the same thing when they are: nothing
 * is known. A device the owner has since deleted leaves a name behind that no
 * longer resolves, and a revision written before attribution existed has no
 * device at all. Neither is filled in with a guess.
 *
 * Note what this does not read: no session, no key generation, nothing derived
 * from key material (FR-023). A history is read on screen and carried out in an
 * export, so anything technical recorded here would leak through every one of
 * those paths.
 */
export interface RevisionAttribution {
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  /** The command that produced it, for the domain to phrase in owner's terms. */
  readonly commandType: string | null;
}

export async function readRevisionAttribution(
  tx: Transaction,
  revisionId: Uuid,
): Promise<RevisionAttribution> {
  const rows = await tx
    .select({
      deviceId: revisions.authoredByDeviceId,
      deviceName: authorizedDevices.name,
      commandType: mutations.commandType,
    })
    .from(revisions)
    // Both joins are left joins on purpose. An inner join would drop the
    // revision entirely when its device was deleted — turning "author unknown"
    // into "this revision does not exist", which is a lie about content the
    // owner can still see.
    .leftJoin(authorizedDevices, eq(authorizedDevices.id, revisions.authoredByDeviceId))
    .leftJoin(mutations, eq(mutations.id, revisions.mutationId))
    .where(eq(revisions.id, revisionId))
    .limit(1);
  const row = rows[0];
  return {
    deviceId: row?.deviceId ?? null,
    deviceName: row?.deviceName ?? null,
    commandType: row?.commandType ?? null,
  };
}

/**
 * Marks a superseded head's snapshot for 24-hour retention (FR-026).
 * Unresolved-conflict and trash protections are applied at pruning time,
 * never here — supersession only starts the clock.
 */
export async function supersedeRevision(
  tx: Transaction,
  revisionId: Uuid,
  supersededAt: Date,
): Promise<void> {
  await tx
    .update(revisions)
    .set({ snapshotExpiresAt: snapshotExpiry(supersededAt) })
    .where(and(eq(revisions.id, revisionId), isNull(revisions.snapshotExpiresAt)));
}

export async function getRevision(
  tx: Transaction,
  revisionId: Uuid,
): Promise<RevisionWithSnapshot | null> {
  const rows = await tx.select().from(revisions).where(eq(revisions.id, revisionId)).limit(1);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  const parents = await tx
    .select({ parentRevisionId: revisionParents.parentRevisionId })
    .from(revisionParents)
    .where(eq(revisionParents.revisionId, revisionId));
  return {
    id: row.id as Uuid,
    itemId: row.itemId as Uuid,
    mutationId: row.mutationId as Uuid,
    parentRevisionIds: parents.map((parent) => parent.parentRevisionId as Uuid),
    acceptedAt: row.acceptedAt.toISOString(),
    authoredByDeviceId: (row.authoredByDeviceId as Uuid | null) ?? null,
    snapshot: (row.snapshot as Record<string, unknown> | null) ?? null,
    snapshotExpiresAt: row.snapshotExpiresAt?.toISOString() ?? null,
  };
}

export async function getRevisionHeaders(
  tx: Transaction,
  revisionIds: ReadonlyArray<Uuid>,
): Promise<Map<string, RevisionHeader>> {
  if (revisionIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select()
    .from(revisions)
    .where(inArray(revisions.id, revisionIds as Uuid[]));
  const parentRows = await tx
    .select()
    .from(revisionParents)
    .where(inArray(revisionParents.revisionId, revisionIds as Uuid[]));
  const parentsByRevision = new Map<string, Uuid[]>();
  for (const edge of parentRows) {
    const list = parentsByRevision.get(edge.revisionId) ?? [];
    list.push(edge.parentRevisionId as Uuid);
    parentsByRevision.set(edge.revisionId, list);
  }
  const headers = new Map<string, RevisionHeader>();
  for (const row of rows) {
    headers.set(row.id, {
      id: row.id as Uuid,
      itemId: row.itemId as Uuid,
      mutationId: row.mutationId as Uuid,
      parentRevisionIds: parentsByRevision.get(row.id) ?? [],
      acceptedAt: row.acceptedAt.toISOString(),
    });
  }
  return headers;
}

/** Batch-friendly parent lookup used by lineage classification. */
export async function loadParentEdges(
  tx: Transaction,
  startIds: ReadonlyArray<Uuid>,
): Promise<Map<string, Uuid[]>> {
  const edges = new Map<string, Uuid[]>();
  let frontier = [...startIds];
  const seen = new Set<string>(frontier);
  while (frontier.length > 0) {
    const rows = await tx
      .select()
      .from(revisionParents)
      .where(inArray(revisionParents.revisionId, frontier));
    const next: Uuid[] = [];
    for (const id of frontier) {
      if (!edges.has(id)) {
        edges.set(id, []);
      }
    }
    for (const row of rows) {
      const list = edges.get(row.revisionId) ?? [];
      list.push(row.parentRevisionId as Uuid);
      edges.set(row.revisionId, list);
      if (!seen.has(row.parentRevisionId)) {
        seen.add(row.parentRevisionId);
        next.push(row.parentRevisionId as Uuid);
      }
    }
    frontier = next;
  }
  return edges;
}

/**
 * Builds the complete restorable state snapshot of an item: canonical row,
 * page document, logical-file metadata, and active placements (FR-026).
 */
export async function buildItemSnapshot(
  tx: Transaction,
  itemId: Uuid,
): Promise<Record<string, unknown>> {
  const itemRows = await tx.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = itemRows[0];
  if (item === undefined) {
    return {};
  }
  const snapshot: Record<string, unknown> = {
    name: item.name,
    kind: item.kind,
    lifecycle: item.lifecycle,
    trashedAt: item.trashedAt?.toISOString() ?? null,
    purgeAfter: item.purgeAfter?.toISOString() ?? null,
    favourite: item.favourite,
    // In the snapshot for the same reason as `favourite`: the projection on
    // every other device is fed from these, so an attribute left out is one the
    // owner's other devices never learn about.
    offlineIntent: item.offlineIntent,
  };
  if (item.kind === "page") {
    const documentRows = await tx
      .select()
      .from(pageDocuments)
      .where(eq(pageDocuments.pageId, itemId))
      .limit(1);
    const document = documentRows[0];
    snapshot["pageDocument"] =
      document === undefined
        ? null
        : {
            format: document.format,
            formatVersion: document.formatVersion,
            body: document.body,
          };
  }
  if (item.kind === "file") {
    const fileRows = await tx
      .select()
      .from(logicalFiles)
      .where(eq(logicalFiles.itemId, itemId))
      .limit(1);
    const file = fileRows[0];
    snapshot["file"] =
      file === undefined
        ? null
        : {
            contentId: file.contentId,
            mediaType: file.mediaType,
            originalName: file.originalName,
            byteLength: file.byteLength,
          };
  }
  const placementRows = await tx
    .select()
    .from(placements)
    .where(and(eq(placements.itemId, itemId), isNull(placements.removedAt)));
  snapshot["placements"] = placementRows.map((placement) => ({
    id: placement.id,
    kind: placement.kind,
    parentItemId: placement.parentItemId,
    positionKey: placement.positionKey,
  }));
  return snapshot;
}

/**
 * Reads the stored snapshots for a set of revisions.
 *
 * Exists so the encryption layer can seal them from inside the mutation's own
 * transaction. A snapshot is the whole record as it stood, so it is the field
 * that would let someone holding the database reconstruct everything a scrub
 * of the current rows was meant to remove.
 */
export async function readRevisionSnapshots(
  executor: Database | Transaction,
  revisionIds: readonly string[],
): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  if (revisionIds.length === 0) {
    return new Map();
  }
  const rows = await executor
    .select({ id: revisions.id, snapshot: revisions.snapshot })
    .from(revisions)
    .where(inArray(revisions.id, [...revisionIds]));
  return new Map(rows.map((row) => [row.id, row.snapshot as Record<string, unknown>]));
}
