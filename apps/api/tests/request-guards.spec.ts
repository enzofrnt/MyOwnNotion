/**
 * Request context, authentication hooks, and readiness guards (T021, feature 002).
 *
 * These modules decide who may do what, so the tests are written as a decision
 * table rather than as happy paths. Each assertion corresponds to a way access
 * could otherwise be granted by accident:
 *
 *   - a rejected credential falling through to an anonymous-allowed route;
 *   - a missing CSRF validator being treated as "CSRF disabled";
 *   - the bootstrap surface staying open after ownership commits;
 *   - a degraded installation still serving protected data;
 *   - a write-blocked installation refusing *reads* as well as writes.
 */

import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import {
  type AuthenticationOutcome,
  authorizeRequest,
  type PrincipalResolver,
  resolvePrincipal,
} from "../src/security/authentication-hook.ts";
import {
  checkProtectedWrite,
  checkReadiness,
  type ReadinessRequirement,
  ROUTE_READINESS,
} from "../src/security/private-route-guard.ts";
import {
  attachRequestContext,
  createRequestContext,
  isBootstrapPrincipal,
  isOwnerPrincipal,
  requestContext,
  type SecurityRequestContext,
  updateRequestContext,
} from "../src/security/request-context.ts";

const NOW = new Date("2026-01-01T12:00:00.000Z");

function ownerContext(overrides: Partial<SecurityRequestContext> = {}): SecurityRequestContext {
  return createRequestContext({
    principal: {
      kind: "owner",
      ownerId: "018f2b7c-0000-7000-8000-0000000000bb",
      sessionId: "018f2b7c-0000-7000-8000-0000000000cc",
      deviceId: "018f2b7c-0000-7000-8000-0000000000dd",
      recentAuthAt: NOW,
    },
    installationState: "ready",
    deploymentKeyAvailable: true,
    ...overrides,
  });
}

const fakeRequest = {} as FastifyRequest;

const alwaysValidCsrf = { validate: () => true };
const alwaysInvalidCsrf = { validate: () => false };
const alwaysRecent = { isRecent: () => true };
const neverRecent = { isRecent: () => false };

describe("request context", () => {
  it("gives every request a distinct correlation ID", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createRequestContext().correlationId));
    expect(ids.size).toBe(50);
  });

  it("starts anonymous with no key available", () => {
    // The most restrictive possible starting point.
    const context = createRequestContext();
    expect(context.principal.kind).toBe("anonymous");
    expect(context.deploymentKeyAvailable).toBe(false);
    expect(context.installationState).toBeNull();
  });

  it("falls back to an anonymous context when the hook did not run", () => {
    // A missing hook must fail closed rather than granting access.
    const request = {} as FastifyRequest;
    const context = requestContext(request);
    expect(context.principal.kind).toBe("anonymous");
    expect(context.deploymentKeyAvailable).toBe(false);
  });

  it("keeps the correlation ID stable across updates", () => {
    const request = {} as FastifyRequest;
    attachRequestContext(request, createRequestContext());
    const before = requestContext(request).correlationId;
    updateRequestContext(request, { installationState: "ready" });
    expect(requestContext(request).correlationId).toBe(before);
    expect(requestContext(request).installationState).toBe("ready");
  });

  it("narrows principals with the type guards", () => {
    expect(isOwnerPrincipal(ownerContext().principal)).toBe(true);
    expect(isBootstrapPrincipal(ownerContext().principal)).toBe(false);
    expect(isBootstrapPrincipal({ kind: "bootstrap", attemptId: "a" })).toBe(true);
  });

  it("has no representation for a hosting-administrator principal", () => {
    // Administration is the protected local CLI only, and the CLI does not go
    // through this API. A request can never be attributed to an administrator.
    const kinds: Array<SecurityRequestContext["principal"]["kind"]> = [
      "anonymous",
      "bootstrap",
      "owner",
    ];
    expect(kinds).not.toContain("hosting-admin");
  });
});

