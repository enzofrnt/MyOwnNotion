/**
 * Bootstrap orchestration (T031, feature 002).
 *
 * Ties the domain state machine, the attempt-scoped repository, WebAuthn
 * verification, rate limiting, and the audit trail into the five operations a
 * first-run browser performs. The service owns the secrets that never reach
 * the database in the clear: the browser-held capability and the one-time
 * download token exist here and are persisted only as digests.
 *
 * Everything that decides *whether* a transition is legal lives in the domain.
 * This module decides *what actually happens* — which rows are written, what
 * is audited, and what the browser is told — and it deliberately re-checks the
 * domain's answer inside the transaction, because a concurrent request could
 * have moved the attempt between the read and the write.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  BootstrapClaimConflictError,
  claimAttempt,
  type Database,
  findAttempt,
  findOpenAttempt,
  findProvisionalKit,
  prepareProvisionalKit,
  promoteBootstrap,
  recordKitDownloaded,
  SecurityRepositoryError,
  saveVerifiedCredential,
} from "@myownnotion/database";
import {
  type BootstrapAttempt,
  BootstrapCapabilityError,
  BootstrapTransitionError,
  confirmOfflineStorage,
  consumeDownload,
  countsForBootstrapState,
  prepareRecovery,
  recordCredentialVerified,
  regenerationSupersedes,
  startAttempt,
  verifyAttemptCapability,
} from "@myownnotion/domain";
import type { AuditService } from "./audit-service.ts";
import { clearRateLimit, consumeRateLimit } from "./rate-limit-service.ts";
import type { SecurityConfig } from "./security-config.ts";
import {
  createChallenge,
  relyingParty,
  verifyRegistration,
  type WebAuthnChallenge,
  WebAuthnVerificationError,
} from "./webauthn-service.ts";

/**
 * Opaque secrets are hashed before they touch a row. Domain-separated so a
 * digest computed elsewhere over the same bytes can never be mistaken for one.
 */
function digest(kind: string, value: string): string {
  return createHash("sha256").update(`mn.bootstrap.${kind}.v1`).update(value).digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 48 bytes: comfortably above the contract's 32-character minimum. */
function newSecret(): string {
  return randomBytes(48).toString("base64url");
}

export interface BootstrapServiceDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  /**
   * Seals the workspace's first data key under its root key.
   *
   * Supplied rather than built here so the bootstrap does not need to know how
   * the key hierarchy is put together — but it must be a *real* wrapped key.
   * This was random bytes until T059, which meant generation 1 could never be
   * unwrapped and every protected write after setup depended on a generation
   * that was not one.
   */
  readonly sealFirstDataKey: () => Promise<string>;
  /** Injected so the whole flow is testable at exact instants. */
  readonly now: () => Date;
  /** Challenges live in memory: they are single-use and outlive no request. */
  readonly challenges: Map<string, WebAuthnChallenge>;
}

export class BootstrapRateLimitedError extends SecurityRepositoryError {
  constructor(readonly retryAfter: Date | undefined) {
    super("rate_limited", "too many bootstrap attempts");
    this.name = "BootstrapRateLimitedError";
  }
}

export interface StartedBootstrap {
  readonly attemptId: string;
  /** Returned once, in the response body. Never persisted in the clear. */
  readonly capability: string;
  readonly challenge: string;
  readonly expiresAt: Date;
}

export class BootstrapService {
  readonly #deps: BootstrapServiceDeps;

  constructor(deps: BootstrapServiceDeps) {
    this.#deps = deps;
  }

