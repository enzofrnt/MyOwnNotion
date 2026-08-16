/**
 * When to warn that a connection is not safe (T067, US5, FR-024).
 *
 * Tested as a pure function rather than through a journey, because the cases
 * that matter cannot be reached from a test server bound to loopback — and
 * those are exactly the cases where being wrong costs something: a LAN address,
 * a public hostname over plain HTTP.
 *
 * The rule follows the platform's own notion of a secure context rather than
 * inventing one. That is what makes the supported default — local HTTP behind
 * an owner's own reverse proxy — free of a warning it does not deserve.
 */

import { describe, expect, it } from "vitest";
import { isInsecureRemote, isLocalAddress } from "../src/features/connection/connection-status.tsx";

describe("addresses the browser already trusts", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "app.localhost"])(
    "treats %s as local",
    (hostname) => {
      expect(isLocalAddress(hostname)).toBe(true);
    },
  );

  it.each(["192.168.1.10", "notes.example.org", "10.0.0.5", "myownnotion.internal"])(
    "treats %s as remote",
    (hostname) => {
      expect(isLocalAddress(hostname)).toBe(false);
    },
  );
});

describe("when the warning appears", () => {
  it("stays silent on the supported local default", () => {
    // compose.yaml publishes plain HTTP on loopback on purpose. A warning here
    // would fire for every owner on the intended setup, which teaches them to
    // dismiss the one that matters.
    expect(isInsecureRemote({ protocol: "http:", hostname: "127.0.0.1" })).toBe(false);
  });

  it("stays silent on HTTPS anywhere", () => {
    expect(isInsecureRemote({ protocol: "https:", hostname: "notes.example.org" })).toBe(false);
  });

  it("warns on plain HTTP to a LAN address", () => {
    // The case an owner is most likely to reach by accident, and the one where
    // everything they write crosses a network they do not control in clear.
    expect(isInsecureRemote({ protocol: "http:", hostname: "192.168.1.10" })).toBe(true);
  });

  it("warns on plain HTTP to a public hostname", () => {
    expect(isInsecureRemote({ protocol: "http:", hostname: "notes.example.org" })).toBe(true);
  });
});
