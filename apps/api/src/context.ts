/**
 * Shared application context passed to every route module.
 */

import type { ContentStore, PartialUploadStore } from "@myownnotion/blob-store";
import type { Database } from "@myownnotion/database";
import type { Uuid } from "@myownnotion/domain";
import type { SearchService } from "./search/search-service.ts";
import type { DeviceService } from "./security/device-service.ts";
import type { ProtectedContent } from "./security/protected-content.ts";
import type { RotationPolicyService } from "./security/rotation-policy-service.ts";

export interface AppContext {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly schemaVersion: number;
  readonly contentStore: ContentStore;
  /**
   * Where an unfinished transfer accumulates (feature 005).
   *
   * Separate from `contentStore` because a partial upload has no digest yet, and
   * the content store's whole invariant is that a key *is* a digest.
   */
  readonly partialUploads: PartialUploadStore;
  /**
   * Present only when the security layer is configured.
   *
   * Feature-001 routes seal their payloads through this when it exists and
   * behave exactly as before when it does not, so a harness that builds the
   * app without a security configuration needs no deployment key.
   */
  readonly protectedContent?: ProtectedContent | undefined;
  /** Refuses protected writes once a rotation policy reaches its block. */
  readonly rotationPolicies?: RotationPolicyService | undefined;
  /**
   * The device inventory, present only when the security layer is configured.
   *
   * The change stream consults it so a revoked device's stream is closed and
   * refused on reconnect by the server (FR-021). Asking the client to stop
   * would make the guarantee depend on the cooperation of the one party that
   * has a reason not to cooperate.
   */
  readonly devices?: DeviceService | undefined;
  /** Transient private workspace index, present once the search feature is wired. */
  readonly search?: SearchService | undefined;
}