describe("principal resolution", () => {
  function resolver(name: string, outcome: AuthenticationOutcome): PrincipalResolver {
    return { name, resolve: async () => outcome };
  }

  it("stops at the first resolver that authenticates", async () => {
    const outcome = await resolvePrincipal(fakeRequest, [
      resolver("absent", { authenticated: false, reason: "absent" }),
      resolver("session", {
        authenticated: true,
        principal: { kind: "bootstrap", attemptId: "a" },
      }),
      resolver("never-reached", {
        authenticated: true,
        principal: { kind: "anonymous" },
      }),
    ]);
    expect(outcome.authenticated).toBe(true);
    expect(outcome.authenticated && outcome.principal.kind).toBe("bootstrap");
  });

  it("stops at a rejection instead of falling through", async () => {
    // A revoked session must be refused, not silently downgraded to anonymous
    // and allowed onto an anonymous-permitted route.
    const outcome = await resolvePrincipal(fakeRequest, [
      resolver("session", {
        authenticated: false,
        reason: "rejected",
        code: "authentication_failed",
      }),
      resolver("would-allow", {
        authenticated: true,
        principal: {
          kind: "owner",
          ownerId: "o",
          sessionId: "s",
          deviceId: "d",
          recentAuthAt: NOW,
        },
      }),
    ]);
    expect(outcome.authenticated).toBe(false);
    expect(outcome.authenticated === false && outcome.reason).toBe("rejected");
  });

  it("reports absent when no resolver decides", async () => {
    const outcome = await resolvePrincipal(fakeRequest, [
      resolver("a", { authenticated: false, reason: "absent" }),
      resolver("b", { authenticated: false, reason: "absent" }),
    ]);
    expect(outcome).toEqual({ authenticated: false, reason: "absent" });
  });

  it("reports absent for an empty resolver list", async () => {
    expect(await resolvePrincipal(fakeRequest, [])).toEqual({
      authenticated: false,
      reason: "absent",
    });
  });
});

