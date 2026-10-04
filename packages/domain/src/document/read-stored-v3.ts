import { normaliseDocumentV3 } from "./document.ts";
import { migrateStoredPageDocumentToV3 } from "./migrate-v3.ts";
export function readStoredDocumentV3(envelope: unknown) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const record = envelope as Record<string, unknown>;
  if (typeof record["formatVersion"] !== "number") return null;
  const migrated = migrateStoredPageDocumentToV3({
    formatVersion: record["formatVersion"],
    body: record["body"],
  });
  return migrated.ok ? normaliseDocumentV3(migrated.document) : null;
}
