import {
  type Database,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  SCRUBBED_PLACEHOLDER,
  schema,
  type Transaction,
} from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import type { ProtectedContent } from "./protected-content.ts";

/** Reserved storage marker; never an authorized content projection. */
export const PROTECTED_PAYLOAD = { $myownnotionProtected: 1 } as const;
export function isProtectedPayload(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "$myownnotionProtected" in value &&
    value.$myownnotionProtected === 1
  );
}
function required<T>(value: T | null): T {
  if (value === null) throw new Error("Protected canonical content is unavailable.");
  return value;
}

/** Resolve only scrubbed fields; newly authored values in this transaction win. */
export async function resolveSnapshotPayload(
  tx: Database | Transaction,
  content: ProtectedContent,
  itemId: string,
  snapshot: Record<string, unknown>,
  iconChanged = false,
): Promise<Record<string, unknown>> {
  const resolved = { ...snapshot };
  const presentation = await content.readItemPresentation(tx, itemId);
  if (snapshot["name"] === SCRUBBED_PLACEHOLDER) {
    resolved["name"] = required(presentation).name;
  }
  if (!iconChanged && presentation !== null && "icon" in snapshot && snapshot["icon"] == null)
    resolved["icon"] = presentation.icon;
  const page = snapshot["pageDocument"];
  if (
    typeof page === "object" &&
    page !== null &&
    "body" in page &&
    isProtectedPayload(page.body)
  ) {
    resolved["pageDocument"] = { ...page, body: required(await content.readPageBody(tx, itemId)) };
  }
  const file = snapshot["file"];
  if (
    typeof file === "object" &&
    file !== null &&
    "originalName" in file &&
    file.originalName === SCRUBBED_PLACEHOLDER
  ) {
    resolved["file"] = {
      ...file,
      ...required(await content.readFileMetadata(tx, { kind: "file", id: itemId })),
    };
  }
  const database = await readDatabaseRecord(tx, itemId as Uuid);
  if (database !== null && resolved["databaseDefinition"] === undefined) {
    resolved["databaseDefinition"] = required(
      await content.readDatabaseDefinition(tx, itemId, database.definitionVersion),
    );
    resolved["databaseDefinitionVersion"] = database.definitionVersion;
  }
  const entry = await readDatabaseEntryRecord(tx, itemId as Uuid);
  if (entry !== null && resolved["databaseEntryValues"] === undefined) {
    resolved["databaseId"] = entry.databaseId;
    resolved["databaseEntryValues"] = required(
      await content.readDatabaseEntryValues(tx, itemId, entry.valueVersion),
    );
    resolved["databaseEntryValueVersion"] = entry.valueVersion;
  }
  return resolved;
}

/** Seal then neutralize one current item, in the accepted write transaction. */
export async function protectCurrentItem(
  tx: Transaction,
  content: ProtectedContent,
  itemId: string,
  iconChanged = false,
): Promise<void> {
  const [item] = await tx.select().from(schema.items).where(eq(schema.items.id, itemId));
  if (item === undefined) throw new Error("Accepted item is unavailable.");
  const prior = await content.readItemPresentation(tx, itemId);
  await content.writeItemPresentation(tx, {
    itemId,
    recordVersion: 1,
    name: item.name === SCRUBBED_PLACEHOLDER ? required(prior).name : item.name,
    icon: prior !== null && !iconChanged ? prior.icon : item.icon,
  });
  const [page] = await tx
    .select()
    .from(schema.pageDocuments)
    .where(eq(schema.pageDocuments.pageId, itemId));
  if (page !== undefined) {
    const body = isProtectedPayload(page.body)
      ? required(await content.readPageBody(tx, itemId))
      : page.body;
    await content.writePageBody(tx, { pageId: itemId, recordVersion: 1, body });
    await tx
      .update(schema.pageDocuments)
      .set({ body: PROTECTED_PAYLOAD })
      .where(eq(schema.pageDocuments.pageId, itemId));
  }
  const [file] = await tx
    .select()
    .from(schema.logicalFiles)
    .where(eq(schema.logicalFiles.itemId, itemId));
  if (file !== undefined) {
    const metadata =
      file.originalName === SCRUBBED_PLACEHOLDER
        ? required(await content.readFileMetadata(tx, { kind: "file", id: itemId }))
        : { originalName: file.originalName, mediaType: file.mediaType };
    await content.writeFileMetadata(tx, { kind: "file", id: itemId, recordVersion: 1, metadata });
    await tx
      .update(schema.logicalFiles)
      .set({ originalName: SCRUBBED_PLACEHOLDER, mediaType: "application/octet-stream" })
      .where(eq(schema.logicalFiles.itemId, itemId));
  }
  await tx
    .update(schema.items)
    .set({ name: SCRUBBED_PLACEHOLDER, icon: null })
    .where(eq(schema.items.id, itemId));
}
