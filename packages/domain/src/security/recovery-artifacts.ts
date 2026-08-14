/**
 * Recovery-kit shaping and state rules (T015, feature 002).
 *
 * A recovery kit is the owner's only offline path back into their data. Its
 * payload is wrapped with a scrypt-stretched passphrase key, so possession of
 * the file alone is not enough, and its lifecycle is tracked on two
 * independent axes rather than one mixed state.
 *
 * Why two axes: `deliveryState` records how far the one-time download got, and
 * `authorizationState` records what the kit may do. Collapsing them would make
 * "downloaded but never confirmed offline" indistinguishable from "confirmed
 * and usable", which is precisely the confusion that would let an owner think
 * they are protected when they are not. Readiness therefore requires
 * `active/confirmed`, and no other pair unlocks anything.
 */
import {
  CRYPTO_SIZES,
  CryptoInputError,
  DEFAULT_SCRYPT_PARAMETERS,
  deriveRecordKey,
  deriveRecoveryKey,
  EnvelopeDecryptionError,
  fromBase64Url,
  open,
  randomNonce,
  randomSalt,
  type ScryptParameters,
  seal,
  toBase64Url,
} from "./crypto.ts";
import {
  isLegalRecoveryStatePair,
  isRecoveryKitUsable,
  type RecoveryAuthorizationState,
  type RecoveryDeliveryState,
  type RecoveryStatePair,
} from "./types.ts";

export const RECOVERY_FORMAT = "myownnotion.recovery+json" as const;
export const RECOVERY_FORMAT_VERSION = 1 as const;

/**
 * How a kit's ciphertext is unlocked. Two shapes, and the artifact says which.
 *
 * The descriptor is part of the downloaded file on purpose. Whoever holds a kit
 * — an operator, a recovery tool, a person opening it in a text editor five
 * years from now — must be able to tell what it needs *without* running code
 * that guesses. A file that looked passphrase-protected and was not would send
 * someone hunting for a phrase that never existed.
 */
export type RecoveryKdfDescriptor = RecoveryScryptDescriptor | RecoveryDeploymentKeyDescriptor;

export interface RecoveryScryptDescriptor {
  readonly algorithm: "scrypt";
  readonly N: ScryptParameters["N"];
  readonly r: 8;
  readonly p: number;
  readonly keyLength: 32;
  readonly salt: string;
}

/**
 * The kit is sealed under the installation's mounted deployment key.
 *
 * There is no passphrase, and the consequence is worth stating in the type
 * rather than leaving in a document: **this kit is useless on its own**. It can
 * only be opened on a host that mounts the same deployment key file, so
 * recovery means keeping the key *and* the kit, in separate places.
 *
 * That is a deliberate trade. It removes the phrase an owner would otherwise
 * have to transcribe and never lose, and it removes the offline attack against
 * a stolen kit — there is no weak secret to guess. What it does not do is
 * protect against losing the machine *and* its key together, and no property of
 * this format can change that.
 *
 * The salt is still present and still random: two kits made under the same
 * deployment key must not produce the same ciphertext, or an observer could
 * tell that a kit was regenerated without change.
 */
export interface RecoveryDeploymentKeyDescriptor {
  readonly algorithm: "deployment-key";
  readonly keyLength: 32;
  readonly salt: string;
}

