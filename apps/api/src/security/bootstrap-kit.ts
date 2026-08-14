/**
 * The recovery kit issued during setup (T059, US4, FR-015, FR-016).
 *
 * Extracted from the application wiring rather than left inline, for a reason
 * that is not tidiness: this is the only code path that produces the file an
 * owner is told to keep forever, and code that only runs from a composition
 * root is code that is only ever exercised by accident.
 *
 * Two properties matter, and both used to be missing.
 *
 * **The artifact holds real material.** It used to emit a format name, a
 * version and an id, and no ciphertext at all — a complete, correct ceremony
 * around a file that could not have recovered anything. An owner who followed
 * every instruction would have found that out at the only moment it cannot be
 * fixed.
 *
 * **It fails closed.** If the deployment key is unavailable there is no kit,
 * and the caller is told so. Emitting a placeholder because the key was
 * missing is how the first version of this came to exist, and it is worse than
 * an error: an error is visible now, and a placeholder is invisible until it
 * matters.
 */

import type { Database } from "@myownnotion/database";
import { findCurrentGeneration } from "@myownnotion/database";
import { createRecoveryKit, type RecoveryKit } from "@myownnotion/domain/security";
import type { KeyHierarchy } from "./key-hierarchy.ts";

/**
 * How long the one-time download stays open.
 *
 * The same window the replacement path uses, and for the same reason: long
 * enough to find a password manager, short enough that walking away from the
 * desk closes it.
 */
export const BOOTSTRAP_KIT_WINDOW_MS = 15 * 60 * 1000;

export class BootstrapKitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapKitUnavailableError";
  }
}

export interface BootstrapKitDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly keys: KeyHierarchy | undefined;
  readonly deploymentKey: () => Buffer | null;
  readonly now: () => Date;
}

/**
 * Builds the kit for a download, at download time.
 *
 * Never stored: `recovery_kits` deliberately keeps only a digest, because the
 * ciphertext is precisely what an attacker with database access wants. The
 * artifact exists for the length of one response.
 */
export async function renderBootstrapKit(
  deps: BootstrapKitDeps,
  kitId: string,
): Promise<RecoveryKit> {
  const key = deps.deploymentKey();
  if (key === null) {
    throw new BootstrapKitUnavailableError(
      "the deployment key is unavailable; no recovery kit can be issued",
    );
  }
  if (deps.keys === undefined) {
    throw new BootstrapKitUnavailableError(
      "the key hierarchy is unavailable; no recovery kit can be issued",
    );
  }

  // The kit is issued *before* ownership is committed, so the root key it
  // carries may not exist yet. Established here and nowhere else in this path,
  // and deliberately without a first generation: the promotion inserts that
  // itself, and a second one violates the partial unique index and fails the
  // whole ceremony.
  await deps.keys.ensureRootKey(deps.db);

  const generation = await findCurrentGeneration(deps.db, deps.workspaceId);
  const now = deps.now();
  return createRecoveryKit({
    installationId: deps.installationId,
    sourceLineageId: deps.workspaceId,
    kitId,
    // The first kit an installation has. Replacements advance it on
    // confirmation; this one is issued before there is anything to supersede.
    recoveryEpoch: 1,
    // Sealed under the mounted deployment key, which is the same secret the
    // installation already depends on to read anything. The consequence — that
    // the file is useless without that key, so both must be kept, apart — is
    // stated beside the download button rather than only in a document.
    secret: { kind: "deployment-key", deploymentKey: new Uint8Array(key) },
    payload: await deps.keys.exportRecoveryMaterial(deps.db),
    // Every generation up to the current one: a restored installation has to
    // open records written under any of them. During bootstrap that is
    // generation one, but reading it rather than assuming it means this stays
    // right if a kit is ever re-issued later.
    supportedKeyGenerations:
      generation === null
        ? [1]
        : Array.from({ length: generation.generation }, (_, index) => index + 1),
    createdAt: now,
    downloadExpiresAt: new Date(now.getTime() + BOOTSTRAP_KIT_WINDOW_MS),
  });
}
