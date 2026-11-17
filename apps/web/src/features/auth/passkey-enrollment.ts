/**
 * Adds a passkey to the signed-in account (feature 058).
 *
 * The credential is discoverable and its user handle is the account id, so a
 * later passkey sign-in finds this account without typing an email, and the
 * authenticator shows the email and pseudonym to tell accounts apart.
 */
import type { SecurityApi } from "../../services/security-api.ts";
import { createOwnerPasskey, type PasskeyFailure } from "./passkey-client.ts";

export type EnrollmentOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PasskeyFailure | "refused" | "reauthenticate" };

export async function enrollAccountPasskey(
  api: SecurityApi,
  input: { readonly label: string },
): Promise<EnrollmentOutcome> {
  const me = await api.me();
  if (!me.ok) return { ok: false, reason: "refused" };
  const options = await api.passkeyEnrollmentOptions();
  if (!options.ok)
    return {
      ok: false,
      // A stale session is recoverable in place: the caller asks for the password.
      reason:
        options.problem.code === "recent_authentication_required" ? "reauthenticate" : "refused",
    };
  const ceremony = await createOwnerPasskey({
    challenge: options.value.challenge,
    relyingPartyId: window.location.hostname,
    relyingPartyName: "MyOwnNotion",
    userId: me.value.accountId,
    userName: me.value.email,
    displayName: me.value.pseudonym,
  });
  if (!ceremony.ok) return { ok: false, reason: ceremony.failure };
  const completed = await api.completePasskeyEnrollment(
    ceremony.credential as Record<string, unknown>,
    input.label,
  );
  if (completed.ok) return { ok: true };
  return {
    ok: false,
    reason:
      completed.problem.code === "recent_authentication_required" ? "reauthenticate" : "refused",
  };
}
