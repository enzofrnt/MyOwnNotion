/** Historical metadata is resolved exactly as authorized reads before readable copies are retired. */
import { createHash } from "node:crypto";
import {
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readItem,
  SCRUBBED_PLACEHOLDER,
  schema,
  type Transaction,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { isProtectedPayload, PROTECTED_PAYLOAD } from "./canonical-payloads.ts";
import {
  resolveDatabaseDefinition,
  resolveDatabaseEntryValues,
  resolveProtectedContent,
} from "./content-resolution.ts";
import type { ProtectedContent } from "./protected-content.ts";

export interface CanonicalMetadataSource {
  readonly kind: "metadata";
  readonly objectId: string;
  readonly category: "item" | "revision" | "relationship" | "export";
  readonly entityId: string;
  /** Captured before cutover when an exact marker was still authored plaintext. */
  readonly legacyPlaintextPlaceholder?: true;
  readonly digest: string;
}

function snapshotHasPlaintextPlaceholder(snapshot: Record<string, unknown> | null): boolean {
  const file = snapshot?.["file"];
  return (
    snapshot?.["name"] === SCRUBBED_PLACEHOLDER ||
    (typeof file === "object" &&
      file !== null &&
      "originalName" in file &&
      file.originalName === SCRUBBED_PLACEHOLDER)
  );
}

async function hasLegacyPlaintextPlaceholder(
  tx: Transaction,
  content: ProtectedContent,
  category: CanonicalMetadataSource["category"],
  id: string,
): Promise<boolean> {
  if (category === "item") {
    const raw = await readItem(tx, id as Uuid);
    if (raw === null) throw new Error("Historical canonical item is unavailable.");
    if (raw.name === SCRUBBED_PLACEHOLDER && (await content.readItemPresentation(tx, id)) === null)
      return true;
    return (
      raw.file?.originalName === SCRUBBED_PLACEHOLDER &&
      (await content.readFileMetadata(tx, { kind: "file", id })) === null
    );
  }
  if (category === "revision") {
    if ((await content.readRevisionSnapshot(tx, id)) !== null) return false;
    const [row] = await tx.select().from(schema.revisions).where(eq(schema.revisions.id, id));
    if (row === undefined) throw new Error("Historical revision is unavailable.");
    return (
      row.snapshot !== null &&
      typeof row.snapshot === "object" &&
      !Array.isArray(row.snapshot) &&
      snapshotHasPlaintextPlaceholder(row.snapshot as Record<string, unknown>)
    );
  }
  return false;
}

async function itemPayload(
  tx: Transaction,
  content: ProtectedContent,
  id: string,
  allowLegacyPlaintextPlaceholder = false,
) {
  const raw = await readItem(tx, id as Uuid);
  if (raw === null) throw new Error("Historical canonical item is unavailable.");
  const [item] = await resolveProtectedContent(tx, [raw], content, {
    allowLegacyPlaintextPlaceholder,
  });
  if (item === undefined) throw new Error("Historical canonical item could not be resolved.");
  const [page] = await tx
    .select()
    .from(schema.pageDocuments)
    .where(eq(schema.pageDocuments.pageId, id));
  const body = (await content.readPageBody(tx, id)) ?? page?.body ?? null;
  if (isProtectedPayload(body)) throw new Error("Historical page body is unavailable.");
  const [file] = await tx
    .select()
    .from(schema.logicalFiles)
    .where(eq(schema.logicalFiles.itemId, id));
  const protectedFileMetadata = await content.readFileMetadata(tx, { kind: "file", id });
  const fileMetadata =
    protectedFileMetadata ??
    (file === undefined ? null : { originalName: file.originalName, mediaType: file.mediaType });
  if (
    protectedFileMetadata === null &&
    fileMetadata?.originalName === SCRUBBED_PLACEHOLDER &&
    !allowLegacyPlaintextPlaceholder
  )
    throw new Error("Historical file metadata is unavailable.");
  const database = await readDatabaseRecord(tx, id as Uuid);
  const entry = await readDatabaseEntryRecord(tx, id as Uuid);
  return {
    item,
    body,
    hasPage: page !== undefined,
    fileMetadata,
    hasFile: file !== undefined,
    database:
      database === null
        ? null
        : { record: database, definition: await resolveDatabaseDefinition(tx, database, content) },
    entry:
      entry === null
        ? null
        : { record: entry, values: await resolveDatabaseEntryValues(tx, entry, content) },
  };
}

async function revisionPayload(
  tx: Transaction,
  content: ProtectedContent,
  id: string,
  allowLegacyPlaintextPlaceholder = false,
) {
  const [row] = await tx.select().from(schema.revisions).where(eq(schema.revisions.id, id));
  if (row === undefined) throw new Error("Historical revision is unavailable.");
  const protectedSnapshot = await content.readRevisionSnapshot<Record<string, unknown>>(tx, id);
  const raw = protectedSnapshot ?? row.snapshot;
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw)))
    throw new Error("Historical revision payload is invalid.");
  const snapshot = raw as Record<string, unknown> | null;
  const page = snapshot?.["pageDocument"];
  if (
    (protectedSnapshot === null &&
      snapshotHasPlaintextPlaceholder(snapshot) &&
      !allowLegacyPlaintextPlaceholder) ||
    (typeof page === "object" && page !== null && "body" in page && isProtectedPayload(page.body))
  )
    throw new Error("A historical snapshot cannot be reconstructed from a marker.");
  return { itemId: row.itemId, snapshot };
}

