/**
 * The live change stream (T010, T017, T035 — US1, US2, US4).
 *
 * `GET /v1/changes/stream` as server-sent events. Contract:
 * [specs/006-multi-device-sync/contracts/live-stream.md](../../../../specs/006-multi-device-sync/contracts/live-stream.md).
 *
 * **The event is a position, never content.** A device that hears `42` then
 * reads `/v1/changes?after=<its own cursor>`, exactly as it does when nothing is
 * connected. Pushing the change itself would be faster by one round trip and
 * would create a second content path — one that bypasses the sealed-envelope
 * resolution and the protocol check the pull path performs. Feature 005 already
 * found that shape of defect in the batch route, where the busiest write path
 * had neither guarantee the single-command routes enforced.
 *
 * It also makes redelivery free. A position is a fact rather than an operation,
 * so hearing `42` twice is hearing it once (FR-007).
 *
 * SSE rather than WebSocket: every message here goes server to client, and a
 * WebSocket would add a second inbound write path that has none of the
 * protections the mutation routes carry.
 */

import { currentSequence, oldestRetainedSequence, sequenceToCursor } from "@myownnotion/database";
import { PROTOCOL_VERSION } from "@myownnotion/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { securityProblem } from "../plugins/errors.ts";
import { PROTOCOL_HEADER } from "../plugins/protocol.ts";
import { requestContext } from "../security/request-context.ts";
import { changeNotifier } from "../sync/change-notifier.ts";

/** Default heartbeat interval; `MYOWNNOTION_SSE_HEARTBEAT_MS` overrides it. */
const DEFAULT_HEARTBEAT_MS = 20_000;

function heartbeatInterval(): number {
  const configured = Number.parseInt(process.env["MYOWNNOTION_SSE_HEARTBEAT_MS"] ?? "", 10);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_HEARTBEAT_MS;
}

/**
 * Where this device says it got to, from the header the browser resends itself.
 *
 * `EventSource` sets `Last-Event-ID` without being asked, which is why the
 * event ids this route writes are the sequence numbers: the reconnection then
 * carries a position the server already understands, and the client needs no
 * reconnection logic of its own to be correct.
 *
 * An unparseable value is treated as absent rather than as an error. A client
 * that sends nonsense is a client asking to start from where the feed is, and
 * refusing the connection would leave it with no way to catch up at all.
 */
