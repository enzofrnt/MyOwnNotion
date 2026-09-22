/**
 * Bootstrap orchestration (T031 / T133, feature 002).
 *
 * Ties the domain state machine, the attempt-scoped repository, WebAuthn
 * verification, password hashing, rate limiting, and the audit trail into the
 * operations a first-run browser performs. The service owns the secrets that
 * never reach the database in the clear: the browser-held capability exists
 * here and is persisted only as a digest.
 *
 * Happy path: start → verify passkey → set password → confirm. Recovery kits
 * are settings concerns after readiness.
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
  confirmBootstrap,
  consumeDownload,
  countsForBootstrapState,
  prepareRecovery,
  recordCredentialVerified,
  recordPasswordSet,
  regenerationSupersedes,
  startAttempt,
  verifyAttemptCapability,
} from "@myownnotion/domain";
import type { AuditService } from "./audit-service.ts";
import { hashPassword } from "./password-service.ts";
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

/** Pending credential rows need an expiry; password setup uses a long bound. */
const PENDING_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface BootstrapServiceDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly workspaceSchemaVersion: number;
  /**
   * Seals the workspace's first data key under its root key.
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
   * Claims the attempt and mints the browser-held capability.
   *
   * While ownership is still `0/0`, any incomplete open attempt is abandoned.
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
      await this.#deps.audit.record(this.#auditContext(input.correlationId), {
        eventType: "bootstrap.interrupted",
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
   * Verifies the passkey ceremony. Still `0/0` afterwards — no kit, no owner.
   */
  async verifyCredential(input: {
    attemptId: string;
    capability: string;
    response: unknown;
    correlationId: string;
  }): Promise<{ attempt: BootstrapAttempt }> {
    await this.#rateLimit("bootstrap.credential", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    const challenge = this.#deps.challenges.get(input.attemptId);
    if (challenge === undefined) {
      throw new WebAuthnVerificationError();
    }
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
        expiresAt: new Date(now.getTime() + PENDING_CREDENTIAL_TTL_MS),
      });
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "bootstrap.credential-verified",
        outcome: "success",
      });
    });

    return { attempt: verified };
  }

  /**
   * Records the password alternative and moves the attempt to `password-set`.
   */
  async setPassword(input: {
    attemptId: string;
    capability: string;
    password: string;
    correlationId: string;
  }): Promise<{ attempt: BootstrapAttempt }> {
    await this.#rateLimit("bootstrap.credential", input.attemptId);
    const attempt = await this.#authorize(input.attemptId, input.capability);
    const now = this.#deps.now();

    const hashed = await hashPassword(input.password);
    const passwordSet = recordPasswordSet(attempt, { now });

    await this.#deps.db.transaction(async (tx) => {
      await saveVerifiedCredential(tx, passwordSet, {
        id: randomUUID(),
        attemptId: input.attemptId,
        credentialKind: "password",
        credentialIdDigest: digest("password-handle", input.attemptId),
        passwordHash: hashed.encoded,
        hashAlgorithm: hashed.algorithm,
        origin: this.#deps.config.publicOrigin.origin,
        signCount: 0,
        userVerified: true,
        verifiedAt: now,
        expiresAt: new Date(now.getTime() + PENDING_CREDENTIAL_TTL_MS),
      });
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "auth.password-set",
        outcome: "success",
      });
    });

    return { attempt: passwordSet };
  }

  /**
   * Legacy kit regeneration. Unused by the happy-path UI.
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
   * Legacy one-time kit download. Unused by the happy-path UI.
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
   * Confirms from `password-set` and runs the atomic promotion.
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

    confirmBootstrap(attempt, { now });

    const result = await promoteBootstrap(this.#deps.db, {
      attempt,
      ownerId: randomUUID(),
      passkeyCredentialId: randomUUID(),
      passwordCredentialId: randomUUID(),
      workspaceId: this.#deps.workspaceId,
      workspaceSchemaVersion: this.#deps.workspaceSchemaVersion,
      deviceId: randomUUID(),
      deviceBindingId: input.deviceBindingId,
      deviceName: input.deviceName,
      devicePlatform: input.devicePlatform,
      dataKeyGenerationId: randomUUID(),
      wrappedDataKey: await this.#deps.sealFirstDataKey(),
      now,
    });

    await this.#deps.audit.record(
      { ...this.#auditContext(input.correlationId), workspaceId: result.workspaceId },
      { eventType: "bootstrap.confirmed", outcome: "success" },
    );
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
