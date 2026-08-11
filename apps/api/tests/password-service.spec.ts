/**
 * The password alternative's primitives (T043, feature 002).
 *
 * Hashing and verification are the parts of the credential path with no
 * network and no database, and they are where a mistake is quietest: a
 * verifier that accepts a corrupt row, an encoding that loses its parameters,
 * or a "no password set" branch that answers faster than a real check.
 *
 * These tests are slow by construction — the cost parameters are deliberately
 * expensive — and that is the property being protected. A change that made
 * them fast would be a change that made an offline attack cheap.
 */

import { describe, expect, it } from "vitest";
import {
  assertAcceptablePassword,
  buildPasswordVersion,
  CURRENT_PASSWORD_HASH,
  equivalentWork,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  verifyPassword,
  WeakPasswordError,
} from "../src/security/password-service.ts";

const PASSPHRASE = "correct horse battery staple";

describe("what the installation will accept", () => {
  it("takes a passphrase of a few words", () => {
    expect(() => assertAcceptablePassword(PASSPHRASE)).not.toThrow();
  });

  it("refuses anything shorter than the minimum", () => {
    expect(() => assertAcceptablePassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
      WeakPasswordError,
    );
    expect(() => assertAcceptablePassword("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it("refuses an unbounded input", () => {
    // scrypt hashes whatever it is given; without a ceiling, one
    // unauthenticated request is an unbounded amount of server work.
    expect(() => assertAcceptablePassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).toThrow(
      WeakPasswordError,
    );
  });

  it("imposes no composition rules", () => {
    // Requiring a digit and a symbol pushes people towards `Password1!` —
    // shorter and more predictable than a passphrase. Length is what costs an
    // attacker, so length is the only rule.
    expect(() => assertAcceptablePassword("all lowercase words here")).not.toThrow();
  });

  it("says what is wrong in a way the owner can act on", () => {
    expect(() => assertAcceptablePassword("short")).toThrow(/at least 12 characters/);
  });
});

describe("hashing", () => {
  it("verifies the password it was given", async () => {
    const hashed = await hashPassword(PASSPHRASE);
    expect(await verifyPassword(PASSPHRASE, hashed.encoded)).toBe(true);
  });

  it("rejects a different password", async () => {
    const hashed = await hashPassword(PASSPHRASE);
    expect(await verifyPassword("some other passphrase", hashed.encoded)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    // Without this, identical passwords share a hash and a stolen table
    // becomes a lookup problem instead of a per-row attack.
    const first = await hashPassword(PASSPHRASE);
    const second = await hashPassword(PASSPHRASE);
    expect(first.encoded).not.toBe(second.encoded);
    expect(await verifyPassword(PASSPHRASE, second.encoded)).toBe(true);
  });

  it("carries its own parameters, so an old hash still verifies later", async () => {
    // Verification never guesses. A credential hashed before a cost increase
    // must keep working, or raising the cost logs every owner out.
    const hashed = await hashPassword(PASSPHRASE);
    const [algorithm, N, r, p] = hashed.encoded.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(N)).toBe(CURRENT_PASSWORD_HASH.parameters.N);
    expect(Number(r)).toBe(CURRENT_PASSWORD_HASH.parameters.r);
    expect(Number(p)).toBe(CURRENT_PASSWORD_HASH.parameters.p);
  });

  it("never contains the password", async () => {
    const hashed = await hashPassword(PASSPHRASE);
    expect(hashed.encoded).not.toContain(PASSPHRASE);
  });

  it("refuses to hash something too short", async () => {
    await expect(hashPassword("short")).rejects.toThrow(WeakPasswordError);
  });
});

describe("verifying against a stored row that is not what we expect", () => {
  it("refuses rather than throwing, for every malformed shape", async () => {
    // A corrupt row must refuse the login, not produce a server error that
    // distinguishes it from a wrong password.
    for (const encoded of [
      "",
      "garbage",
      "scrypt$$$$",
      "scrypt$1$1$1$salt$hash",
      "bcrypt$131072$8$1$c2FsdA$aGFzaA",
      "scrypt$131072$8$1$c2FsdA",
      "scrypt$notanumber$8$1$c2FsdA$aGFzaA",
    ]) {
      expect(await verifyPassword(PASSPHRASE, encoded), encoded).toBe(false);
    }
  });

  it("refuses parameters that would ask for an unbounded amount of memory", async () => {
    // A tampered row is the code path this guards. `N` beyond the ceiling is
    // refused before it reaches scrypt.
    expect(await verifyPassword(PASSPHRASE, "scrypt$999999999$8$1$c2FsdA$aGFzaA")).toBe(false);
  });

  it("refuses an empty hash segment", async () => {
    expect(await verifyPassword(PASSPHRASE, "scrypt$131072$8$1$c2FsdA$")).toBe(false);
  });
});

describe("rehashing", () => {
  it("leaves a current hash alone", async () => {
    expect(needsRehash((await hashPassword(PASSPHRASE)).encoded)).toBe(false);
  });

  it("flags a hash produced at older parameters", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdA$aGFzaA")).toBe(true);
  });

  it("flags anything it cannot read", () => {
    // An unreadable row cannot be verified, so it certainly needs replacing.
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("the work burned when no password is configured", () => {
  it("costs about as much as a real verification", async () => {
    // The point of `equivalentWork`. Without it the endpoint answers "is a
    // password configured?" in elapsed time, the one channel that cannot be
    // redacted. A loose bound, because a shared runner is noisy — what would
    // fail here is the dummy work being removed or made trivial.
    const hashed = await hashPassword(PASSPHRASE);

    const verifyStart = performance.now();
    await verifyPassword(PASSPHRASE, hashed.encoded);
    const verifyMs = performance.now() - verifyStart;

    const dummyStart = performance.now();
    await equivalentWork();
    const dummyMs = performance.now() - dummyStart;

    expect(dummyMs).toBeGreaterThan(verifyMs * 0.4);
    expect(dummyMs).toBeLessThan(verifyMs * 2.5);
  });
});

describe("building a credential version", () => {
  it("produces a row that verifies", async () => {
    const version = await buildPasswordVersion({
      ownerId: "018f2b7c-0000-7000-8000-0000000000bb",
      password: PASSPHRASE,
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(version.hashAlgorithm).toBe("scrypt");
    expect(await verifyPassword(PASSPHRASE, version.passwordHash)).toBe(true);
  });

  it("gives every version its own identity", async () => {
    const input = {
      ownerId: "018f2b7c-0000-7000-8000-0000000000bb",
      password: PASSPHRASE,
      now: new Date("2026-07-01T00:00:00.000Z"),
    };
    const first = await buildPasswordVersion(input);
    const second = await buildPasswordVersion(input);
    expect(first.id).not.toBe(second.id);
  });
});
