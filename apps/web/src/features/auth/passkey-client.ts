/**
 * The browser half of the passkey ceremony (T033, feature 002).
 *
 * Thin on purpose. Everything that decides whether a ceremony is acceptable —
 * origin, relying-party id, user verification, sign counts — is checked on the
 * server, from server configuration. This module only shuttles bytes, because
 * anything it decided could be decided differently by a caller the server
 * never sees.
 */

/** Why a ceremony did not produce a credential. Each maps to owner guidance. */
export type PasskeyFailure =
  | "unsupported"
  | "cancelled"
  | "already-registered"
  | "insecure-context"
  | "failed";

export type PasskeyResult =
  | { readonly ok: true; readonly credential: unknown }
  | { readonly ok: false; readonly failure: PasskeyFailure };

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * True when this browser can run the ceremony at all.
 *
 * WebAuthn is only exposed in a secure context, which over plain HTTP means
 * loopback. The first-run page uses this to explain the problem rather than
 * offering a button that cannot work.
 */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function"
  );
}

/**
 * Runs the registration ceremony for the first owner.
 *
 * `residentKey: "required"` so the credential is discoverable: the owner can
 * sign in later without first telling the installation who they are, which
 * matters because a single-owner installation has no username to type.
 * `userVerification: "required"` so possession of the device is not enough on
 * its own.
 */
export async function createOwnerPasskey(input: {
  readonly challenge: string;
  readonly relyingPartyId: string;
  readonly relyingPartyName: string;
  readonly userId: string;
  readonly userName: string;
}): Promise<PasskeyResult> {
  if (typeof window === "undefined" || typeof window.PublicKeyCredential !== "function") {
    return { ok: false, failure: "unsupported" };
  }
  if (!window.isSecureContext) {
    return { ok: false, failure: "insecure-context" };
  }

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(input.challenge) as BufferSource,
        rp: { id: input.relyingPartyId, name: input.relyingPartyName },
        user: {
          id: new TextEncoder().encode(input.userId) as BufferSource,
          name: input.userName,
          displayName: input.userName,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        timeout: 120_000,
        attestation: "none",
      },
    });
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }

  if (credential === null) {
    return { ok: false, failure: "cancelled" };
  }

  const attestation = credential as PublicKeyCredential;
  const response = attestation.response as AuthenticatorAttestationResponse;
  return {
    ok: true,
    credential: {
      id: attestation.id,
      rawId: toBase64Url(attestation.rawId),
      type: attestation.type,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
      },
      clientExtensionResults: attestation.getClientExtensionResults(),
    },
  };
}

/** Runs the discoverable-credential assertion used by owner sign-in. */
export async function requestOwnerPasskey(input: {
  readonly challenge: string;
}): Promise<PasskeyResult> {
  if (
    typeof window === "undefined" ||
    typeof window.PublicKeyCredential !== "function" ||
    navigator.credentials?.get === undefined
  ) {
    return { ok: false, failure: "unsupported" };
  }
  if (!window.isSecureContext) {
    return { ok: false, failure: "insecure-context" };
  }

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(input.challenge) as BufferSource,
        timeout: 120_000,
        userVerification: "required",
      },
    });
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
  if (credential === null) {
    return { ok: false, failure: "cancelled" };
  }

  const assertion = credential as PublicKeyCredential;
  const response = assertion.response as AuthenticatorAssertionResponse;
  return {
    ok: true,
    credential: {
      id: assertion.id,
      rawId: toBase64Url(assertion.rawId),
      type: assertion.type,
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
        ...(response.userHandle === null ? {} : { userHandle: toBase64Url(response.userHandle) }),
      },
      clientExtensionResults: assertion.getClientExtensionResults(),
    },
  };
}

/**
 * Maps a `DOMException` to owner-facing guidance.
 *
 * `NotAllowedError` covers both an explicit cancel and a timeout, and the
 * browser deliberately does not distinguish them. Reporting it as "cancelled"
 * is honest about what we know: the ceremony did not complete, and retrying
 * is the right next step either way.
 */
function classify(error: unknown): PasskeyFailure {
  if (!(error instanceof DOMException)) {
    return "failed";
  }
  if (error.name === "NotAllowedError") {
    return "cancelled";
  }
  if (error.name === "InvalidStateError") {
    return "already-registered";
  }
  if (error.name === "SecurityError") {
    return "insecure-context";
  }
  return "failed";
}
