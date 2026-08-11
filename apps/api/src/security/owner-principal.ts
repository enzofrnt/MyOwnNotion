/**
 * The owner-session principal resolver (T045/T046, feature 002).
 *
 * Turns a cookie into a principal, or refuses. It is the only place a session
 * secret is read from a request, so the rule that a production installation
 * never honours the loopback cookie is enforced once rather than at each
 * route.
 *
 * The resolver never distinguishes *why* a session was refused. Unknown,
 * revoked, and expired are one outcome — `rejected` — because a caller who can
 * tell them apart learns whether a secret was ever valid, and when it stopped
 * being so.
 */

import type { FastifyRequest } from "fastify";
import type { AuthenticationOutcome, PrincipalResolver } from "./authentication-hook.ts";
import { readSessionSecret } from "./cookie-policy.ts";
import type { SecurityConfig } from "./security-config.ts";
import type { SessionService } from "./session-service.ts";

export interface OwnerPrincipalResolverDeps {
  readonly sessions: SessionService;
  readonly config: SecurityConfig;
}

export function createOwnerPrincipalResolver(deps: OwnerPrincipalResolverDeps): PrincipalResolver {
  return {
    name: "owner-session",
    async resolve(request: FastifyRequest): Promise<AuthenticationOutcome> {
      const secret = readSessionSecret(request, deps.config);
      const resolution = await deps.sessions.resolve(secret);
      if (!resolution.resolved) {
        return resolution.reason === "absent"
          ? { authenticated: false, reason: "absent" }
          : // A presented-but-invalid session must not fall through to the
            // next resolver: being treated as anonymous would let a revoked
            // session reach an anonymous-allowed route.
            { authenticated: false, reason: "rejected", code: "authentication_failed" };
      }
      const { session } = resolution;
      return {
        authenticated: true,
        principal: {
          kind: "owner",
          ownerId: session.ownerId,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          recentAuthAt: session.recentAuthAt,
        },
      };
    },
  };
}