function lastEventIdOf(request: FastifyRequest): number | null {
  const header = request.headers["last-event-id"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function writeEvent(
  reply: FastifyReply,
  event: { readonly id?: number; readonly name: string; readonly data: unknown },
): void {
  const lines: string[] = [];
  if (event.id !== undefined) {
    lines.push(`id: ${event.id}`);
  }
  lines.push(`event: ${event.name}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  reply.raw.write(`${lines.join("\n")}\n\n`);
}

/**
 * Whether this request comes from a device the owner revoked (FR-021).
 *
 * Checked on every connection, not only at revocation time, because a stream is
 * long-lived and a device that reconnects after being cut off must be refused
 * again. Closing the open stream alone would leave `EventSource` reconnecting
 * successfully one second later.
 *
 * An anonymous request and an installation with no security layer both answer
 * false: the feature-001 harness builds an app without one and must keep
 * streaming, and a request with no device has no device to revoke.
 */
async function isRevoked(request: FastifyRequest, context: AppContext): Promise<boolean> {
  const principal = requestContext(request).principal;
  if (principal.kind !== "owner" || context.devices === undefined) {
    return false;
  }
  const device = await context.devices.inspect({
    ownerId: principal.ownerId,
    deviceId: principal.deviceId,
  });
  // A device that no longer exists is treated as revoked. The alternative —
  // "not found, so allow" — would make deletion a way to regain access.
  return device === null || device.state === "revoked";
}

export function registerChangeStreamRoutes(app: FastifyInstance, context: AppContext): void {
  app.get("/v1/changes/stream", async (request, reply) => {
    // Before the hijack, because a refusal is an ordinary problem document and
    // Fastify should serialize it. Enforced here rather than by asking the
    // client to stop (FR-021): a guarantee that depends on the cooperation of
    // the one party with a reason not to cooperate is not a guarantee.
    if (await isRevoked(request, context)) {
      const problem = securityProblem({
        code: "device_revoked",
        correlationId: requestContext(request).correlationId,
      });
      return reply
        .status(problem.status)
        .header("content-type", "application/problem+json")
        .send(problem);
    }

    // Hijacked, so Fastify does not try to serialize or end this response. That
    // also means the `onSend` hook never runs for it, which is why the protocol
    // header is written by hand below rather than inherited — a stream that
    // announced no version would be the one long-lived response where a client
    // could drift, and that is exactly the case FR-017 is about.
    reply.hijack();

    const position = await context.db.transaction(async (tx) => ({
      current: await currentSequence(tx, context.workspaceId),
      oldest: await oldestRetainedSequence(tx, context.workspaceId),
    }));

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      // No proxy or browser may hold any of this: a replayed stream would
      // deliver positions from a moment that has passed.
      "cache-control": "no-store",
      connection: "keep-alive",
      // Nginx buffers proxied responses by default, which turns a live stream
      // into a stream that arrives when it is full — that is, not live.
      "x-accel-buffering": "no",
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    });

    const askedFrom = lastEventIdOf(request);

    // A device asks for everything after `askedFrom`, so the changes it needs
    // start at `askedFrom + 1`. It can be served when the feed still holds that
    // position. Resuming from the oldest retained change instead would leave the
    // device permanently missing whatever fell in the gap, silently — the
    // failure FR-006 exists to prevent.
    const servable =
      askedFrom === null || position.oldest === 0 || askedFrom + 1 >= position.oldest;

    if (!servable) {
      writeEvent(reply, {
        name: "compacted",
        data: { cursor: sequenceToCursor(position.current) },
      });
    } else {
      // Sent on a first connection too, with no `Last-Event-ID`. A device that
      // missed everything then behaves exactly like a device that missed one
      // thing: one code path, and the one that gets exercised constantly.
      writeEvent(reply, {
        id: position.current,
        name: "advanced",
        data: { cursor: sequenceToCursor(position.current) },
      });
    }

    // Declared before the timer and the subscription so both can be released
    // from inside either of them. Assigned after both exist.
    let release = (): void => {};

    const heartbeat = setInterval(() => {
      // Revocation has to reach a connection that is *already open* (FR-021).
      // Refusing at reconnection alone is not enough: a stream established
      // before the owner revoked the device survives indefinitely, so the device
      // they cut off would keep hearing about their work — for as long as its
      // socket stayed up, which could be days.
      //
      // Checked on the heartbeat rather than on a separate timer, because that is
      // already the tick that exists and revocation taking effect within one
      // heartbeat is what "stops" means in practice.
      void isRevoked(request, context).then((revoked) => {
        if (revoked) {
          release();
          reply.raw.end();
        }
      });
      // A comment line, ignored by `EventSource`. Not decoration: an idle SSE
      // connection is indistinguishable from a dead one to every proxy between
      // here and the device, and a connection a proxy dropped quietly leaves a
      // device believing it is live while hearing nothing. That is worse than a
      // visible disconnection, because nothing prompts a reconnect.
      reply.raw.write(": keep-alive\n\n");
    }, heartbeatInterval());
    // Node keeps the process alive for a pending timer; a heartbeat must not be
    // the reason a server refuses to shut down.
    heartbeat.unref?.();

    const unsubscribe = changeNotifier.subscribe((cursor) => {
      writeEvent(reply, { id: Number(cursor), name: "advanced", data: { cursor } });
    });

    release = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    // Both, because they fire in different circumstances: `close` when the
    // socket goes away, `aborted` when the client gives up mid-response. A
    // listener left registered is a write to a dead socket on every change.
    request.raw.on("close", () => release());
    request.raw.on("aborted", () => release());
  });
}
