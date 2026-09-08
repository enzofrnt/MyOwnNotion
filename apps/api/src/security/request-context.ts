/**
 * Per-request security context (T021, feature 002).
 *
 * Every request gets a correlation ID and, once resolved, the installation
 * state and the authenticated principal. The context is attached to the
 * request and read by the hooks and guards below, so no route has to
 * re-derive it — and no route can accidentally answer using a *different*
 * view of who is calling than the one the guard checked.
 *
 * The correlation ID is created for **every** request, including anonymous and
 * rejected ones. It is the only bridge between the redacted problem the caller
 * receives and the unredacted server log, so creating it lazily would leave
 * exactly the failures an operator most needs to trace without one.
 */

import { randomUUID } from "node:crypto";
import type { InstallationState } from "@myownnotion/domain";
import type { FastifyRequest } from "fastify";

/**
 * Who is making the request.
 *
 * `hosting-admin` is deliberately absent: hosting-administrator operations are
 * the protected local CLI only, and the CLI does not go through this API. A
 * request can therefore never be attributed to an administrator, which is what
 * makes "no remote administrator transport" checkable rather than promised.
 */
export type RequestPrincipal =
  | { readonly kind: "anonymous" }
  /** A verified bootstrap attempt: no session, no owner row yet. */
  | { readonly kind: "bootstrap"; readonly attemptId: string }
  | {
      readonly kind: "owner";
      readonly ownerId: string;
      readonly sessionId: string;
      readonly deviceId: string;
      /** When the principal last proved possession of a credential. */
      readonly recentAuthAt: Date;
    };

export interface SecurityRequestContext {
  readonly correlationId: string;
  readonly principal: RequestPrincipal;
  /** Only a verified live session may report its device's revocation. */
  readonly authenticationRefusal?: "device_revoked";
  /** Null before the installation row exists at all. */
  readonly installationState: InstallationState | null;
  readonly installationId: string | null;
  readonly workspaceId: string | null;
  /** False when the deployment key is unavailable or invalid. */
  readonly deploymentKeyAvailable: boolean;
  readonly receivedAt: Date;
}

const CONTEXT_KEY = Symbol.for("myownnotion.security.request-context");

type RequestWithContext = FastifyRequest & {
  [CONTEXT_KEY]?: SecurityRequestContext;
};

export function createRequestContext(
  overrides: Partial<SecurityRequestContext> = {},
): SecurityRequestContext {
  return {
    correlationId: randomUUID(),
    principal: { kind: "anonymous" },
    installationState: null,
    installationId: null,
    workspaceId: null,
    deploymentKeyAvailable: false,
    receivedAt: new Date(),
    ...overrides,
  };
}

export function attachRequestContext(
  request: FastifyRequest,
  context: SecurityRequestContext,
): void {
  (request as RequestWithContext)[CONTEXT_KEY] = context;
}

/**
 * Reads the context, creating a fallback if a route somehow runs before the
 * hook. The fallback is anonymous and key-unavailable — the most restrictive
 * possible view — so a missing hook fails closed rather than granting access.
 */
export function requestContext(request: FastifyRequest): SecurityRequestContext {
  const existing = (request as RequestWithContext)[CONTEXT_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const fallback = createRequestContext();
  attachRequestContext(request, fallback);
  return fallback;
}

/** Replaces the context, e.g. once authentication resolves the principal. */
export function updateRequestContext(
  request: FastifyRequest,
  changes: Partial<SecurityRequestContext>,
): SecurityRequestContext {
  const next = { ...requestContext(request), ...changes };
  attachRequestContext(request, next);
  return next;
}

export function isOwnerPrincipal(
  principal: RequestPrincipal,
): principal is Extract<RequestPrincipal, { kind: "owner" }> {
  return principal.kind === "owner";
}

export function isBootstrapPrincipal(
  principal: RequestPrincipal,
): principal is Extract<RequestPrincipal, { kind: "bootstrap" }> {
  return principal.kind === "bootstrap";
}
