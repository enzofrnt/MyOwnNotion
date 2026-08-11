/**
 * CSRF protection for authenticated sessions (T045, feature 002).
 *
 * The session cookie is `SameSite=Strict`, which already stops the classic
 * cross-site form post. This is the second layer, and it exists because
 * `SameSite` is a browser behaviour: it protects users on browsers that
 * implement it as expected, and says nothing about a request that reaches the
 * server by another route.
 *
 * The scheme is a token bound to the session, not a random value in a second
 * cookie. A double-submit cookie would be satisfied by anyone who can set a
 * cookie on the origin — which, over the loopback HTTP exception, is anyone on
 * the machine. Deriving the token from the session secret means only a caller
 * who already has the session can compute it, so the token adds a requirement
 * rather than restating one.
 *
 * **Where the token may travel.** It is returned in the authenticated
 * response body, and sent back in the `X-CSRF-Token` header. Never a URL,
 * never a log line, never persistent plaintext — a URL lands in history,
 * server logs, and `Referer`, all of which outlive the session it protects.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { CSRF_TOKEN_HEADER } from "@myownnotion/contracts";
import type { FastifyRequest } from "fastify";
import type { CsrfValidator } from "./authentication-hook.ts";
import type { SecurityRequestContext } from "./request-context.ts";

/**
 * Derives the CSRF token for a session.
 *
 * Keyed by the deployment wrapping key rather than by the session secret
 * alone: without a server-held key, anyone who learned a session secret could
 * also mint its token, and the second factor would collapse back into the
 * first. The session id is the message, so a token is useless against any
 * other session.
 */
export function deriveCsrfToken(deploymentKey: Buffer, sessionId: string): string {
  return createHmac("sha256", deploymentKey)
    .update(`csrf|${sessionId}`)
    .digest("base64url")
    .slice(0, 43);
}

/**
 * Compares two tokens without leaking their difference through timing.
 *
 * Length is checked first and separately, because `timingSafeEqual` throws on
 * a length mismatch. Returning early on length is safe: the token length is
 * fixed and public.
 */
export function tokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface CsrfDeps {
  /** Returns the deployment wrapping key, or null when it is unavailable. */
  readonly deploymentKey: () => Buffer | null;
}

/**
 * The CSRF validator the authentication hook plugs in.
 *
 * Fails closed at every step that could go wrong: no owner principal, no
 * deployment key, no header, wrong header — all refuse. In particular an
 * unavailable deployment key refuses rather than skipping the check, because
 * a degraded installation is exactly when an attacker would prefer the check
 * to be skipped.
 */
export function createCsrfValidator(deps: CsrfDeps): CsrfValidator {
  return {
    validate(request: FastifyRequest, context: SecurityRequestContext): boolean {
      if (context.principal.kind !== "owner") {
        return false;
      }
      const key = deps.deploymentKey();
      if (key === null) {
        return false;
      }
      const header = request.headers[CSRF_TOKEN_HEADER];
      const presented = Array.isArray(header) ? header[0] : header;
      if (typeof presented !== "string" || presented.length === 0) {
        return false;
      }
      return tokensMatch(deriveCsrfToken(key, context.principal.sessionId), presented);
    },
  };
}
