/**
 * Authentication hook interfaces (T021, feature 002).
 *
 * These are the seams the session, CSRF, and bootstrap services plug into.
 * Defining them before the services exist is deliberate: it fixes the shape of
 * the decision — *what* is checked and in what order — separately from *how*
 * each check is implemented, so a later service cannot quietly widen what
 * counts as authenticated.
 *
 * Two rules the interfaces enforce by construction:
 *
 *   1. **A resolver may only narrow.** Every resolver returns a principal or
 *      `null`; none can upgrade a principal another resolver already produced.
 *      Authentication is therefore a single decision, not an accumulation.
 *   2. **A failure is a safe code, never a reason.** A resolver reports
 *      `authentication_failed`, not "unknown credential" or "wrong password".
 *      The distinction is what turns an endpoint into an oracle.
 */

import type { SafeProblemCode } from "@myownnotion/domain";
import type { FastifyRequest } from "fastify";
import type { RequestPrincipal, SecurityRequestContext } from "./request-context.ts";

export type AuthenticationOutcome =
  | { readonly authenticated: true; readonly principal: RequestPrincipal }
  /**
   * No credential was presented. Distinct from a *failed* credential: a route
   * may legitimately serve an anonymous caller (installation status), but must
   * never serve one whose credential was rejected.
   */
  | { readonly authenticated: false; readonly reason: "absent" }
  | { readonly authenticated: false; readonly reason: "rejected"; readonly code: SafeProblemCode };

/**
 * Resolves a principal from a request.
 *
 * Implementations must not throw for an ordinary rejection — an exception is
 * for an infrastructure failure, and the two get different treatment: a
 * rejection is audited as `auth.failed`, an exception becomes
 * `internal_error`.
 */
export interface PrincipalResolver {
  readonly name: string;
  resolve(request: FastifyRequest): Promise<AuthenticationOutcome>;
}

/**
 * Runs resolvers in order and stops at the first that decides.
 *
 * "Decides" includes rejecting. A presented-but-invalid session must **not**
 * fall through to the next resolver: doing so would let a caller with a
 * revoked session be treated as anonymous and reach an anonymous-allowed
 * route, which is a quieter failure than being refused.
 */
export async function resolvePrincipal(
  request: FastifyRequest,
  resolvers: readonly PrincipalResolver[],
): Promise<AuthenticationOutcome> {
  for (const resolver of resolvers) {
    const outcome = await resolver.resolve(request);
    if (outcome.authenticated || outcome.reason === "rejected") {
      return outcome;
    }
  }
  return { authenticated: false, reason: "absent" };
}

/**
 * What a route requires of the caller.
 *
 * `recentAuthentication` is separate from `owner` because a valid session is
 * not enough for a sensitive operation: enrolling a credential, changing the
 * password, or revoking every session must prove possession *now*, not at some
 * point in the last thirty days.
 */
export interface RouteAuthenticationRequirement {
  readonly principal: "anonymous" | "bootstrap" | "owner";
  readonly csrf?: boolean;
  readonly recentAuthentication?: boolean;
}

export interface CsrfValidator {
  /** True when the request carries a valid `X-CSRF-Token` for its session. */
  validate(request: FastifyRequest, context: SecurityRequestContext): boolean;
}

export interface RecentAuthenticationPolicy {
  /** Whether `recentAuthAt` is recent enough at `now`. */
  isRecent(recentAuthAt: Date, now: Date): boolean;
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: SafeProblemCode };

/**
 * Applies a route's requirement to a resolved context.
 *
 * Order matters and is fixed here rather than left to each route: identity
 * first, then CSRF, then recency. Checking CSRF before identity would let an
 * unauthenticated caller learn whether a token shape is accepted; checking
 * recency before identity would do the same for session lifetimes.
 */
export function authorizeRequest(
  context: SecurityRequestContext,
  requirement: RouteAuthenticationRequirement,
  services: { csrf?: CsrfValidator; recentAuthentication?: RecentAuthenticationPolicy },
  request: FastifyRequest,
  now: Date = new Date(),
): AuthorizationDecision {
  if (requirement.principal === "anonymous") {
    return { allowed: true };
  }

  if (requirement.principal === "bootstrap") {
    return context.principal.kind === "bootstrap"
      ? { allowed: true }
      : { allowed: false, code: "bootstrap_capability_invalid" };
  }

  if (context.principal.kind !== "owner") {
    return { allowed: false, code: "authentication_required" };
  }

  if (requirement.csrf === true) {
    const validator = services.csrf;
    // A missing validator must refuse, not pass. A misconfiguration that
    // silently disabled CSRF would be invisible until it was exploited.
    if (validator === undefined || !validator.validate(request, context)) {
      return { allowed: false, code: "csrf_validation_failed" };
    }
  }

  if (requirement.recentAuthentication === true) {
    const policy = services.recentAuthentication;
    if (policy === undefined || !policy.isRecent(context.principal.recentAuthAt, now)) {
      return { allowed: false, code: "recent_authentication_required" };
    }
  }

  return { allowed: true };
}
