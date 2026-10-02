import { isQuotaError } from "../local-store/storage-errors.ts";
import { LocalIntegrityError, LocalKeyLockedError, LocalKeyLostError } from "../security/index.ts";
import type { PageSyncBlockedReason } from "./page-sync-state.ts";
export function classifyPageSyncBlockedReason(error: unknown): PageSyncBlockedReason {
  if (isQuotaError(error)) return "quota";
  if (error instanceof LocalKeyLockedError || error instanceof LocalKeyLostError) return "key";
  if (error instanceof LocalIntegrityError) return "integrity";
  const name =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name.toLowerCase()
      : "";
  if (name.includes("protocol")) return "protocol";
  if (name.includes("validation") || name.includes("schema")) return "validation";
  return "storage";
}
