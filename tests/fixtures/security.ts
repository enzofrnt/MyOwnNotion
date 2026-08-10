/**
 * Owner security foundation test harness (T003, feature 002).
 *
 * Entry points shared by unit, property, integration, contract, and API
 * suites. Playwright-only helpers (virtual authenticator over CDP, browser
 * journeys) live in `tests/e2e/helpers.ts`; nothing here imports Playwright.
 *
 * The harness provides six things the security suites cannot fake ad hoc:
 *
 *   1. a controlled clock, so 15-minute bootstrap windows, 1–90 day inactivity
 *      expiry, and 1–60 minute recent-authentication bounds are asserted at
 *      exact instants rather than by sleeping;
 *   2. disposable-installation identity, so every trial starts from an empty
 *      installation with `ownerCount=0` / `workspaceCount=0`;
 *   3. mounted-secret fixtures, so deployment-key loading, permission checks,
 *      and unavailable/invalid-key fail-closed paths are exercised against
 *      real files with real modes;
 *   4. feature-001 identity fixtures, which preserve the canonical workspace
 *      and content IDs without editing any feature-001 artifact;
 *   5. a software WebAuthn authenticator, so passkey ceremonies run
 *      deterministically outside a browser;
 *   6. fault injection, so a failure can be placed at an exact boundary
 *      (credential verification, kit creation, download consumption,
 *      confirmation, retry, key unavailability).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// 1. Controlled clock
// ---------------------------------------------------------------------------

/** Fixed origin for every security suite, so recorded evidence is comparable. */
export const SECURITY_CLOCK_ORIGIN = new Date("2026-01-01T00:00:00.000Z");

export interface ControlledClock {
  /** Current instant. Never advances on its own. */
  now(): Date;
  nowMs(): number;
  advanceMs(milliseconds: number): Date;
  advanceSeconds(seconds: number): Date;
  advanceMinutes(minutes: number): Date;
  advanceDays(days: number): Date;
  /** Jumps to an absolute instant, including backwards, for skew tests. */
  set(instant: Date): Date;
  reset(): Date;
}

export function createControlledClock(origin: Date = SECURITY_CLOCK_ORIGIN): ControlledClock {
  let current = origin.getTime();
  const clock: ControlledClock = {
    now: () => new Date(current),
    nowMs: () => current,
    advanceMs: (milliseconds) => {
      current += milliseconds;
      return new Date(current);
    },
    advanceSeconds: (seconds) => clock.advanceMs(seconds * 1_000),
    advanceMinutes: (minutes) => clock.advanceMs(minutes * 60_000),
    advanceDays: (days) => clock.advanceMs(days * 86_400_000),
    set: (instant) => {
      current = instant.getTime();
      return new Date(current);
    },
    reset: () => clock.set(origin),
  };
  return clock;
}

/** Policy bounds asserted by the session and bootstrap suites. */
export const SECURITY_POLICY_BOUNDS = {
  bootstrapKitWindowMinutes: 15,
  inactivityExpiryDaysMin: 1,
  inactivityExpiryDaysMax: 90,
  inactivityExpiryDaysDefault: 30,
  recentAuthenticationMinutesMin: 1,
  recentAuthenticationMinutesMax: 60,
  recentAuthenticationMinutesDefault: 15,
} as const;

// ---------------------------------------------------------------------------
// 2. Disposable installation
// ---------------------------------------------------------------------------

/**
 * Committed counts an installation must report. Before the single atomic
 * ownership/workspace promotion the installation is `0/0`; every initialized
 * state is `1/1` (FR-001, FR-024, SC-001).
 */
export interface InstallationCounts {
  readonly ownerCount: 0 | 1;
  readonly workspaceCount: 0 | 1;
}

export const UNINITIALIZED_COUNTS: InstallationCounts = { ownerCount: 0, workspaceCount: 0 };
export const INITIALIZED_COUNTS: InstallationCounts = { ownerCount: 1, workspaceCount: 1 };

/** Every installation state that must report `1/1`. */
export const INITIALIZED_INSTALLATION_STATES = [
  "recovery-required",
  "ready",
  "migration-in-progress",
  "degraded",
] as const;

/** Every installation state that must report `0/0`. */
export const UNINITIALIZED_INSTALLATION_STATES = [
  "uninitialized",
  "bootstrap-in-progress",
] as const;

