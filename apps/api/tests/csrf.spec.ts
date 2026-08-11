/**
 * CSRF token derivation and validation (T045, feature 002).
 *
 * The validator's job is to refuse, and every one of its refusal paths is a
 * place where a mistake would silently disable the check rather than break
 * anything visible. So each is asserted separately: no owner, no deployment
 * key, no header, a token for another session, a near-miss token.
 *
 * The derivation is keyed by the deployment key rather than by the session
 * secret alone. Without a server-held key, whoever learns a session secret
 * could also mint its token, and the second factor would collapse back into
 * the first — so there is a test for exactly that.
 */

import { randomBytes } from "node:crypto";
import { CSRF_TOKEN_HEADER } from "@myownnotion/contracts";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createCsrfValidator, deriveCsrfToken, tokensMatch } from "../src/security/csrf.ts";
import {
  createRequestContext,
  type SecurityRequestContext,
} from "../src/security/request-context.ts";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const SESSION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OTHER_SESSION = "018f2b7c-0000-7000-8000-000000000002";

function ownerContext(sessionId = SESSION_ID): SecurityRequestContext {
  return createRequestContext({
    principal: {
      kind: "owner",
      ownerId: "018f2b7c-0000-7000-8000-0000000000bb",
      sessionId,
      deviceId: "018f2b7c-0000-7000-8000-0000000000cc",
      recentAuthAt: new Date(),
    },
  });
}

function requestWith(token?: string): FastifyRequest {
  return { headers: token === undefined ? {} : { [CSRF_TOKEN_HEADER]: token } } as FastifyRequest;
}

describe("deriving the token", () => {
  it("is stable for the same key and session", () => {
    expect(deriveCsrfToken(KEY, SESSION_ID)).toBe(deriveCsrfToken(KEY, SESSION_ID));
  });

  it("differs per session", () => {
    // Otherwise a token lifted from one session would authorize writes on
    // another.
    expect(deriveCsrfToken(KEY, SESSION_ID)).not.toBe(deriveCsrfToken(KEY, OTHER_SESSION));
  });

  it("differs per deployment key", () => {
    // This is what makes the token unmintable by someone who knows only the
    // session. If it ever stopped depending on the key, the second factor
    // would be a restatement of the first.
    expect(deriveCsrfToken(KEY, SESSION_ID)).not.toBe(deriveCsrfToken(OTHER_KEY, SESSION_ID));
  });

  it("is the length the contract pins", () => {
    // `CsrfToken` in the contract is exactly 43 characters.
    expect(deriveCsrfToken(KEY, SESSION_ID)).toHaveLength(43);
  });

  it("contains no session identifier", () => {
    // The token travels in a header a proxy may log. It must not carry the
    // session id along with it.
    expect(deriveCsrfToken(KEY, SESSION_ID)).not.toContain(SESSION_ID);
  });

  it("is URL-safe, so a client cannot corrupt it by encoding", () => {
    expect(deriveCsrfToken(KEY, SESSION_ID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("comparing tokens", () => {
  it("accepts an exact match", () => {
    const token = deriveCsrfToken(KEY, SESSION_ID);
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rejects a different length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch; the length is fixed and
    // public, so checking it first is safe and must not crash the request.
    expect(tokensMatch(deriveCsrfToken(KEY, SESSION_ID), "short")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
  });

  it("rejects a one-character difference", () => {
    const token = deriveCsrfToken(KEY, SESSION_ID);
    const nearMiss = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(tokensMatch(token, nearMiss)).toBe(false);
  });
});

describe("the validator refuses, in every direction", () => {
  const validator = createCsrfValidator({ deploymentKey: () => KEY });

  it("accepts the right token for the right session", () => {
    const context = ownerContext();
    const token = deriveCsrfToken(KEY, SESSION_ID);
    expect(validator.validate(requestWith(token), context)).toBe(true);
  });

  it("refuses when the principal is not an owner", () => {
    const anonymous = createRequestContext();
    expect(validator.validate(requestWith(deriveCsrfToken(KEY, SESSION_ID)), anonymous)).toBe(
      false,
    );
  });

  it("refuses when the deployment key is unavailable", () => {
    // A degraded installation is exactly when an attacker would prefer the
    // check to be skipped, so it fails closed rather than open.
    const degraded = createCsrfValidator({ deploymentKey: () => null });
    expect(degraded.validate(requestWith(deriveCsrfToken(KEY, SESSION_ID)), ownerContext())).toBe(
      false,
    );
  });

  it("refuses when the header is absent", () => {
    expect(validator.validate(requestWith(), ownerContext())).toBe(false);
  });

  it("refuses an empty header", () => {
    expect(validator.validate(requestWith(""), ownerContext())).toBe(false);
  });

  it("refuses a token minted for another session", () => {
    const token = deriveCsrfToken(KEY, OTHER_SESSION);
    expect(validator.validate(requestWith(token), ownerContext(SESSION_ID))).toBe(false);
  });

  it("refuses a token minted under another deployment key", () => {
    const token = deriveCsrfToken(OTHER_KEY, SESSION_ID);
    expect(validator.validate(requestWith(token), ownerContext())).toBe(false);
  });

  it("refuses a repeated header rather than picking the convenient one", () => {
    // A duplicated header is a classic way to slip a second value past a
    // parser. Only the first is read, and here the first is wrong.
    const request = {
      headers: { [CSRF_TOKEN_HEADER]: ["wrong", deriveCsrfToken(KEY, SESSION_ID)] },
    } as unknown as FastifyRequest;
    expect(validator.validate(request, ownerContext())).toBe(false);
  });
});
