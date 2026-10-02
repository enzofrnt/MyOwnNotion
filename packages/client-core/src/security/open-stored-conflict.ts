import type { ConflictRecordRow } from "../local-store/schema.ts";
import type { LocalRecordCodec, SealedConflictRecordRow } from "./local-record-codec.ts";
export async function openStoredConflict(
  stored: unknown,
  codec?: LocalRecordCodec,
): Promise<ConflictRecordRow> {
  if (typeof stored === "object" && stored !== null && "payload" in stored)
    return stored as ConflictRecordRow;
  if (codec === undefined)
    throw new Error("A local record codec is required to open sealed conflicts");
  return await codec.openConflict(stored as SealedConflictRecordRow);
}
