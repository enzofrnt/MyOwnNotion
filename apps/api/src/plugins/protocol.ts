/**
 * Announcing the protocol version on every response (T007, FR-017).
 *
 * On *every* response, not on a handshake. A handshake is a statement about the
 * moment it happened, and this server can be upgraded under a client that is
 * holding a long-lived stream open. That client would keep writing against a
 * version it agreed to hours earlier and no longer speaks. Putting the version
 * on each response means the answer a client last saw is never older than its
 * last request.
 *
 * An `onSend` hook rather than a route-by-route header: the guarantee is "every
 * response", and a guarantee that each new route has to remember is one a new
 * route will eventually forget.
 *
 * The header is deliberately not a security control. It tells a client what this
 * server speaks; refusing an incompatible write is done by the write path
 * itself, because a client is free to ignore a header and the refusal must not
 * depend on its cooperation (see `requireWriteProtocol`).
 */

import {
  describeProtocolRefusal,
  PROTOCOL_VERSION,
  type ProtocolWindow,
  parseClientVersion,
  protocolAccessFor,
} from "@myownnotion/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** Where the server states what it speaks. */
export const PROTOCOL_HEADER = "x-myownnotion-protocol";

/** Where a client states what it speaks. */
export const CLIENT_PROTOCOL_HEADER = "x-myownnotion-client-protocol";

/**
 * Where a refusal states the version the client needs.
 *
 * Beside the sentence, not instead of it. The sentence is what an owner reads;
 * this is what an updater can act on without parsing prose.
 */
export const REQUIRED_PROTOCOL_HEADER = "x-myownnotion-required-protocol";

export function registerProtocolAnnouncement(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header(PROTOCOL_HEADER, String(PROTOCOL_VERSION));
    return payload;
  });
}

/** What this request's client announced, or null when it announced nothing. */
export function clientProtocolOf(request: FastifyRequest): number | null {
  const header = request.headers[CLIENT_PROTOCOL_HEADER];
  return parseClientVersion(Array.isArray(header) ? header[0] : header);
}

/**
 * Raised when a client is too old for the write it attempted.
 *
 * Carries the message the owner reads, built by the domain rather than here, so
 * the sentence naming the version needed exists in one place and is tested
 * without a server.
 */
export class ProtocolTooOldError extends Error {
  constructor(
    readonly clientVersion: number | null,
    readonly requiredVersion: number,
    readonly reason: string,
    readonly readable: boolean,
  ) {
    super(reason);
    this.name = "ProtocolTooOldError";
  }
}

/**
 * Refuses a write from a client below the write minimum (FR-018, FR-019).
 *
 * Called by write paths, not by a global hook: a global hook would have to
 * decide what counts as a write from the method alone, and the cost of getting
 * that wrong in either direction is high — a missed write is corruption, a
 * refused read is an owner locked out of their own notes.
 */
export function requireWriteProtocol(request: FastifyRequest, window?: ProtocolWindow): void {
  const clientVersion = clientProtocolOf(request);
  const access = protocolAccessFor(clientVersion, window);
  if (access.kind === "full") {
    return;
  }
  const reason = describeProtocolRefusal(access) ?? "This device needs an update before writing";
  throw new ProtocolTooOldError(
    clientVersion,
    access.requiredVersion,
    reason,
    access.kind === "read-only",
  );
}

/**
 * Refuses a read from a client below the read minimum (FR-020).
 *
 * Separate from the write gate because "too old to write" and "too old to read"
 * are different situations with different remedies, and collapsing them would
 * make read-only mode unreachable.
 */
export function requireReadProtocol(request: FastifyRequest, window?: ProtocolWindow): void {
  const clientVersion = clientProtocolOf(request);
  const access = protocolAccessFor(clientVersion, window);
  if (access.kind !== "refused") {
    return;
  }
  const reason = describeProtocolRefusal(access) ?? "This device needs an update";
  throw new ProtocolTooOldError(clientVersion, access.requiredVersion, reason, false);
}
