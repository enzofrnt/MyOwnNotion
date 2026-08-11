/**
 * Platform-independent security vocabulary (T018, feature 002).
 *
 * Dependency direction: `@myownnotion/contracts` depends on this package, not
 * the other way round. The structural types live here so the domain stays free
 * of TypeBox and of any transport concern; `packages/contracts/src/security-
 * artifacts.ts` holds the runtime validators and statically asserts that its
 * schemas produce exactly these shapes, so the two cannot drift.
 */

// ---------------------------------------------------------------------------
// Installation lifecycle
// ---------------------------------------------------------------------------

/**
 * Every state an installation can report.
 *
 * The split below is the load-bearing part: an installation is either
 * *uninitialized* — no owner, no workspace, nothing committed — or
 * *initialized*, in which case exactly one owner and one workspace exist. There
 * is no state in between, because ownership and workspace binding are committed
 * by a single atomic promotion.
 */
export const UNINITIALIZED_INSTALLATION_STATES = [
  "uninitialized",
  "bootstrap-in-progress",
] as const;

export const INITIALIZED_INSTALLATION_STATES = [
  /** Owner exists, but recovery material must be replaced before normal use. */
  "recovery-required",
  "ready",
  "migration-in-progress",
  /** Key unavailable or invalid: protected reads and writes fail closed. */
  "degraded",
] as const;

export const INSTALLATION_STATES = [
  ...UNINITIALIZED_INSTALLATION_STATES,
  ...INITIALIZED_INSTALLATION_STATES,
] as const;

export type UninitializedInstallationState = (typeof UNINITIALIZED_INSTALLATION_STATES)[number];
export type InitializedInstallationState = (typeof INITIALIZED_INSTALLATION_STATES)[number];
export type InstallationState = (typeof INSTALLATION_STATES)[number];

/** Committed row counts. Only `0/0` and `1/1` are reachable. */
export interface InstallationCounts {
  readonly ownerCount: 0 | 1;
  readonly workspaceCount: 0 | 1;
}

export const UNINITIALIZED_COUNTS: InstallationCounts = { ownerCount: 0, workspaceCount: 0 };
export const INITIALIZED_COUNTS: InstallationCounts = { ownerCount: 1, workspaceCount: 1 };

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Bootstrap attempt states. Everything before `confirmed` is attempt-scoped:
 * the records exist, but no owner or workspace row is committed, so the
 * installation still reports `0/0`.
 */
export const BOOTSTRAP_STATES = [
  "started",
  "credential-verified",
  "recovery-prepared",
  "download-consumed",
  "confirmed",
  "abandoned",
  "rejected",
] as const;
export type BootstrapState = (typeof BOOTSTRAP_STATES)[number];

/** The one-time provisional recovery download window. */
export const BOOTSTRAP_KIT_WINDOW_MINUTES = 15;

/**
 * How long a claimed attempt may sit before a new claim may supersede it.
 *
 * Without this an attempt claimed and then abandoned — a closed tab, a crashed
 * browser — holds the single open-attempt slot forever, and the installation
 * can never be set up again without direct database access. The window matches
 * the kit window because both bound the same thing: how long one person may
 * hold the installation's only bootstrap slot while doing nothing with it.
 */
export const BOOTSTRAP_CLAIM_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------------------
// Encrypted envelope
// ---------------------------------------------------------------------------

export const ENVELOPE_FORMAT = "mn.enc.v1" as const;
export const ENVELOPE_ALGORITHM = "AES-256-GCM+HKDF-SHA-256" as const;

/**
 * Durable form of one protected record. Public metadata only: enough to locate
 * the key generation and rebuild the AAD, and nothing that reveals content.
 * All byte fields are unpadded base64url.
 */
export interface EncryptedEnvelope {
  readonly format: typeof ENVELOPE_FORMAT;
  readonly entityType: string;
  readonly entityId: string;
  readonly workspaceId: string;
  readonly keyGeneration: number;
  readonly recordVersion: number;
  readonly algorithm: typeof ENVELOPE_ALGORITHM;
  readonly salt: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
  readonly aadDigest: string;
  /** Present only for file chunks. */
  readonly chunkIndex?: number;
}

// ---------------------------------------------------------------------------
// Recovery material
// ---------------------------------------------------------------------------

