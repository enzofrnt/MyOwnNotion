/**
 * Replacing a recovery kit (T081, US5, FR-016, FR-018).
 *
 * A kit is what turns "the machine is gone" from a catastrophe into an
 * afternoon. Replacing one is therefore an operation performed by someone who
 * is already worried — because they think the old kit was seen, or because
 * they are moving house, or because a rotation invalidated it — and the design
 * follows from that rather than from the happy path.
 *
 * **The old kit stays usable until the new one is confirmed.** An owner who
 * begins a replacement and is interrupted must still be able to recover with
 * the kit in their safe. Any window with no usable kit is a window in which an
 * unlucky disk failure is unrecoverable, and the window is created by the very
 * operation meant to improve their position.
 *
 * **Downloading is once, and confirming requires having downloaded.** An owner
 * cannot have stored a file they never received. The confirmation is the one
 * check standing between "I clicked the button" and an installation whose only
 * kit is a file nobody has.
 *
 * **The kit is sealed under the mounted deployment key**, per the installation
 * owner's decision, so it carries no passphrase. That has a consequence this
 * service states in every message it produces, because a kit that appears
 * self-sufficient and is not is worse than no kit at all: **the deployment key
 * must be backed up alongside it**. Losing the key loses the kit's contents,
 * and nothing in this file can soften that.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@myownnotion/database";
import {
  confirmReplacementKit,
  consumeKitDownload,
  currentRecoveryEpoch,
  findActiveKit,
  findKit,
  findPendingKit,
  prepareReplacementKit,
  type RecoveryKitRecord,
  revokeActiveKit,
  runSecurityTransaction,
} from "@myownnotion/database";
import { createRecoveryKit, type RecoveryKit } from "@myownnotion/domain/security";

/**
 * How long a prepared kit may be downloaded for.
 *
 * Short, because the window is the period in which a one-time download is
 * sitting unclaimed and a stolen session could take it. Fifteen minutes is
 * long enough for an owner to find their password manager and short enough
 * that walking away from the desk closes it.
 */
export const KIT_DOWNLOAD_WINDOW_MS = 15 * 60 * 1000;

/**
 * The sentence every kit-related response carries.
 *
 * Not a footnote. The owner's decision was that the kit is sealed under the
 * deployment key, which means the file alone recovers nothing — and an owner
 * who does not know that will store the kit carefully, delete the key with the
 * old machine, and discover the gap at the only moment it cannot be fixed.
 */
export const DEPLOYMENT_KEY_NOTICE =
  "This kit is unlocked by this installation's deployment key. Back that key up somewhere else as well — the kit alone cannot restore anything.";

export interface RecoveryKitServiceDeps {
  readonly db: Database;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly workspaceId: string;
  /** Reads the mounted deployment key, or null when it is unavailable. */
  readonly deploymentKey: () => Buffer | null;
  /** The generations a restored installation would have to be able to open. */
  readonly supportedKeyGenerations: () => Promise<readonly number[]>;
  /** The material the kit protects. */
  readonly recoveryPayload: () => Promise<Uint8Array>;
  readonly now: () => Date;
  readonly newId?: () => string;
}

export class RecoveryKitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryKitError";
    this.code = code;
  }
}

export interface PreparedKitView {
  readonly kitId: string;
  readonly recoveryEpoch: number;
  readonly downloadExpiresAt: string;
  readonly notice: string;
}

export interface KitStatusView {
  readonly active: {
    readonly kitId: string;
    readonly recoveryEpoch: number;
    readonly confirmedAt: string | null;
  } | null;
  readonly pending: {
    readonly kitId: string;
    readonly deliveryState: string;
    readonly downloadExpiresAt: string | null;
  } | null;
  readonly notice: string;
}