export interface DisposableInstallation {
  readonly installationId: string;
  /** Root of a per-trial temporary directory: secrets, blobs, exports. */
  readonly root: string;
  readonly secretsDir: string;
  readonly blobRoot: string;
  cleanup(): void;
}

export function createDisposableInstallation(): DisposableInstallation {
  const root = mkdtempSync(path.join(tmpdir(), "mn-security-"));
  const secretsDir = path.join(root, "secrets");
  const blobRoot = path.join(root, "blobs");
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  mkdirSync(blobRoot, { recursive: true, mode: 0o700 });
  return {
    installationId: randomUUID(),
    root,
    secretsDir,
    blobRoot,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Mounted secrets
// ---------------------------------------------------------------------------

/** How a deployment-key fixture should be wrong, when it should be wrong. */
export type MountedSecretDefect =
  | "none"
  /** File absent: the key is unavailable and reads must fail closed. */
  | "missing"
  /** Readable by group/other: permission check must refuse it. */
  | "world-readable"
  /** Present but not a valid 32-byte key: must fail closed, not guess. */
  | "truncated"
  | "empty"
  | "not-base64";

export interface MountedSecret {
  readonly path: string;
  /** Raw key bytes, absent when the fixture is deliberately defective. */
  readonly keyBytes?: Uint8Array;
  readonly defect: MountedSecretDefect;
}

/**
 * Writes a deployment wrapping-key fixture with a real file mode, so the
 * permission check in `apps/api/src/security/deployment-key.ts` is exercised
 * rather than mocked.
 */
export function createMountedDeploymentKey(
  installation: DisposableInstallation,
  defect: MountedSecretDefect = "none",
  fileName = "deployment-key",
): MountedSecret {
  const target = path.join(installation.secretsDir, fileName);

  if (defect === "missing") {
    return { path: target, defect };
  }

  const keyBytes = randomBytes(32);
  const contents: Record<Exclude<MountedSecretDefect, "missing">, string> = {
    none: keyBytes.toString("base64"),
    "world-readable": keyBytes.toString("base64"),
    truncated: keyBytes.subarray(0, 16).toString("base64"),
    empty: "",
    "not-base64": "this is not a key",
  };

  writeFileSync(target, `${contents[defect]}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(target, defect === "world-readable" ? 0o644 : 0o400);

  // Only a well-formed fixture exposes its bytes; a defective one has no key
  // the suite is allowed to reason about.
  return defect === "none" || defect === "world-readable"
    ? { path: target, keyBytes: new Uint8Array(keyBytes), defect }
    : { path: target, defect };
}

// ---------------------------------------------------------------------------
// 4. Feature-001 identity preservation
// ---------------------------------------------------------------------------

/**
 * A snapshot of the canonical identities feature 001 owns. Security work binds
 * to these IDs; it never mints a second workspace and never rewrites content
 * identities. Suites capture a snapshot before a security operation and assert
 * `assertIdentitiesPreserved` after it.
 */
export interface CanonicalIdentitySnapshot {
  readonly workspaceId: string;
  readonly itemIds: readonly string[];
  readonly revisionIds: readonly string[];
  readonly fileContentIds: readonly string[];
}

export function snapshotCanonicalIdentities(
  source: Partial<CanonicalIdentitySnapshot> & { workspaceId: string },
): CanonicalIdentitySnapshot {
  return {
    workspaceId: source.workspaceId,
    itemIds: [...(source.itemIds ?? [])].sort(),
    revisionIds: [...(source.revisionIds ?? [])].sort(),
    fileContentIds: [...(source.fileContentIds ?? [])].sort(),
  };
}

/**
 * Returns the differences between two snapshots. An empty array means every
 * feature-001 identity survived the security operation unchanged.
 */
export function diffCanonicalIdentities(
  before: CanonicalIdentitySnapshot,
  after: CanonicalIdentitySnapshot,
): string[] {
  const differences: string[] = [];
  if (before.workspaceId !== after.workspaceId) {
    differences.push(
      `workspaceId changed: ${before.workspaceId} -> ${after.workspaceId}; the canonical workspace must be bound, not recreated`,
    );
  }
  const collections = ["itemIds", "revisionIds", "fileContentIds"] as const;
  for (const collection of collections) {
    const previous = new Set(before[collection]);
    const current = new Set(after[collection]);
    for (const id of previous) {
      if (!current.has(id)) {
        differences.push(`${collection}: identity disappeared (${id})`);
      }
    }
    for (const id of current) {
      if (!previous.has(id)) {
        differences.push(`${collection}: identity appeared (${id})`);
      }
    }
  }
  return differences;
}

// ---------------------------------------------------------------------------
// 5. Software WebAuthn authenticator
// ---------------------------------------------------------------------------

export interface VirtualAuthenticatorOptions {
  readonly rpId: string;
  readonly origin: string;
  /** Whether the authenticator reports user verification. */
  readonly userVerified?: boolean;
  /** Starting signature counter; a replay must not reuse or lower it. */
  readonly signCount?: number;
}

export interface VirtualCredential {
  readonly credentialId: Uint8Array;
  readonly publicKeyDer: Uint8Array;
}

export interface VirtualAuthenticator {
  readonly rpId: string;
  readonly origin: string;
  /** Creates a credential for a registration ceremony. */
  create(userHandle: Uint8Array, challenge: Uint8Array): VirtualAttestation;
  /** Produces an assertion for an authentication ceremony. */
  assert(credentialId: Uint8Array, challenge: Uint8Array): VirtualAssertion;
  /** Replays the previous assertion verbatim, without advancing signCount. */
  replayLastAssertion(): VirtualAssertion;
  /** Forces the next assertion to report a lower counter (cloned key). */
  forceSignCountRegression(): void;
  currentSignCount(): number;
}

export interface VirtualAttestation {
  readonly credentialId: Uint8Array;
  readonly publicKeyDer: Uint8Array;
  readonly clientDataJson: string;
  readonly signCount: number;
  readonly userVerified: boolean;
}

export interface VirtualAssertion {
  readonly credentialId: Uint8Array;
  readonly clientDataJson: string;
  readonly signature: Uint8Array;
  readonly signCount: number;
  readonly userVerified: boolean;
}

/**
 * A deterministic authenticator for non-browser suites. It reproduces the
 * properties the verifier must check — origin, RP ID, challenge echo, user
 * verification, and a monotonic signature counter — without depending on a
 * real platform authenticator. Playwright journeys use the CDP virtual
 * authenticator instead (see `tests/e2e/helpers.ts`).
 */
export function createVirtualAuthenticator(
  options: VirtualAuthenticatorOptions,
): VirtualAuthenticator {
  const userVerified = options.userVerified ?? true;
  let signCount = options.signCount ?? 0;
  let regressNext = false;
  let lastAssertion: VirtualAssertion | undefined;
  const credentials = new Map<string, VirtualCredential>();

  function clientData(type: "webauthn.create" | "webauthn.get", challenge: Uint8Array): string {
    return JSON.stringify({
      type,
      challenge: Buffer.from(challenge).toString("base64url"),
      origin: options.origin,
      crossOrigin: false,
    });
  }

  return {
    rpId: options.rpId,
    origin: options.origin,
    create(userHandle, challenge) {
      const credentialId = new Uint8Array(randomBytes(32));
      const publicKeyDer = new Uint8Array(randomBytes(91));
      credentials.set(Buffer.from(credentialId).toString("base64url"), {
        credentialId,
        publicKeyDer,
      });
      signCount += 1;
      void userHandle;
      return {
        credentialId,
        publicKeyDer,
        clientDataJson: clientData("webauthn.create", challenge),
        signCount,
        userVerified,
      };
    },
    assert(credentialId, challenge) {
      const key = Buffer.from(credentialId).toString("base64url");
      if (!credentials.has(key)) {
        throw new Error("virtual authenticator: unknown credential");
      }
      signCount = regressNext ? Math.max(0, signCount - 1) : signCount + 1;
      regressNext = false;
      const assertion: VirtualAssertion = {
        credentialId,
        clientDataJson: clientData("webauthn.get", challenge),
        // Deterministic stand-in: the verifier under test checks structure,
        // origin, challenge, and counter, not this signature's cryptography.
        signature: new Uint8Array(randomBytes(64)),
        signCount,
        userVerified,
      };
      lastAssertion = assertion;
      return assertion;
    },
    replayLastAssertion() {
      if (lastAssertion === undefined) {
        throw new Error("virtual authenticator: no assertion to replay");
      }
      return lastAssertion;
    },
    forceSignCountRegression() {
      regressNext = true;
    },
    currentSignCount: () => signCount,
  };
}

// ---------------------------------------------------------------------------
// 6. Fault injection
// ---------------------------------------------------------------------------

/**
 * Named boundaries where a security suite may inject a failure. Each one is a
 * point where an interrupted operation must leave no partial owner, no usable
 * half-written kit, and no advanced cursor.
 */
export type FaultBoundary =
  | "bootstrap.credential-verification"
  | "bootstrap.kit-creation"
  | "bootstrap.download-consumption"
  | "bootstrap.confirmation"
  | "bootstrap.retry"
  | "deployment-key.load"
  | "session.issue"
  | "recovery.replacement"
  | "rotation.reencrypt"
  | "migration.checkpoint"
  | "audit.append";

export interface FaultPlan {
  readonly boundary: FaultBoundary;
  /** Fail on the Nth arrival at the boundary (1-based). Defaults to 1. */
  readonly onCall?: number;
  /** Fail this many times, then let calls through. Defaults to 1. */
  readonly times?: number;
  readonly error?: Error;
}

export interface FaultInjector {
  arm(plan: FaultPlan): void;
  /**
   * Call at the start of the guarded operation. Throws when a plan is due, so
   * the operation aborts exactly where the plan says.
   */
  check(boundary: FaultBoundary): void;
  /** Awaitable form for async boundaries. */
  checkAsync(boundary: FaultBoundary): Promise<void>;
  arrivals(boundary: FaultBoundary): number;
  /** Boundaries that were armed but never reached — a silent test gap. */
  unreachedBoundaries(): FaultBoundary[];
  reset(): void;
}

export class InjectedFaultError extends Error {
  constructor(readonly boundary: FaultBoundary) {
    super(`injected fault at ${boundary}`);
    this.name = "InjectedFaultError";
  }
}

export function createFaultInjector(): FaultInjector {
  const plans = new Map<FaultBoundary, { plan: FaultPlan; fired: number }>();
  const arrivals = new Map<FaultBoundary, number>();

  const injector: FaultInjector = {
    arm(plan) {
      plans.set(plan.boundary, { plan, fired: 0 });
    },
    check(boundary) {
      const seen = (arrivals.get(boundary) ?? 0) + 1;
      arrivals.set(boundary, seen);

      const armed = plans.get(boundary);
      if (armed === undefined) {
        return;
      }
      const onCall = armed.plan.onCall ?? 1;
      const times = armed.plan.times ?? 1;
      if (seen < onCall || armed.fired >= times) {
        return;
      }
      armed.fired += 1;
      throw armed.plan.error ?? new InjectedFaultError(boundary);
    },
    checkAsync: async (boundary) => {
      injector.check(boundary);
    },
    arrivals: (boundary) => arrivals.get(boundary) ?? 0,
    unreachedBoundaries: () =>
      [...plans.keys()].filter((boundary) => (arrivals.get(boundary) ?? 0) === 0),
    reset() {
      plans.clear();
      arrivals.clear();
    },
  };
  return injector;
}

// ---------------------------------------------------------------------------
// Composite harness
// ---------------------------------------------------------------------------

export interface SecurityHarness {
  readonly clock: ControlledClock;
  readonly installation: DisposableInstallation;
  readonly deploymentKey: MountedSecret;
  readonly faults: FaultInjector;
  readonly authenticator: VirtualAuthenticator;
  cleanup(): void;
}

export interface SecurityHarnessOptions {
  readonly clockOrigin?: Date;
  readonly deploymentKeyDefect?: MountedSecretDefect;
  readonly rpId?: string;
  readonly origin?: string;
}

/**
 * One call sets up a complete disposable security environment. Suites that
 * need only part of it can use the individual factories above.
 */
export function createSecurityHarness(options: SecurityHarnessOptions = {}): SecurityHarness {
  const installation = createDisposableInstallation();
  const origin = options.origin ?? "https://workspace.example";
  return {
    clock: createControlledClock(options.clockOrigin),
    installation,
    deploymentKey: createMountedDeploymentKey(installation, options.deploymentKeyDefect ?? "none"),
    faults: createFaultInjector(),
    authenticator: createVirtualAuthenticator({
      rpId: options.rpId ?? new URL(origin).hostname,
      origin,
    }),
    cleanup: () => {
      installation.cleanup();
    },
  };
}