/** What a recovery kit is permitted to do. */
export const RECOVERY_AUTHORIZATION_STATES = [
  "provisional",
  "active",
  "superseded",
  "revoked",
  "rejected",
] as const;
export type RecoveryAuthorizationState = (typeof RECOVERY_AUTHORIZATION_STATES)[number];

/** How far the kit's one-time delivery got. */
export const RECOVERY_DELIVERY_STATES = [
  "prepared",
  "downloadable",
  "download-consumed",
  "confirmed",
  "expired",
] as const;
export type RecoveryDeliveryState = (typeof RECOVERY_DELIVERY_STATES)[number];

export interface RecoveryStatePair {
  readonly authorizationState: RecoveryAuthorizationState;
  readonly deliveryState: RecoveryDeliveryState;
}

/**
 * The only seven legal combinations. Two axes, never one mixed `state` field:
 * authorization and delivery move independently, and a kit that skipped
 * offline confirmation must remain unusable no matter how it was delivered.
 */
export const RECOVERY_STATE_PAIRS = [
  { authorizationState: "provisional", deliveryState: "prepared" },
  { authorizationState: "provisional", deliveryState: "downloadable" },
  { authorizationState: "provisional", deliveryState: "download-consumed" },
  { authorizationState: "active", deliveryState: "confirmed" },
  { authorizationState: "superseded", deliveryState: "confirmed" },
  { authorizationState: "revoked", deliveryState: "confirmed" },
  { authorizationState: "rejected", deliveryState: "expired" },
] as const satisfies readonly RecoveryStatePair[];

export function isLegalRecoveryStatePair(
  authorizationState: string,
  deliveryState: string,
): boolean {
  return RECOVERY_STATE_PAIRS.some(
    (pair) =>
      pair.authorizationState === authorizationState && pair.deliveryState === deliveryState,
  );
}

/** A kit may unwrap data only once both axes reach an authorized pair. */
export function isRecoveryKitUsable(pair: RecoveryStatePair): boolean {
  return pair.authorizationState === "active" && pair.deliveryState === "confirmed";
}

// ---------------------------------------------------------------------------
// Key hierarchy
// ---------------------------------------------------------------------------

/**
 * Two independent policies, deliberately not merged:
 *
 * - `wrapping-key` tracks the external deployment wrapping-key version. A
 *   rotation unwraps and rewraps workspace root keys only; it never rewrites a
 *   record or a chunk.
 * - `data-key` tracks the workspace data-key generation. A rotation creates a
 *   new generation and progressively rewrites envelopes and chunks behind
 *   resumable cursors.
 */
export const KEY_KINDS = ["wrapping-key", "data-key"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];

/**
 * The complete policy-state vocabulary. `pre-due` through `emergency` are
 * advisory and leave reads and writes working; `write-block` is the only
 * enforced state, and it refuses *new protected writes* while leaving reads of
 * valid existing ciphertext available. Locking an owner out of their own data
 * because a rotation is late would be a worse outcome than the late rotation.
 */
export const KEY_POLICY_STATES = [
  "pre-due",
  "due",
  "overdue-within-grace",
  "emergency",
  "write-block",
  "in-progress",
  "complete",
  "failed",
] as const;
export type KeyPolicyState = (typeof KEY_POLICY_STATES)[number];

/** Scheduled rotations get a grace period; emergency rotations get none. */
export const ROTATION_MODES = ["scheduled", "emergency"] as const;
export type RotationMode = (typeof ROTATION_MODES)[number];

/** Calendar days between `dueAt` and `writeBlockAt` for a scheduled rotation. */
export const SCHEDULED_ROTATION_GRACE_DAYS = 7;

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Staged plaintext-to-encrypted migration. The order is normative: plaintext
 * writes stop before the read cutover, and scrubbing follows a verified
 * cutover, so no fault can destroy plaintext that is still the only copy.
 */
export const MIGRATION_STATES = [
  "prepare-destinations",
  "capture-boundary",
  "backfill",
  "verify",
  "stop-plaintext-writes",
  "encrypted-read-cutover",
  "scrub-plaintext",
  "complete",
  "failed",
] as const;
export type MigrationState = (typeof MIGRATION_STATES)[number];
