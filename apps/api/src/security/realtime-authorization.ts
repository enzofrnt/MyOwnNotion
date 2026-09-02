/** Authentication gates specific to the persistent page-sync channel. */

import type { Database } from "@myownnotion/database";
import type { FastifyRequest } from "fastify";
import { deriveCsrfToken, tokensMatch } from "./csrf.ts";
import type { RequestPrincipal } from "./request-context.ts";
import { authorizeSynchronization } from "./synchronization-authorization.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

export type RealtimeAuthorizationRefusal = {
  readonly allowed: false;
  readonly code: "authentication_required" | "csrf_validation_failed" | "device_revoked";
  readonly message: string;
};

export type RealtimeAuthorizationDecision =
  | { readonly allowed: true; readonly owner: OwnerPrincipal }
  | RealtimeAuthorizationRefusal;

/** Bun must accept a WebSocket upgrade before any asynchronous hook yields. */
export function isWebSocketUpgradeRequest(request: FastifyRequest): boolean {
  const upgrade = request.headers.upgrade;
  return typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
}

export function hasExactRealtimeOrigin(
  request: FastifyRequest,
  trustedOrigins: readonly URL[],
): boolean {
  const header = request.headers.origin;
  const presented = Array.isArray(header) ? header[0] : header;
  if (typeof presented !== "string") return false;
  return trustedOrigins.some((origin) => presented === origin.origin);
}

export async function authorizeRealtimeHello(input: {
  readonly db: Database;
  readonly principal: RequestPrincipal;
  readonly csrfToken: string;
  readonly deploymentKey: () => Buffer | null;
}): Promise<RealtimeAuthorizationDecision> {
  if (input.principal.kind !== "owner") {
    return {
      allowed: false,
      code: "authentication_required",
      message: "An authenticated session is required.",
    };
  }
  const key = input.deploymentKey();
  if (
    key === null ||
    !tokensMatch(deriveCsrfToken(key, input.principal.sessionId), input.csrfToken)
  ) {
    return {
      allowed: false,
      code: "csrf_validation_failed",
      message: "The authenticated session must be refreshed.",
    };
  }
  const device = await authorizeSynchronization(input.db, {
    ownerId: input.principal.ownerId,
    deviceId: input.principal.deviceId,
  });
  if (!device.allowed) {
    return {
      allowed: false,
      code: "device_revoked",
      message: "This device is no longer authorized.",
    };
  }
  return { allowed: true, owner: input.principal };
}

export async function reauthorizeRealtimeDevice(input: {
  readonly db: Database;
  readonly owner: OwnerPrincipal;
}): Promise<boolean> {
  return (
    await authorizeSynchronization(input.db, {
      ownerId: input.owner.ownerId,
      deviceId: input.owner.deviceId,
    })
  ).allowed;
}
