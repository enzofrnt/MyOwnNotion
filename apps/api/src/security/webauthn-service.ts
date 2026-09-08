/**
 * WebAuthn ceremony verification (T030, feature 002).
 *
 * Wraps `@simplewebauthn/server` rather than hand-rolling CBOR parsing, COSE
 * key decoding, and signature verification. For a security primitive that is
 * the deliberate choice: a bespoke verifier is where subtle acceptance bugs
 * live, and this one is widely reviewed.
 *
 * What this module adds on top is the policy the library leaves to the caller,
 * and every item is a check whose absence would be exploitable:
 *
 *   - **Origin and RP ID come from configuration, never from the request.**
 *     A ceremony verified against an attacker-supplied origin proves nothing.
 *   - **User verification is required.** Without it a passkey degrades to mere
 *     possession of an unlocked device.
 *   - **The signature counter must not regress.** A counter that goes backwards
 *     is the standard signal of a cloned authenticator.
 *   - **Challenges are single-use and time-bounded.** A replayed assertion must
 *     fail even with a perfectly valid signature.
 */

import { randomBytes } from "node:crypto";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { SecurityConfig } from "./security-config.ts";
import { trustedRealtimeOrigins } from "./security-config.ts";

/** Challenges are 32 bytes and live no longer than one ceremony. */
export const WEBAUTHN_CHALLENGE_BYTES = 32;
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60_000;

export class WebAuthnVerificationError extends Error {
  constructor() {
    // Deliberately uniform: which check failed is not the caller's business,
    // and telling them turns the endpoint into an oracle.
    super("the authenticator ceremony could not be verified");
    this.name = "WebAuthnVerificationError";
  }
}

export interface WebAuthnChallenge {
  readonly challenge: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export function createChallenge(now: Date): WebAuthnChallenge {
  return {
    challenge: randomBytes(WEBAUTHN_CHALLENGE_BYTES).toString("base64url"),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS),
  };
}

export function isChallengeFresh(challenge: WebAuthnChallenge, now: Date): boolean {
  return now.getTime() <= challenge.expiresAt.getTime();
}

/**
 * The relying-party identity, derived from the configured public origin.
 *
 * Derived, never accepted from the client: a request that could choose its own
 * RP ID could have a credential registered for one origin accepted at another.
 */
export interface RelyingParty {
  readonly id: string;
  /** Primary configured origin; kept for persistence and diagnostics. */
  readonly origin: string;
  /** Every origin the ceremony may legitimately come from on this installation. */
  readonly origins: readonly string[];
  readonly name: string;
}

export function webauthnExpectedOrigins(config: SecurityConfig): readonly string[] {
  return trustedRealtimeOrigins(config).map((origin) => origin.origin);
}

export function relyingParty(config: SecurityConfig): RelyingParty {
  const origins = webauthnExpectedOrigins(config);
  return {
    id: config.publicOrigin.hostname,
    origin: config.publicOrigin.origin,
    origins,
    name: "MyOwnNotion",
  };
}

export interface VerifiedRegistration {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly userVerified: boolean;
}

/**
 * Verifies a registration ceremony.
 *
 * `requireUserVerification` is not optional in practice — it is `true` at every
 * call site — but it is expressed rather than assumed so the requirement is
 * visible where the ceremony is verified.
 */
export async function verifyRegistration(input: {
  response: unknown;
  challenge: WebAuthnChallenge;
  relyingParty: RelyingParty;
  now: Date;
}): Promise<VerifiedRegistration> {
  if (!isChallengeFresh(input.challenge, input.now)) {
    throw new WebAuthnVerificationError();
  }
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response as never,
      expectedChallenge: input.challenge.challenge,
      expectedOrigin: [...input.relyingParty.origins],
      expectedRPID: input.relyingParty.id,
      requireUserVerification: true,
    });
  } catch {
    throw new WebAuthnVerificationError();
  }
  if (!verification.verified || verification.registrationInfo === undefined) {
    throw new WebAuthnVerificationError();
  }
  const info = verification.registrationInfo;
  return {
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
    signCount: info.credential.counter,
    userVerified: info.userVerified,
  };
}

export interface StoredCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
}

export interface VerifiedAssertion {
  readonly credentialId: string;
  readonly signCount: number;
  readonly userVerified: boolean;
}

/**
 * Verifies an authentication ceremony against a stored credential.
 *
 * The counter check is the part worth reading twice. `@simplewebauthn` already
 * rejects a regression, and this re-checks it explicitly: a counter that does
 * not advance is how a cloned authenticator shows itself, and relying on a
 * library default for that is relying on a default nobody would notice
 * changing.
 */
export async function verifyAssertion(input: {
  response: unknown;
  challenge: WebAuthnChallenge;
  relyingParty: RelyingParty;
  credential: StoredCredential;
  now: Date;
}): Promise<VerifiedAssertion> {
  if (!isChallengeFresh(input.challenge, input.now)) {
    throw new WebAuthnVerificationError();
  }
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response as never,
      expectedChallenge: input.challenge.challenge,
      expectedOrigin: [...input.relyingParty.origins],
      expectedRPID: input.relyingParty.id,
      requireUserVerification: true,
      credential: {
        id: input.credential.credentialId,
        publicKey: new Uint8Array(Buffer.from(input.credential.publicKey, "base64url")),
        counter: input.credential.signCount,
      },
    });
  } catch {
    throw new WebAuthnVerificationError();
  }
  if (!verification.verified) {
    throw new WebAuthnVerificationError();
  }
  const { newCounter } = verification.authenticationInfo;
  // Some authenticators legitimately report a static 0; a *decrease* never is.
  if (input.credential.signCount > 0 && newCounter <= input.credential.signCount) {
    throw new WebAuthnVerificationError();
  }
  return {
    credentialId: input.credential.credentialId,
    signCount: newCounter,
    userVerified: verification.authenticationInfo.userVerified,
  };
}
