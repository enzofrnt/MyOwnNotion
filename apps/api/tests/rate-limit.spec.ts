/**
 * Security rate limiting (T034, feature 002).
 *
 * A limit that only holds when requests arrive one at a time is not a limit:
 * concurrency is exactly what an attacker produces. These tests therefore race
 * real connections rather than looping sequentially.
 */

import { createInstallation } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bucketKey,
  clearRateLimit,
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
} from "../src/security/rate-limit-service.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const ORIGIN = new Date("2026-01-01T00:00:00.000Z");

function at(minutes: number): Date {
  return new Date(ORIGIN.getTime() + minutes * 60_000);
}

beforeAll(async () => {
  harness = await createApiHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.built.database.db.execute(
    sql`TRUNCATE security_rate_limits, installations CASCADE`,
  );
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

const consume = (
  subject: string,
  now: Date,
  operation: "bootstrap.claim" | "auth.login" = "bootstrap.claim",
) =>
  consumeRateLimit(harness.built.database.db, {
    installationId: INSTALLATION_ID,
    operation,
    subject,
    now,
  });

describe("bucket keys", () => {
  it("never contains the raw subject", () => {
    // The key outlives the request and is read during incident review.
    const key = bucketKey("auth.login", "owner@example.test");
    expect(key).not.toContain("owner@example.test");
    expect(key.startsWith("auth.login:")).toBe(true);
  });

  it("separates subjects and operations", () => {
    expect(bucketKey("auth.login", "a")).not.toBe(bucketKey("auth.login", "b"));
    expect(bucketKey("auth.login", "a")).not.toBe(bucketKey("bootstrap.claim", "a"));
  });

  it("is stable for the same subject", () => {
    expect(bucketKey("auth.login", "a")).toBe(bucketKey("auth.login", "a"));
  });
});

describe("the budget", () => {
  const limit = RATE_LIMIT_POLICIES["bootstrap.claim"].limit;

  it("allows exactly the configured number of attempts", async () => {
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const decision = await consume("client-a", at(attempt));
      expect(decision.allowed, `attempt ${attempt}`).toBe(true);
      expect(decision.attempts).toBe(attempt);
    }
  });

  it("refuses the attempt after the limit and reports when to retry", async () => {
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      await consume("client-a", at(attempt));
    }
    const refused = await consume("client-a", at(limit + 1));
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeInstanceOf(Date);
  });

  it("blocks for longer than the window it exceeded", async () => {
    // Otherwise an attacker waits out the window and continues at the limit
    // rate indefinitely, which is not a limit.
    const policy = RATE_LIMIT_POLICIES["bootstrap.claim"];
    expect(policy.blockMs).toBeGreaterThan(policy.windowMs);

    for (let attempt = 1; attempt <= limit + 1; attempt += 1) {
      await consume("client-a", at(attempt));
    }
    // Well past the window, still inside the block.
    const stillBlocked = await consume("client-a", at(limit + 1 + policy.windowMs / 60_000 + 1));
    expect(stillBlocked.allowed).toBe(false);
  });

  it("keeps separate budgets per subject", async () => {
    for (let attempt = 1; attempt <= limit + 1; attempt += 1) {
      await consume("client-a", at(attempt));
    }
    // A blocked attacker must not deny service to the real owner.
    expect((await consume("client-b", at(1))).allowed).toBe(true);
  });

  it("keeps separate budgets per operation", async () => {
    for (let attempt = 1; attempt <= limit + 1; attempt += 1) {
      await consume("client-a", at(attempt), "bootstrap.claim");
    }
    expect((await consume("client-a", at(1), "auth.login")).allowed).toBe(true);
  });

  it("resets once the window has fully elapsed", async () => {
    const windowMinutes = RATE_LIMIT_POLICIES["bootstrap.claim"].windowMs / 60_000;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      await consume("client-a", at(attempt));
    }
    const afterWindow = await consume("client-a", at(windowMinutes + 10));
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.attempts).toBe(1);
  });
});

describe("concurrency", () => {
  it("counts every concurrent attempt exactly once", async () => {
    // Read-then-write would let several attempts all observe the same count
    // and all proceed — precisely under the concurrency an attacker creates.
    const attempts = 12;
    const decisions = await Promise.all(
      Array.from({ length: attempts }, () => consume("client-a", at(1))),
    );
    const counts = decisions.map((decision) => decision.attempts).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: attempts }, (_, index) => index + 1));
  });

  it("allows no more than the limit even when all attempts race", async () => {
    const limit = RATE_LIMIT_POLICIES["bootstrap.claim"].limit;
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => consume("client-a", at(1))),
    );
    expect(decisions.filter((decision) => decision.allowed).length).toBe(limit);
  });
});

describe("clearing after success", () => {
  it("restores the full budget", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await consume("client-a", at(attempt));
    }
    await clearRateLimit(harness.built.database.db, {
      installationId: INSTALLATION_ID,
      operation: "bootstrap.claim",
      subject: "client-a",
    });
    expect((await consume("client-a", at(4))).attempts).toBe(1);
  });

  it("leaves another subject's budget alone", async () => {
    await consume("client-a", at(1));
    await consume("client-b", at(1));
    await clearRateLimit(harness.built.database.db, {
      installationId: INSTALLATION_ID,
      operation: "bootstrap.claim",
      subject: "client-a",
    });
    // A success by one client must not reset another's budget.
    expect((await consume("client-b", at(2))).attempts).toBe(2);
  });
});