export interface RecoveryEncryptionBlock {
  readonly algorithm: "AES-256-GCM";
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/**
 * The durable kit. Everything outside `encryption` is safe metadata: it can be
 * listed to the owner, persisted, and audited without exposing key material.
 */
export interface RecoveryKit {
  readonly format: typeof RECOVERY_FORMAT;
  readonly formatVersion: typeof RECOVERY_FORMAT_VERSION;
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly kitId: string;
  readonly recoveryEpoch: number;
  readonly authorizationState: RecoveryAuthorizationState;
  readonly deliveryState: RecoveryDeliveryState;
  readonly createdAt: string;
  readonly downloadExpiresAt?: string;
  readonly downloadConsumedAt?: string;
  readonly confirmedAt?: string;
  readonly supportedKeyGenerations: readonly number[];
  readonly kdf: RecoveryKdfDescriptor;
  readonly encryption: RecoveryEncryptionBlock;
}

/** AAD binding a kit's ciphertext to its own identity and epoch. */
export function recoveryAad(kit: {
  installationId: string;
  sourceLineageId: string;
  kitId: string;
  recoveryEpoch: number;
}): Uint8Array {
  const canonical = [
    RECOVERY_FORMAT,
    String(RECOVERY_FORMAT_VERSION),
    kit.installationId,
    kit.sourceLineageId,
    kit.kitId,
    String(kit.recoveryEpoch),
  ].join("|");
  return new Uint8Array(Buffer.from(canonical, "utf8"));
}

export interface CreateRecoveryKitInput {
  readonly installationId: string;
  readonly sourceLineageId: string;
  readonly kitId: string;
  readonly recoveryEpoch: number;
  /**
   * The secret that seals the kit. Exactly one of the two.
   *
   * A union rather than two optional fields, so "neither" and "both" are not
   * expressible: a caller that passed neither would otherwise seal a kit under
   * an empty phrase, which is the worst possible outcome and looks like
   * success.
   */
  readonly secret:
    | { readonly kind: "passphrase"; readonly passphrase: string }
    | { readonly kind: "deployment-key"; readonly deploymentKey: Uint8Array };
  /** Key material to protect; the caller zeroes its own copy afterwards. */
  readonly payload: Uint8Array;
  readonly supportedKeyGenerations: readonly number[];
  readonly createdAt: Date;
  /** End of the one-time download window. */
  readonly downloadExpiresAt: Date;
  readonly scrypt?: ScryptParameters;
}

/**
 * Creates a kit in its only legal initial pair, `provisional/prepared`.
 *
 * A newly created kit is never usable: it has to be downloaded once and then
 * confirmed offline by the owner before it reaches `active/confirmed`.
 */
export function createRecoveryKit(input: CreateRecoveryKitInput): RecoveryKit {
  if (input.payload.length === 0) {
    throw new CryptoInputError("recovery payload must not be empty");
  }
  if (input.supportedKeyGenerations.length === 0) {
    throw new CryptoInputError("a recovery kit must support at least one key generation");
  }
  if (input.recoveryEpoch < 1) {
    throw new CryptoInputError("recoveryEpoch must be a positive integer");
  }

  const parameters = input.scrypt ?? DEFAULT_SCRYPT_PARAMETERS;
  const salt = randomSalt();
  const kdf: RecoveryKdfDescriptor =
    input.secret.kind === "passphrase"
      ? {
          algorithm: "scrypt",
          N: parameters.N,
          r: parameters.r,
          p: parameters.p,
          keyLength: parameters.keyLength,
          salt: toBase64Url(salt),
        }
      : { algorithm: "deployment-key", keyLength: 32, salt: toBase64Url(salt) };
  const wrappingKey = recoveryWrappingKey(input.secret, salt, parameters);
  const aad = recoveryAad(input);
  const sealed = seal(wrappingKey, input.payload, aad, randomNonce());

  return {
    format: RECOVERY_FORMAT,
    formatVersion: RECOVERY_FORMAT_VERSION,
    installationId: input.installationId,
    sourceLineageId: input.sourceLineageId,
    kitId: input.kitId,
    recoveryEpoch: input.recoveryEpoch,
    authorizationState: "provisional",
    deliveryState: "prepared",
    createdAt: input.createdAt.toISOString(),
    downloadExpiresAt: input.downloadExpiresAt.toISOString(),
    supportedKeyGenerations: [...input.supportedKeyGenerations].sort((a, b) => a - b),
    kdf,
    encryption: {
      algorithm: "AES-256-GCM",
      nonce: toBase64Url(sealed.nonce),
      ciphertext: toBase64Url(sealed.ciphertext),
      tag: toBase64Url(sealed.tag),
    },
  };
}

/**
 * Unwraps a kit's payload.
 *
 * `requireUsable` defaults to true: an unconfirmed or revoked kit must not
 * hand back key material just because the passphrase happens to be right.
 * Recovery tooling that deliberately inspects a superseded kit passes false.
 */
export function openRecoveryKit(
  kit: RecoveryKit,
  secret: CreateRecoveryKitInput["secret"],
  options: { requireUsable?: boolean } = {},
): Uint8Array {
  const requireUsable = options.requireUsable ?? true;
  if (!isLegalRecoveryStatePair(kit.authorizationState, kit.deliveryState)) {
    throw new EnvelopeDecryptionError();
  }
  if (requireUsable && !isRecoveryKitUsable(kit)) {
    throw new EnvelopeDecryptionError();
  }

  let salt: Uint8Array;
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  let tag: Uint8Array;
  try {
    salt = fromBase64Url(kit.kdf.salt);
    nonce = fromBase64Url(kit.encryption.nonce);
    ciphertext = fromBase64Url(kit.encryption.ciphertext);
    tag = fromBase64Url(kit.encryption.tag);
  } catch {
    throw new EnvelopeDecryptionError();
  }
  if (
    salt.length !== CRYPTO_SIZES.salt ||
    nonce.length !== CRYPTO_SIZES.nonce ||
    tag.length !== CRYPTO_SIZES.tag
  ) {
    throw new EnvelopeDecryptionError();
  }

  if (kit.kdf.algorithm === "scrypt" && secret.kind !== "passphrase") {
    // Refused rather than coerced. A deployment key offered to a
    // passphrase-sealed kit is a caller that has confused two kinds of secret,
    // and stretching the bytes as if they were a phrase would produce a
    // plausible-looking failure much further along.
    throw new EnvelopeDecryptionError();
  }
  if (kit.kdf.algorithm === "deployment-key" && secret.kind !== "deployment-key") {
    throw new EnvelopeDecryptionError();
  }

  const wrappingKey =
    kit.kdf.algorithm === "scrypt"
      ? recoveryWrappingKey(secret, salt, {
          N: kit.kdf.N,
          r: kit.kdf.r,
          p: kit.kdf.p,
          keyLength: kit.kdf.keyLength,
        })
      : recoveryWrappingKey(secret, salt, DEFAULT_SCRYPT_PARAMETERS);
  return open(wrappingKey, { nonce, ciphertext, tag }, recoveryAad(kit));
}

/**
 * The key that actually seals or opens the kit.
 *
 * A passphrase is stretched, because it is a human secret with little entropy.
 * A deployment key is **not**: it is already 32 uniformly random bytes, and
 * scrypt over it would burn a second of CPU to produce something no harder to
 * guess. It is mixed with the kit's salt through HKDF instead, so two kits made
 * under one deployment key stay unrelated.
 */
function recoveryWrappingKey(
  secret: CreateRecoveryKitInput["secret"],
  salt: Uint8Array,
  parameters: ScryptParameters,
): Uint8Array {
  if (secret.kind === "passphrase") {
    return deriveRecoveryKey(secret.passphrase, salt, parameters);
  }
  return deriveRecordKey(secret.deploymentKey, salt, "myownnotion/recovery-kit");
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Every transition a kit may make, as `from` → allowed `to` pairs.
 *
 * The shape encodes three rules that would otherwise be scattered across
 * services:
 *
 *   - the download is one-time: `download-consumed` never returns to
 *     `downloadable`, so a second download attempt has nowhere legal to go;
 *   - offline confirmation is mandatory: the only route to `active/confirmed`
 *     starts at `provisional/download-consumed`;
 *   - a rejected or expired kit is terminal. Regeneration produces a *new*
 *     kit; the old one is never resurrected.
 */
const TRANSITIONS: ReadonlyArray<{ from: RecoveryStatePair; to: readonly RecoveryStatePair[] }> = [
  {
    from: { authorizationState: "provisional", deliveryState: "prepared" },
    to: [
      { authorizationState: "provisional", deliveryState: "downloadable" },
      { authorizationState: "rejected", deliveryState: "expired" },
    ],
  },
  {
    from: { authorizationState: "provisional", deliveryState: "downloadable" },
    to: [
      { authorizationState: "provisional", deliveryState: "download-consumed" },
      { authorizationState: "rejected", deliveryState: "expired" },
    ],
  },
  {
    from: { authorizationState: "provisional", deliveryState: "download-consumed" },
    to: [
      { authorizationState: "active", deliveryState: "confirmed" },
      { authorizationState: "rejected", deliveryState: "expired" },
    ],
  },
  {
    from: { authorizationState: "active", deliveryState: "confirmed" },
    to: [
      { authorizationState: "superseded", deliveryState: "confirmed" },
      { authorizationState: "revoked", deliveryState: "confirmed" },
    ],
  },
  // Terminal states.
  { from: { authorizationState: "superseded", deliveryState: "confirmed" }, to: [] },
  { from: { authorizationState: "revoked", deliveryState: "confirmed" }, to: [] },
  { from: { authorizationState: "rejected", deliveryState: "expired" }, to: [] },
];

function samePair(left: RecoveryStatePair, right: RecoveryStatePair): boolean {
  return (
    left.authorizationState === right.authorizationState &&
    left.deliveryState === right.deliveryState
  );
}

export function allowedRecoveryTransitions(from: RecoveryStatePair): readonly RecoveryStatePair[] {
  return TRANSITIONS.find((entry) => samePair(entry.from, from))?.to ?? [];
}

export function canTransitionRecovery(from: RecoveryStatePair, to: RecoveryStatePair): boolean {
  return allowedRecoveryTransitions(from).some((candidate) => samePair(candidate, to));
}

export class RecoveryTransitionError extends Error {
  constructor(from: RecoveryStatePair, to: RecoveryStatePair) {
    super(
      `illegal recovery transition ${from.authorizationState}/${from.deliveryState} -> ` +
        `${to.authorizationState}/${to.deliveryState}`,
    );
    this.name = "RecoveryTransitionError";
  }
}

export interface RecoveryTransitionContext {
  readonly now: Date;
}

/**
 * Applies a transition, maintaining the timestamps the contract requires for
 * the destination pair. Rejects anything the table does not allow, and rejects
 * a consumption or confirmation attempted after the download window closed.
 */
export function transitionRecoveryKit(
  kit: RecoveryKit,
  to: RecoveryStatePair,
  context: RecoveryTransitionContext,
): RecoveryKit {
  const from: RecoveryStatePair = {
    authorizationState: kit.authorizationState,
    deliveryState: kit.deliveryState,
  };
  if (!canTransitionRecovery(from, to)) {
    throw new RecoveryTransitionError(from, to);
  }

  const expired =
    kit.downloadExpiresAt !== undefined &&
    context.now.getTime() > new Date(kit.downloadExpiresAt).getTime();
  // The window guards *delivery of a provisional kit* only. A late download or
  // a late offline confirmation must not succeed. Once a kit is `active`, the
  // window is spent and irrelevant: superseding and — above all — revoking an
  // already-confirmed kit must never be blocked by a clock.
  if (expired && from.authorizationState === "provisional") {
    throw new RecoveryTransitionError(from, to);
  }

  const timestamp = context.now.toISOString();
  const next: RecoveryKit = {
    ...kit,
    authorizationState: to.authorizationState,
    deliveryState: to.deliveryState,
  };
  if (to.deliveryState === "download-consumed") {
    return { ...next, downloadConsumedAt: timestamp };
  }
  if (to.deliveryState === "confirmed" && next.confirmedAt === undefined) {
    return { ...next, confirmedAt: timestamp };
  }
  return next;
}

/**
 * Expires a kit whose download window has closed. Returns the kit unchanged
 * when it is already terminal or already confirmed — confirmation survives the
 * download window, only delivery does not.
 */
export function expireRecoveryKitIfDue(kit: RecoveryKit, now: Date): RecoveryKit {
  if (kit.downloadExpiresAt === undefined) {
    return kit;
  }
  if (now.getTime() <= new Date(kit.downloadExpiresAt).getTime()) {
    return kit;
  }
  const from: RecoveryStatePair = {
    authorizationState: kit.authorizationState,
    deliveryState: kit.deliveryState,
  };
  const expired: RecoveryStatePair = {
    authorizationState: "rejected",
    deliveryState: "expired",
  };
  return canTransitionRecovery(from, expired)
    ? { ...kit, authorizationState: "rejected", deliveryState: "expired" }
    : kit;
}