async function relationshipPayload(tx: Transaction, content: ProtectedContent, id: string) {
  const [row] = await tx.select().from(schema.relationships).where(eq(schema.relationships.id, id));
  if (row === undefined) throw new Error("Historical relationship is unavailable.");
  const metadata = (await content.readRelationshipMetadata(tx, id)) ?? row.metadata;
  if (isProtectedPayload(metadata))
    throw new Error("Historical relationship metadata is unavailable.");
  return { relationType: row.relationType, metadata };
}

async function exportPayload(tx: Transaction, content: ProtectedContent, id: string) {
  const [row] = await tx.select().from(schema.exports).where(eq(schema.exports.id, id));
  if (row === undefined) throw new Error("Historical export is unavailable.");
  return (await content.readExportManifest(tx, id)) ?? row.manifest;
}

export async function canonicalMetadataDigest(
  tx: Transaction,
  content: ProtectedContent,
  source: Pick<CanonicalMetadataSource, "category" | "entityId" | "legacyPlaintextPlaceholder">,
  options: { readonly requireProtected?: boolean } = {},
): Promise<string> {
  const allowLegacyPlaintextPlaceholder =
    source.legacyPlaintextPlaceholder === true && options.requireProtected !== true;
  const payload =
    source.category === "item"
      ? await itemPayload(tx, content, source.entityId, allowLegacyPlaintextPlaceholder)
      : source.category === "revision"
        ? await revisionPayload(tx, content, source.entityId, allowLegacyPlaintextPlaceholder)
        : source.category === "relationship"
          ? await relationshipPayload(tx, content, source.entityId)
          : source.category === "export"
            ? await exportPayload(tx, content, source.entityId)
            : undefined;
  if (payload === undefined) throw new Error("Unsupported canonical metadata source.");
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function inventoryCanonicalMetadata(
  tx: Transaction,
  content: ProtectedContent,
  workspaceId: string,
): Promise<CanonicalMetadataSource[]> {
  const items = await tx
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.workspaceId, workspaceId));
  const revisions = await tx
    .select({ id: schema.revisions.id })
    .from(schema.revisions)
    .innerJoin(schema.items, eq(schema.items.id, schema.revisions.itemId))
    .where(eq(schema.items.workspaceId, workspaceId));
  const relationships = await tx
    .select({ id: schema.relationships.id })
    .from(schema.relationships)
    .where(eq(schema.relationships.workspaceId, workspaceId));
  const exports = await tx
    .select({ id: schema.exports.id })
    .from(schema.exports)
    .where(eq(schema.exports.workspaceId, workspaceId));
  const result: CanonicalMetadataSource[] = [];
  for (const [category, rows] of [
    ["item", items],
    ["revision", revisions],
    ["relationship", relationships],
    ["export", exports],
  ] as const) {
    for (const { id } of rows) {
      const source = {
        kind: "metadata" as const,
        objectId: generateUuidV7(),
        category,
        entityId: id,
        ...((await hasLegacyPlaintextPlaceholder(tx, content, category, id))
          ? { legacyPlaintextPlaceholder: true as const }
          : {}),
      };
      result.push({ ...source, digest: await canonicalMetadataDigest(tx, content, source) });
    }
  }
  return result;
}

