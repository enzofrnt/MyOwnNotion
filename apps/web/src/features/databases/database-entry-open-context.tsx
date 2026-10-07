import type { Uuid } from "@myownnotion/domain";
import { createContext } from "react";

export interface DatabaseEntryOpenRequest {
  readonly entryId: Uuid;
  readonly sourceId?: Uuid;
  readonly trigger: HTMLElement | null;
}
/** Database entry presentation is distinct from ordinary item navigation. */
export const DatabaseEntryOpenContext = createContext<
  ((request: DatabaseEntryOpenRequest) => void) | null
>(null);
