/**
 * Shared application context passed to every route module.
 */

import type { ContentStore } from "@myownnotion/blob-store";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { ProtectedContent } from "./security/protected-content.ts";

export interface AppContext {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly contentStore: ContentStore;
  /**
   * Present only when the security layer is configured.
   *
   * Feature-001 routes seal their payloads through this when it exists and
   * behave exactly as before when it does not, so a harness that builds the
   * app without a security configuration needs no deployment key.
   */
  readonly protectedContent?: ProtectedContent | undefined;
}
