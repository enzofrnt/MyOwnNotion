/**
 * The password alternative (T043, feature 002).
 *
 * A password is an *alternative* to the passkey, never a second factor and
 * never a replacement. Setting one must leave passkey login working exactly as
 * before; that is the property the tests pin, because it is the one a
 * well-meaning refactor would break by treating "has a password" as a mode.
 *
 * **There is no reset flow, and that is deliberate.** A reset would need a
 * channel the installation does not have — no email, no phone, no support desk
 * — and inventing one would create a second way into the account that is
 * weaker than both existing ones. An owner who forgets their password signs in
 * with their passkey; an owner who has lost both uses the recovery kit. Those
 * are the two doors, and adding a third would be the widest hole in the
 * feature.
 *
 * Hashing is versioned. Each stored credential records the algorithm and its
 * parameters, so raising the cost later does not invalidate existing
 * passwords: a login that verifies against an old version can be rehashed at
 * the new one, and the old row is superseded rather than deleted.
 */

import {
  type BinaryLike,
  randomBytes,
  randomUUID,
  type ScryptOptions,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

/**
 * Promisified `scrypt`, typed by hand.
 *
 * `promisify` collapses the overloads and loses the options argument, which is
 * the argument that carries the cost parameters — the whole point of using
 * scrypt here. Wrapping it explicitly keeps the parameters type-checked.
 */
function scrypt(
  password: BinaryLike,
  salt: BinaryLike,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

/**
 * The current hashing version.
 *
 * `N = 2^17` is deliberately expensive: this is a single-owner installation,
 * so a login happens seldom and a few hundred milliseconds is invisible to the
 * owner while multiplying an offline attacker's cost. `maxmem` has to be
 * raised in step with `N`, or Node refuses the very parameters we asked for.
 */
export const CURRENT_PASSWORD_HASH = {
  algorithm: "scrypt" as const,
  parameters: { N: 131_072, r: 8, p: 1, keyLength: 64 },
};

export type PasswordHashParameters = typeof CURRENT_PASSWORD_HASH.parameters;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/**
 * The minimum this installation will accept.
 *
 * Length only, with no composition rules. Requiring a digit and a symbol
 * pushes people towards `Password1!` — shorter, more predictable, and easier
 * to guess than a long passphrase. Length is the property that actually costs
 * an attacker.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export function assertAcceptablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters; a passphrase of a few words is ideal`,
    );
  }
  // An upper bound because scrypt hashes whatever it is given, and an
  // unbounded input is an unbounded amount of work for one unauthenticated
  // request.
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

export interface PasswordHash {
  /** `scrypt$N$r$p$salt$hash`, all base64url. Self-describing on purpose. */
  readonly encoded: string;
  readonly algorithm: string;
  readonly parameters: PasswordHashParameters;
}

/**
 * Hashes a password at the current version.
 *
 * The encoded form carries its own parameters so verification never has to
 * guess, and so a credential hashed years ago still verifies after the current
 * parameters change.
 */
export async function hashPassword(password: string): Promise<PasswordHash> {
  assertAcceptablePassword(password);
  const { N, r, p, keyLength } = CURRENT_PASSWORD_HASH.parameters;
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, keyLength, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return {
    encoded: [
      "scrypt",
      String(N),
      String(r),
      String(p),
      salt.toString("base64url"),
      derived.toString("base64url"),
    ].join("$"),
    algorithm: CURRENT_PASSWORD_HASH.algorithm,
    parameters: CURRENT_PASSWORD_HASH.parameters,
  };
}

interface DecodedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function decode(encoded: string): DecodedHash | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return null;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  // Bounded so a tampered row cannot ask this process for an unbounded amount
  // of memory. A stored credential is not attacker-controlled today, but this
  // is the code path a compromised row would run through.
  if (N < 1024 || N > 1 << 22 || r < 1 || r > 64 || p < 1 || p > 16) {
    return null;
  }
  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(parts[4] ?? "", "base64url"),
      hash: Buffer.from(parts[5] ?? "", "base64url"),
    };
  } catch {
    return null;
  }
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` for a malformed stored hash rather than throwing: a corrupt
 * row must refuse the login, not produce a server error that distinguishes it
 * from a wrong password.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const decoded = decode(encoded);
  if (decoded === null || decoded.hash.length === 0) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = await scrypt(password, decoded.salt, decoded.hash.length, {
      N: decoded.N,
      r: decoded.r,
      p: decoded.p,
      maxmem: 256 * decoded.N * decoded.r,
    });
  } catch {
    return false;
  }
  if (derived.length !== decoded.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, decoded.hash);
}

/** Whether a stored hash was produced at an older version and should be redone. */
export function needsRehash(encoded: string): boolean {
  const decoded = decode(encoded);
  if (decoded === null) {
    return true;
  }
  const current = CURRENT_PASSWORD_HASH.parameters;
  return decoded.N !== current.N || decoded.r !== current.r || decoded.p !== current.p;
}

/**
 * Burns roughly the cost of a real verification.
 *
 * Called when no password is set, so "this owner has no password" takes about
 * as long to answer as "this password is wrong". Without it the endpoint
 * answers a question it is supposed to refuse to answer, in the one channel
 * that cannot be redacted: elapsed time.
 */
export async function equivalentWork(): Promise<void> {
  const { N, r, p, keyLength } = CURRENT_PASSWORD_HASH.parameters;
  await scrypt(randomBytes(32), randomBytes(16), keyLength, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
}

/** A new credential version row, ready to persist. */
export interface PasswordCredentialVersion {
  readonly id: string;
  readonly ownerId: string;
  readonly passwordHash: string;
  readonly hashAlgorithm: string;
  readonly hashParameters: PasswordHashParameters;
  readonly createdAt: Date;
}

export async function buildPasswordVersion(input: {
  ownerId: string;
  password: string;
  now: Date;
}): Promise<PasswordCredentialVersion> {
  const hashed = await hashPassword(input.password);
  return {
    id: randomUUID(),
    ownerId: input.ownerId,
    passwordHash: hashed.encoded,
    hashAlgorithm: hashed.algorithm,
    hashParameters: hashed.parameters,
    createdAt: input.now,
  };
}