/** One canonical source and its checkpoint are handled in the caller's transaction. */
export async function protectCanonicalMetadata(
  tx: Transaction,
  content: ProtectedContent,
  source: CanonicalMetadataSource,
): Promise<void> {
  if ((await canonicalMetadataDigest(tx, content, source)) !== source.digest)
    throw new Error("Historical canonical metadata changed after inventory.");
  const id = source.entityId;
  if (source.category === "item") {
    const value = await itemPayload(tx, content, id, source.legacyPlaintextPlaceholder === true);
    await content.writeItemPresentation(tx, {
      itemId: id,
      recordVersion: 1,
      name: value.item.name,
      icon: value.item.icon,
    });
    if (value.hasPage) {
      await content.writePageBody(tx, { pageId: id, recordVersion: 1, body: value.body });
      await tx
        .update(schema.pageDocuments)
        .set({ body: PROTECTED_PAYLOAD })
        .where(eq(schema.pageDocuments.pageId, id));
    }
    if (value.hasFile && value.fileMetadata !== null) {
      await content.writeFileMetadata(tx, {
        kind: "file",
        id,
        recordVersion: 1,
        metadata: value.fileMetadata,
      });
      await tx
        .update(schema.logicalFiles)
        .set({ originalName: SCRUBBED_PLACEHOLDER, mediaType: "application/octet-stream" })
        .where(eq(schema.logicalFiles.itemId, id));
    }
    if (value.database !== null)
      await content.writeDatabaseDefinition(tx, {
        databaseId: id,
        definitionVersion: value.database.record.definitionVersion,
        definition: value.database.definition,
      });
    if (value.entry !== null)
      await content.writeDatabaseEntryValues(tx, {
        entryId: id,
        valueVersion: value.entry.record.valueVersion,
        values: value.entry.values,
      });
    await tx
      .update(schema.items)
      .set({ name: SCRUBBED_PLACEHOLDER, icon: null })
      .where(eq(schema.items.id, id));
  } else if (source.category === "revision") {
    const { snapshot } = await revisionPayload(
      tx,
      content,
      id,
      source.legacyPlaintextPlaceholder === true,
    );
    if (snapshot !== null) await content.writeRevisionSnapshot(tx, { revisionId: id, snapshot });
    await tx.update(schema.revisions).set({ snapshot: null }).where(eq(schema.revisions.id, id));
  } else if (source.category === "relationship") {
    const value = await relationshipPayload(tx, content, id);
    if (value.relationType !== "database:property") {
      await content.writeRelationshipMetadata(tx, {
        relationshipId: id,
        recordVersion: 1,
        metadata: value.metadata,
      });
      await tx
        .update(schema.relationships)
        .set({ metadata: PROTECTED_PAYLOAD })
        .where(eq(schema.relationships.id, id));
    }
  } else if (source.category === "export") {
    const manifest = await exportPayload(tx, content, id);
    if (manifest !== null) await content.writeExportManifest(tx, { exportId: id, manifest });
    await tx.update(schema.exports).set({ manifest: null }).where(eq(schema.exports.id, id));
  }
  if (
    (await canonicalMetadataDigest(tx, content, source, { requireProtected: true })) !==
    source.digest
  )
    throw new Error("Protected canonical metadata does not match its source.");
}