  #auditContext(correlationId: string) {
    return {
      installationId: this.#deps.installationId,
      correlationId,
      actorClass: "system" as const,
    };
  }

  async #rateLimit(
    operation: Parameters<typeof consumeRateLimit>[1]["operation"],
    subject: string,
  ): Promise<void> {
    const decision = await consumeRateLimit(this.#deps.db, {
      installationId: this.#deps.installationId,
      operation,
      subject,
      now: this.#deps.now(),
    });
    if (!decision.allowed) {
      throw new BootstrapRateLimitedError(decision.retryAfter);
    }
  }

  /**
   * Claims the single attempt and mints the browser-held capability.
   *
   * The capability is returned in the response body and never in a URL, and
   * only its digest is stored — a leaked table dump must not yield a working
   * capability.
   */
  async start(input: { clientNonce: string; correlationId: string }): Promise<StartedBootstrap> {
    await this.#rateLimit("bootstrap.claim", input.clientNonce);
    const now = this.#deps.now();
    const capability = newSecret();
    const attemptId = randomUUID();

    const attempt = startAttempt({
      attemptId,
      installationId: this.#deps.installationId,
      capabilityHash: digest("capability", capability),
      clientNonceHash: digest("nonce", input.clientNonce),
      now,
    });

    let supersededAttemptId: string | null = null;
    try {
      ({ supersededAttemptId } = await claimAttempt(this.#deps.db, attempt, now));
    } catch (error) {
      if (error instanceof BootstrapClaimConflictError) {
        await this.#deps.audit.record(this.#auditContext(input.correlationId), {
          eventType: "bootstrap.claim-conflict",
          outcome: "refused",
          safeCode: "conflict",
        });
      }
      throw error;
    }

    const challenge = createChallenge(now);
    this.#deps.challenges.set(attemptId, challenge);

    if (supersededAttemptId !== null) {
      // Recorded before the new attempt's own event, so the log reads in the
      // order things happened. An operator investigating a lockout needs to
      // see that an attempt was taken over, not just that a new one began.
      await this.#deps.audit.record(this.#auditContext(input.correlationId), {
        eventType: "bootstrap.interrupted",
        // `success` describes the supersession, not the abandoned attempt:
        // taking over a stale slot is the outcome we wanted. The event type
        // already says what happened to the old attempt.
        outcome: "success",
        objectKind: "bootstrap-attempt",
        objectId: supersededAttemptId,
      });
    }

    await this.#deps.audit.record(this.#auditContext(input.correlationId), {
      eventType: "bootstrap.started",
      outcome: "started",
    });

    return {
      attemptId,
      capability,
      challenge: challenge.challenge,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * Loads the attempt and proves the presented capability belongs to it.
   *
   * Both checks together: the attempt ID alone would make the capability
   * decorative, and the capability alone could be replayed against another
   * attempt.
   */
  async #authorize(attemptId: string, capability: string): Promise<BootstrapAttempt> {
    const attempt = await findAttempt(this.#deps.db, attemptId);
    if (attempt === null) {
      throw new BootstrapCapabilityError("no such bootstrap attempt");
    }
    verifyAttemptCapability(
      attempt,
      { attemptId, capabilityHash: digest("capability", capability) },
      constantTimeEquals,
    );
    return attempt;
  }

  /**
   * Verifies the passkey ceremony and prepares the one provisional kit.
   *
   * Still `0/0` afterwards: the credential is held against the attempt and the
   * kit is provisional. Nothing here creates an owner.
   */
  async verifyCredential(input: {
    attemptId: string;
    capability: string;
    response: unknown;
    correlationId: string;
  }): Promise<{ attempt: BootstrapAttempt; kitId: string }> {
    await this.#rateLimit("bootstrap.credential", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    const challenge = this.#deps.challenges.get(input.attemptId);
    if (challenge === undefined) {
      throw new WebAuthnVerificationError();
    }
    // Single-use: consumed whether or not verification succeeds, so a failed
    // ceremony cannot be retried against the same challenge.
    this.#deps.challenges.delete(input.attemptId);

    let registration: Awaited<ReturnType<typeof verifyRegistration>>;
    try {
      registration = await verifyRegistration({
        response: input.response,
        challenge,
        relyingParty: relyingParty(this.#deps.config),
        now,
      });
    } catch (error) {
      await this.#deps.audit.record(this.#auditContext(input.correlationId), {
        eventType: "bootstrap.credential-verified",
        outcome: "failure",
        safeCode: "authentication_failed",
      });
      throw error;
    }

    const verified = recordCredentialVerified(attempt, {
      challengeHash: digest("challenge", challenge.challenge),
      now,
    });
    // Never leaves the server: it binds the attempt to the kit it prepared.
    const downloadBinding = newSecret();
    const kitId = randomUUID();
    const prepared = prepareRecovery(verified, {
      recoveryKitId: kitId,
      downloadTokenHash: digest("download", downloadBinding),
      now,
    });

    await this.#deps.db.transaction(async (tx) => {
      await saveVerifiedCredential(tx, verified, {
        id: randomUUID(),
        attemptId: input.attemptId,
        credentialKind: "passkey",
        credentialIdDigest: registration.credentialId,
        publicKey: registration.publicKey,
        origin: this.#deps.config.publicOrigin.origin,
        relyingPartyId: this.#deps.config.publicOrigin.hostname,
        signCount: registration.signCount,
        userVerified: registration.userVerified,
        verifiedAt: now,
        expiresAt: prepared.downloadExpiresAt ?? now,
      });
      await prepareProvisionalKit(
        tx,
        prepared,
        {
          kitId,
          installationId: this.#deps.installationId,
          sourceLineageId: this.#deps.installationId,
          recoveryEpoch: 1,
          artifactDigest: digest("artifact", kitId),
          downloadTokenHash: digest("download", downloadBinding),
          downloadExpiresAt: prepared.downloadExpiresAt ?? now,
          supportedKeyGenerations: [1],
          createdAt: now,
        },
        null,
      );
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "bootstrap.credential-verified",
        outcome: "success",
      });
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "bootstrap.kit-created",
        outcome: "success",
        objectKind: "recovery-kit",
        objectId: kitId,
      });
    });

    return { attempt: prepared, kitId };
  }

  /**
   * Regenerates the kit on the *same* attempt.
   *
   * The verified credential and the capability are kept; the superseded kit is
   * rejected and expired in the same transaction that prepares its
   * replacement, so there is no window in which two kits are usable.
   */
  async regenerateKit(input: {
    attemptId: string;
    capability: string;
    correlationId: string;
  }): Promise<{ attempt: BootstrapAttempt; kitId: string }> {
    await this.#rateLimit("bootstrap.download", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    const superseded = regenerationSupersedes(attempt);
    // Never leaves the server: it binds the attempt to the kit it prepared.
    const downloadBinding = newSecret();
    const kitId = randomUUID();
    const prepared = prepareRecovery(attempt, {
      recoveryKitId: kitId,
      downloadTokenHash: digest("download", downloadBinding),
      now,
    });

    await this.#deps.db.transaction(async (tx) => {
      await prepareProvisionalKit(
        tx,
        prepared,
        {
          kitId,
          installationId: this.#deps.installationId,
          sourceLineageId: this.#deps.installationId,
          recoveryEpoch: 1,
          artifactDigest: digest("artifact", kitId),
          downloadTokenHash: digest("download", downloadBinding),
          downloadExpiresAt: prepared.downloadExpiresAt ?? now,
          supportedKeyGenerations: [1],
          createdAt: now,
        },
        superseded.previousKitId,
      );
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "bootstrap.kit-regenerated",
        outcome: "success",
        objectKind: "recovery-kit",
        objectId: kitId,
      });
      if (superseded.previousKitId !== null) {
        await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
          eventType: "bootstrap.kit-rejected",
          outcome: "refused",
          objectKind: "recovery-kit",
          objectId: superseded.previousKitId,
        });
      }
    });

    return { attempt: prepared, kitId };
  }

  /**
   * Consumes the one-time download.
   *
   * The client presents nothing but its capability — the normative contract
   * gives this route no request body. One-time-ness is enforced entirely
   * server-side: the domain refuses a second consumption, refuses a closed
   * window, and refuses an attempt whose stored binding disagrees with the kit
   * being downloaded. That last one is what a regeneration racing a download
   * produces, and it is the case a client-held token could not have caught
   * any better.
   */
  async consumeKitDownload(input: {
    attemptId: string;
    capability: string;
    correlationId: string;
  }): Promise<BootstrapAttempt> {
    await this.#rateLimit("bootstrap.download", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    return await this.#deps.db.transaction(async (tx) => {
      const kitId = attempt.recoveryKitId;
      if (kitId === null) {
        throw new BootstrapTransitionError(attempt.state, "download-consumed", "no kit prepared");
      }
      const kit = await findProvisionalKit(tx, kitId);
      if (kit === null) {
        throw new BootstrapTransitionError(attempt.state, "download-consumed", "kit not found");
      }
      // A null hash on either side fails the comparison rather than skipping it.
      const consumedAttempt = consumeDownload(attempt, {
        downloadTokenHash: kit.downloadTokenHash ?? "",
        now,
      });
      await recordKitDownloaded(tx, consumedAttempt, kitId, now);
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "bootstrap.kit-downloaded",
        outcome: "success",
        objectKind: "recovery-kit",
        objectId: kitId,
      });
      return consumedAttempt;
    });
  }

  /**
   * The explicit offline confirmation and the atomic promotion.
   *
   * The domain refuses a confirmation without a consumed download, and the
   * repository refuses it again inside the transaction — a concurrent request
   * could have moved the attempt since it was read.
   */
  async confirmAndPromote(input: {
    attemptId: string;
    capability: string;
    deviceBindingId: string;
    deviceName: string;
    devicePlatform: string | null;
    correlationId: string;
  }): Promise<{ ownerId: string; workspaceId: string; deviceId: string }> {
    await this.#rateLimit("bootstrap.confirm", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    // Throws unless the download was consumed and the window is still open.
    confirmOfflineStorage(attempt, { now });

    const result = await promoteBootstrap(this.#deps.db, {
      attempt,
      ownerId: randomUUID(),
      credentialId: randomUUID(),
      workspaceId: this.#deps.workspaceId,
      workspaceSchemaVersion: this.#deps.workspaceSchemaVersion,
      deviceId: randomUUID(),
      deviceBindingId: input.deviceBindingId,
      deviceName: input.deviceName,
      devicePlatform: input.devicePlatform,
      dataKeyGenerationId: randomUUID(),
      // A real data key, sealed under the workspace root key. This used to be
      // `newSecret()` — random bytes stored where a wrapped key belongs —
      // which meant generation 1, the generation every subsequent protected
      // write depends on, could never be unwrapped.
      wrappedDataKey: await this.#deps.sealFirstDataKey(),
      recoveryEpochId: randomUUID(),
      now,
    });

    await this.#deps.audit.record(
      { ...this.#auditContext(input.correlationId), workspaceId: result.workspaceId },
      { eventType: "bootstrap.confirmed", outcome: "success" },
    );
    // The promotion creates the owner's first device. Recording it here rather
    // than leaving it implied by `bootstrap.confirmed` is what lets the device
    // trail be read on its own: every later revocation and reauthorization
    // refers to a device whose authorization would otherwise appear nowhere.
    await this.#deps.audit.record(
      { ...this.#auditContext(input.correlationId), workspaceId: result.workspaceId },
      {
        eventType: "device.authorized",
        outcome: "success",
        objectKind: "device",
        objectId: result.deviceId,
      },
    );
    await clearRateLimit(this.#deps.db, {
      installationId: this.#deps.installationId,
      operation: "bootstrap.claim",
      subject: input.attemptId,
    });
    this.#deps.challenges.delete(input.attemptId);

    // Cross-check the domain's own view before telling the browser it is done.
    const counts = countsForBootstrapState("confirmed");
    if (counts.ownerCount !== result.ownerCount) {
      throw new SecurityRepositoryError(
        "internal_error",
        "domain and repository disagree on the promoted counts",
      );
    }
    return result;
  }

  /** The single open attempt, for resuming an interrupted first run. */
  async openAttempt(): Promise<BootstrapAttempt | null> {
    return findOpenAttempt(this.#deps.db, { installationId: this.#deps.installationId });
  }
}
