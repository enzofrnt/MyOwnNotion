/** Shared construction of the protected-content read/write boundary. */

import type { Database } from "@myownnotion/database";
import { KeyHierarchy } from "./key-hierarchy.ts";
import { ProtectedContent } from "./protected-content.ts";
import { type IntegrityFailure, ProtectedRecordService } from "./protected-record-service.ts";

/** The stable identity used by the single local installation. */
export const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";

export function createProtectedContentRuntime(input: {
  readonly db: Database;
  readonly workspaceId: string;
  readonly installationId?: string;
  readonly deploymentKey: () => Buffer | null;
  readonly now?: () => Date;
  readonly reportIntegrityFailure?: (failure: IntegrityFailure) => Promise<void>;
}): {
  readonly keys: KeyHierarchy;
  readonly records: ProtectedRecordService;
  readonly content: ProtectedContent;
} {
  const installationId = input.installationId ?? INSTALLATION_ID;
  const now = input.now ?? (() => new Date());
  const keys = new KeyHierarchy({
    db: input.db,
    installationId,
    workspaceId: input.workspaceId,
    deploymentKey: input.deploymentKey,
    now,
  });
  const records = new ProtectedRecordService({
    db: input.db,
    keys,
    installationId,
    workspaceId: input.workspaceId,
    now,
    ...(input.reportIntegrityFailure === undefined
      ? {}
      : { reportIntegrityFailure: input.reportIntegrityFailure }),
  });
  return { keys, records, content: new ProtectedContent({ records }) };
}
