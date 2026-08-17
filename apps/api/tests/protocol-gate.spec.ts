/**
 * What an out-of-date client may and may not do (T032, US4, FR-017 to FR-020).
 *
 * Two halves, and the split is deliberate. Over a real app: the version is
 * announced on every response, and a current client writes. Against the gate
 * directly, with a stated window: the refusal itself, which at protocol version 1
 * is unreachable through HTTP because the minimums and the current version
 * coincide. Testing only what is reachable today would ship the refusal path
 * untested and first exercise it on the day it starts refusing real devices.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLIENT_PROTOCOL_HEADER,
  ProtocolTooOldError,
  requireReadProtocol,
  requireWriteProtocol,
} from "../src/plugins/protocol.ts";
import { type ApiHarness, createApiHarness, idempotencyHeaders } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

/** The minimum a request needs to be judged by version. */
function requestAnnouncing(version: string | undefined): FastifyRequest {
  return {
    headers: version === undefined ? {} : { [CLIENT_PROTOCOL_HEADER]: version },
  } as unknown as FastifyRequest;
}

/** A future window, where a version-1 client is behind. */
const FUTURE = { minimumRead: 3, minimumWrite: 4 };

describe("what the server announces", () => {
  it("states its protocol version on an ordinary response", async () => {
    const response = await harness.built.app.inject({ method: "GET", url: "/v1/items" });
    expect(response.statusCode).toBe(200);
    // On every response rather than on a handshake: this server can be upgraded
    // under a client holding a stream open, and a handshake is a statement about
    // a moment that has passed.
    expect(response.headers["x-myownnotion-protocol"]).toBe("1");
  });

  it("states it on a failure too", async () => {
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/items/not-a-uuid",
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    // A client that only ever sees errors still needs to learn that it is the
    // one out of date.
    expect(response.headers["x-myownnotion-protocol"]).toBe("1");
  });

  it("accepts a write from a client at the current version", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: { ...idempotencyHeaders(), [CLIENT_PROTOCOL_HEADER]: "1" },
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Current client",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it("accepts a write from a client that announces nothing", async () => {
    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Silent client",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
    });
    // Every client built before this feature announces nothing. Refusing them
    // would break working installations at the moment of upgrade.
    expect(response.statusCode).toBe(201);
  });
});

describe("a client below the write minimum", () => {
  it("is refused the write, and told the version to update to", () => {
    let thrown: unknown;
    try {
      requireWriteProtocol(requestAnnouncing("3"), FUTURE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProtocolTooOldError);
    const error = thrown as ProtocolTooOldError;
    expect(error.requiredVersion).toBe(4);
    // The number is in the sentence the owner reads: "please update" without it
    // leaves someone comparing two things they cannot see.
    expect(error.reason).toContain("4");
    expect(error.readable).toBe(true);
  });

  it("keeps its reads, because a read cannot corrupt anything", () => {
    // The point of two thresholds. An owner who can still read can copy their
    // work out of a device that is behind; locking them out takes that away.
    expect(() => requireReadProtocol(requestAnnouncing("3"), FUTURE)).not.toThrow();
  });
});

describe("a client below the read minimum", () => {
  it("is refused both, and told so differently", () => {
    let thrown: unknown;
    try {
      requireReadProtocol(requestAnnouncing("1"), FUTURE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProtocolTooOldError);
    const error = thrown as ProtocolTooOldError;
    expect(error.requiredVersion).toBe(3);
    // Not read-only: there is nothing safe left to offer, and saying "you can
    // read" to a device that cannot would be worse than saying nothing.
    expect(error.readable).toBe(false);
  });

  it("is still refused the write", () => {
    expect(() => requireWriteProtocol(requestAnnouncing("1"), FUTURE)).toThrow(ProtocolTooOldError);
  });
});

describe("a client newer than this server", () => {
  it("is not refused", () => {
    // The window breaks at the old end. Refusing forward would make every
    // server upgrade a coordinated one.
    expect(() => requireWriteProtocol(requestAnnouncing("99"), FUTURE)).not.toThrow();
  });
});