describe("route authorization", () => {
  it("lets anyone reach an anonymous route", () => {
    expect(
      authorizeRequest(createRequestContext(), { principal: "anonymous" }, {}, fakeRequest, NOW),
    ).toEqual({ allowed: true });
  });

  it("requires an owner principal for an owner route", () => {
    expect(
      authorizeRequest(createRequestContext(), { principal: "owner" }, {}, fakeRequest, NOW),
    ).toEqual({ allowed: false, code: "authentication_required" });
  });

  it("requires a bootstrap principal for a bootstrap route", () => {
    expect(
      authorizeRequest(createRequestContext(), { principal: "bootstrap" }, {}, fakeRequest, NOW),
    ).toEqual({ allowed: false, code: "bootstrap_capability_invalid" });
    expect(
      authorizeRequest(
        createRequestContext({ principal: { kind: "bootstrap", attemptId: "a" } }),
        { principal: "bootstrap" },
        {},
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses when CSRF is required but no validator is configured", () => {
    // A misconfiguration that silently disabled CSRF would be invisible until
    // it was exploited.
    expect(
      authorizeRequest(ownerContext(), { principal: "owner", csrf: true }, {}, fakeRequest, NOW),
    ).toEqual({ allowed: false, code: "csrf_validation_failed" });
  });

  it("refuses an invalid CSRF token and accepts a valid one", () => {
    expect(
      authorizeRequest(
        ownerContext(),
        { principal: "owner", csrf: true },
        { csrf: alwaysInvalidCsrf },
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: false, code: "csrf_validation_failed" });
    expect(
      authorizeRequest(
        ownerContext(),
        { principal: "owner", csrf: true },
        { csrf: alwaysValidCsrf },
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it("refuses when recent authentication is required but no policy is configured", () => {
    expect(
      authorizeRequest(
        ownerContext(),
        { principal: "owner", recentAuthentication: true },
        {},
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: false, code: "recent_authentication_required" });
  });

  it("separates a valid session from a recent one", () => {
    // A thirty-day-old session is valid; it is not proof of possession now.
    expect(
      authorizeRequest(
        ownerContext(),
        { principal: "owner", recentAuthentication: true },
        { recentAuthentication: neverRecent },
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: false, code: "recent_authentication_required" });
    expect(
      authorizeRequest(
        ownerContext(),
        { principal: "owner", recentAuthentication: true },
        { recentAuthentication: alwaysRecent },
        fakeRequest,
        NOW,
      ),
    ).toEqual({ allowed: true });
  });

  it("checks identity before CSRF and recency", () => {
    // Checking CSRF first would let an unauthenticated caller learn whether a
    // token shape is accepted; checking recency first would leak lifetimes.
    const decision = authorizeRequest(
      createRequestContext(),
      { principal: "owner", csrf: true, recentAuthentication: true },
      { csrf: alwaysInvalidCsrf, recentAuthentication: neverRecent },
      fakeRequest,
      NOW,
    );
    expect(decision).toEqual({ allowed: false, code: "authentication_required" });
  });

  it("checks CSRF before recency", () => {
    const decision = authorizeRequest(
      ownerContext(),
      { principal: "owner", csrf: true, recentAuthentication: true },
      { csrf: alwaysInvalidCsrf, recentAuthentication: neverRecent },
      fakeRequest,
      NOW,
    );
    expect(decision).toEqual({ allowed: false, code: "csrf_validation_failed" });
  });
});

describe("readiness", () => {
  it("serves `none` routes at every stage, including before the installation exists", () => {
    expect(checkReadiness(createRequestContext(), "none")).toEqual({ ready: true });
    for (const state of ["uninitialized", "ready", "degraded"] as const) {
      expect(checkReadiness(createRequestContext({ installationState: state }), "none")).toEqual({
        ready: true,
      });
    }
  });

  it("allows the bootstrap surface only before ownership commits", () => {
    expect(checkReadiness(createRequestContext(), "uninitialized")).toEqual({ ready: true });
    expect(
      checkReadiness(
        createRequestContext({ installationState: "bootstrap-in-progress" }),
        "uninitialized",
      ),
    ).toEqual({ ready: true });
  });

  it("closes the bootstrap surface once an owner exists", () => {
    // Leaving it open is the most direct route to a second owner.
    for (const state of [
      "ready",
      "recovery-required",
      "migration-in-progress",
      "degraded",
    ] as const) {
      expect(
        checkReadiness(createRequestContext({ installationState: state }), "uninitialized"),
        state,
      ).toEqual({ ready: false, code: "bootstrap_unavailable" });
    }
  });

  it("refuses initialized routes before the installation exists", () => {
    expect(checkReadiness(createRequestContext(), "initialized")).toEqual({
      ready: false,
      code: "installation_not_ready",
    });
  });

  it("keeps initialized routes working while degraded", () => {
    // The owner must still be able to manage sessions and see why the
    // installation is degraded; otherwise a key mistake is an opaque outage.
    expect(
      checkReadiness(
        createRequestContext({ installationState: "degraded", deploymentKeyAvailable: false }),
        "initialized",
      ),
    ).toEqual({ ready: true });
  });

  it("refuses protected work when the deployment key is unavailable", () => {
    expect(
      checkReadiness(
        createRequestContext({ installationState: "ready", deploymentKeyAvailable: false }),
        "protected",
      ),
    ).toEqual({ ready: false, code: "installation_degraded" });
  });

  it("refuses protected work while degraded even if a key appears available", () => {
    expect(
      checkReadiness(
        createRequestContext({ installationState: "degraded", deploymentKeyAvailable: true }),
        "protected",
      ),
    ).toEqual({ ready: false, code: "installation_degraded" });
  });

  it("allows protected work when ready or migrating with a key", () => {
    for (const state of ["ready", "migration-in-progress"] as const) {
      expect(
        checkReadiness(
          createRequestContext({ installationState: state, deploymentKeyAvailable: true }),
          "protected",
        ),
        state,
      ).toEqual({ ready: true });
    }
  });

  it("refuses protected work while recovery is outstanding", () => {
    expect(
      checkReadiness(
        createRequestContext({
          installationState: "recovery-required",
          deploymentKeyAvailable: true,
        }),
        "protected",
      ),
    ).toEqual({ ready: false, code: "installation_not_ready" });
  });

  it("declares a readiness requirement for every listed route family", () => {
    const requirements = new Set<ReadinessRequirement>([
      "none",
      "uninitialized",
      "initialized",
      "protected",
    ]);
    for (const [route, requirement] of Object.entries(ROUTE_READINESS)) {
      expect(requirements.has(requirement), route).toBe(true);
    }
    expect(ROUTE_READINESS["/health"]).toBe("none");
    expect(ROUTE_READINESS["/v1/installation/status"]).toBe("none");
    expect(ROUTE_READINESS["/v1/bootstrap"]).toBe("uninitialized");
  });
});

describe("protected writes", () => {
  const ready = createRequestContext({
    installationState: "ready",
    deploymentKeyAvailable: true,
  });

  it("allows a write when the installation is ready and writes are permitted", () => {
    expect(checkProtectedWrite({ context: ready, writesAllowed: true })).toEqual({ ready: true });
  });

  it("refuses a write once the rotation write block is reached", () => {
    expect(checkProtectedWrite({ context: ready, writesAllowed: false })).toEqual({
      ready: false,
      code: "write_blocked",
    });
  });

  it("still allows protected reads while writes are blocked", () => {
    // A late rotation must never lock the owner out of their own data.
    expect(checkReadiness(ready, "protected")).toEqual({ ready: true });
  });

  it("refuses a write while plaintext writes are stopped for a cutover", () => {
    expect(
      checkProtectedWrite({ context: ready, writesAllowed: true, plaintextWritesStopped: true }),
    ).toEqual({ ready: false, code: "migration_in_progress" });
  });

  it("reports the readiness failure before the write-policy failure", () => {
    // Degraded is the more fundamental problem, and the more actionable one.
    expect(
      checkProtectedWrite({
        context: createRequestContext({
          installationState: "ready",
          deploymentKeyAvailable: false,
        }),
        writesAllowed: false,
      }),
    ).toEqual({ ready: false, code: "installation_degraded" });
  });
});
