/**
 * What a client version is allowed to do (T031, US4, FR-017 to FR-020).
 *
 * The point of the two thresholds is that "refused" and "allowed" are not the
 * only useful answers. A client too old to write safely may still be able to
 * read, and an owner who can read can copy their work out of a device that is
 * behind. Locking them out entirely would turn "please update" into "your notes
 * are unreachable on this machine".
 */

import { describe, expect, it } from "vitest";
import {
  describeProtocolRefusal,
  MINIMUM_READ_VERSION,
  MINIMUM_WRITE_VERSION,
  PROTOCOL_VERSION,
  parseClientVersion,
  protocolAccessFor,
} from "../src/index.ts";

describe("the compatibility window", () => {
  it("admits the version this server speaks", () => {
    expect(protocolAccessFor(PROTOCOL_VERSION)).toEqual({ kind: "full" });
  });

  it("admits anything newer than this server, rather than refusing it", () => {
    // A newer client understands this protocol by definition of the window: it
    // is the *old* end that breaks compatibility. Refusing forward would make
    // every server upgrade a coordinated one.
    expect(protocolAccessFor(PROTOCOL_VERSION + 5)).toEqual({ kind: "full" });
  });

  it("keeps the read threshold at or below the write threshold", () => {
    // The invariant the two constants exist for. Inverted, "read-only" would be
    // unreachable and the pair would express nothing a single value could not.
    expect(MINIMUM_READ_VERSION).toBeLessThanOrEqual(MINIMUM_WRITE_VERSION);
  });
});

describe("a client that announces nothing", () => {
  it("is given full access rather than refused", () => {
    // Every client built before this feature announces nothing. Refusing them
    // would break working installations at the moment of upgrade, which is
    // precisely when an owner is least able to diagnose it. The header starts
    // carrying information when the first incompatible change ships.
    expect(protocolAccessFor(null)).toEqual({ kind: "full" });
  });

  it("treats an unparseable header as announcing nothing", () => {
    expect(parseClientVersion("not a number")).toBeNull();
    expect(parseClientVersion("")).toBeNull();
    expect(parseClientVersion(undefined)).toBeNull();
    // Zero and negatives are not versions.
    expect(parseClientVersion("0")).toBeNull();
    expect(parseClientVersion("-3")).toBeNull();
  });

  it("parses a plain version", () => {
    expect(parseClientVersion("1")).toBe(1);
    expect(parseClientVersion(" 2 ")).toBe(2);
  });
});

describe("what the owner is told", () => {
  it("says nothing when there is nothing wrong", () => {
    expect(describeProtocolRefusal({ kind: "full" })).toBeNull();
  });

  it("names the version needed, and says nothing is lost", () => {
    const message = describeProtocolRefusal({ kind: "read-only", requiredVersion: 4 });
    // The number is in the sentence: "please update" without it leaves someone
    // comparing two things they cannot see.
    expect(message).toContain("4");
    // And it says the content is safe, because the first thing an owner fears
    // when a device stops writing is that their work went with it.
    expect(message).toMatch(/nothing has been lost/i);
  });

  it("distinguishes read-only from refused in what it says", () => {
    const readOnly = describeProtocolRefusal({ kind: "read-only", requiredVersion: 2 });
    const refused = describeProtocolRefusal({ kind: "refused", requiredVersion: 2 });
    expect(readOnly).not.toBe(refused);
    expect(readOnly).toMatch(/can read/i);
  });
});