export class RecoveryKitService {
  readonly #deps: RecoveryKitServiceDeps;
  /**
   * Prepared artifacts, held until their one download.
   *
   * In memory and nowhere else. The kit's ciphertext is the thing an attacker
   * with database access most wants, and persisting it would put it exactly
   * there. A restart loses an unclaimed preparation, which is the right
   * failure: the owner prepares another.
   */
  readonly #prepared = new Map<string, RecoveryKit>();

  constructor(deps: RecoveryKitServiceDeps) {
    this.#deps = deps;
  }

  #id(): string {
    return (this.#deps.newId ?? (() => randomUUID()))();
  }

  async status(): Promise<KitStatusView> {
    const [active, pending] = await Promise.all([
      findActiveKit(this.#deps.db, this.#deps.installationId),
      findPendingKit(this.#deps.db, this.#deps.installationId),
    ]);
    return {
      active:
        active === null
          ? null
          : {
              kitId: active.id,
              recoveryEpoch: active.recoveryEpoch,
              confirmedAt: active.confirmedAt?.toISOString() ?? null,
            },
      pending:
        pending === null
          ? null
          : {
              kitId: pending.id,
              deliveryState: pending.deliveryState,
              downloadExpiresAt: pending.downloadExpiresAt?.toISOString() ?? null,
            },
      notice: DEPLOYMENT_KEY_NOTICE,
    };
  }

  /**
   * Prepares a replacement. Does not retire the kit currently in use.
   *
   * The epoch of the *next* kit is one past the current one, but the epoch row
   * does not move until confirmation: an epoch that advanced here would
   * invalidate the kit the owner still holds, in the middle of an operation
   * they might not finish.
   */
  async prepareReplacement(): Promise<PreparedKitView> {
    const key = this.#deps.deploymentKey();
    if (key === null) {
      throw new RecoveryKitError(
        "recovery_unavailable",
        "the deployment key is unavailable, so a kit cannot be sealed",
      );
    }

    const generations = await this.#deps.supportedKeyGenerations();
    if (generations.length === 0) {
      throw new RecoveryKitError(
        "recovery_unavailable",
        "this installation has no key generation to recover into",
      );
    }
    const payload = await this.#deps.recoveryPayload();
    const now = this.#deps.now();
    const kitId = this.#id();
    const epoch = (await currentRecoveryEpoch(this.#deps.db, this.#deps.installationId)) + 1;
    const downloadExpiresAt = new Date(now.getTime() + KIT_DOWNLOAD_WINDOW_MS);

    const artifact = createRecoveryKit({
      installationId: this.#deps.installationId,
      sourceLineageId: this.#deps.sourceLineageId,
      kitId,
      recoveryEpoch: epoch,
      secret: { kind: "deployment-key", deploymentKey: new Uint8Array(key) },
      payload,
      supportedKeyGenerations: generations,
      createdAt: now,
      downloadExpiresAt,
    });

    await runSecurityTransaction(this.#deps.db, async (tx) =>
      prepareReplacementKit(tx, {
        kitId,
        installationId: this.#deps.installationId,
        sourceLineageId: this.#deps.sourceLineageId,
        recoveryEpoch: epoch,
        // A digest of the artifact, never the artifact. The row exists so an
        // operator can tell whether the file an owner produces is the one this
        // installation issued; storing the ciphertext would put the thing
        // being protected in the database it is meant to survive.
        artifactDigest: digestOf(artifact),
        downloadTokenHash: hashToken(kitId),
        downloadExpiresAt,
        supportedKeyGenerations: generations,
        now,
      }),
    );

    this.#prepared.set(kitId, artifact);
    return {
      kitId,
      recoveryEpoch: epoch,
      downloadExpiresAt: downloadExpiresAt.toISOString(),
      notice: DEPLOYMENT_KEY_NOTICE,
    };
  }

  /**
   * Hands over the artifact, once.
   *
   * The consumption is recorded before the bytes are returned. If the
   * transaction fails the owner gets nothing and can prepare another kit; if
   * the order were reversed, a failure after sending would leave a kit that
   * had been delivered and did not know it, and a second request would deliver
   * it again.
   */
  async download(kitId: string): Promise<RecoveryKit> {
    const record = await findKit(this.#deps.db, kitId);
    if (record === null || record.installationId !== this.#deps.installationId) {
      throw new RecoveryKitError("not_found", "no such recovery kit");
    }
    if (record.downloadExpiresAt !== null && record.downloadExpiresAt <= this.#deps.now()) {
      throw new RecoveryKitError("recovery_unavailable", "the download window has closed");
    }
    const artifact = this.#prepared.get(kitId);
    if (artifact === undefined) {
      // Prepared by a process that has since restarted. Saying so plainly is
      // better than a generic failure: the owner's next step is to prepare
      // another kit, and nothing has been lost.
      throw new RecoveryKitError(
        "recovery_unavailable",
        "this preparation is no longer available; prepare a new kit",
      );
    }

    const consumed = await runSecurityTransaction(this.#deps.db, async (tx) =>
      consumeKitDownload(tx, { kitId, now: this.#deps.now() }),
    );
    if (!consumed) {
      throw new RecoveryKitError("conflict", "this kit has already been downloaded");
    }
    this.#prepared.delete(kitId);
    return artifact;
  }

  /**
   * Confirms the owner has stored the kit.
   *
   * This is the moment the replacement takes effect: the new kit becomes the
   * one that works, the old one is superseded, and the epoch advances — all in
   * one transaction, because a kit bound to an epoch that is no longer current
   * cannot be opened, and an interruption between them would produce exactly
   * that.
   */
  async confirm(kitId: string): Promise<{ recoveryEpoch: number; notice: string }> {
    const record = await findKit(this.#deps.db, kitId);
    if (record === null || record.installationId !== this.#deps.installationId) {
      throw new RecoveryKitError("not_found", "no such recovery kit");
    }
    const confirmed = await runSecurityTransaction(this.#deps.db, async (tx) =>
      confirmReplacementKit(tx, {
        kitId,
        installationId: this.#deps.installationId,
        newEpoch: record.recoveryEpoch,
        epochId: this.#id(),
        now: this.#deps.now(),
      }),
    );
    if (!confirmed) {
      throw new RecoveryKitError(
        "conflict",
        "this kit cannot be confirmed: it has not been downloaded, or it is no longer current",
      );
    }
    return { recoveryEpoch: record.recoveryEpoch, notice: DEPLOYMENT_KEY_NOTICE };
  }

  /**
   * Revokes the active kit without replacing it.
   *
   * Leaves the installation with no usable kit, deliberately. An owner who
   * believes their kit has been seen needs to say so *now*; making them wait
   * for a replacement to be generated, downloaded, and confirmed would leave
   * the compromised kit valid throughout, which is the opposite of what they
   * asked for.
   */
  async revoke(): Promise<{ revocationCode: string }> {
    const revocationCode = randomBytes(6).toString("hex");
    const revoked = await runSecurityTransaction(this.#deps.db, async (tx) =>
      revokeActiveKit(tx, {
        installationId: this.#deps.installationId,
        revocationCode,
        now: this.#deps.now(),
      }),
    );
    if (!revoked) {
      throw new RecoveryKitError("not_found", "there is no active recovery kit to revoke");
    }
    return { revocationCode };
  }
}

/** A digest over the artifact as it will be written to disk. */
function digestOf(artifact: RecoveryKit): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

/**
 * The download token, hashed.
 *
 * Derived from the kit id rather than issued separately, because the route
 * already authenticates the owner and the token exists to bind *this*
 * preparation to *this* download — not to authorize anyone. A separate random
 * token would be a second secret to deliver, with no additional property.
 */
function hashToken(kitId: string): string {
  return createHash("sha256").update(`recovery-download:${kitId}`).digest("hex");
}

export type { RecoveryKitRecord };
