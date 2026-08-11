/**
 * Security rate limiting (T034, feature 002).
 *
 * Bootstrap and authentication are the two surfaces where an attacker gets
 * unlimited free attempts unless something stops them. This is that something.
 *
 * Three properties shape the design:
 *
 *   - **Buckets are keyed on a hashed subject.** A raw credential ID or IP in
 *     the key would put an identifier in a table that outlives the request and
 *     is read during incident review.
 *   - **The window is fixed, not sliding.** A sliding window needs per-attempt
 *     history; a fixed window needs one row. For a single-owner installation
 *     the extra precision buys nothing and the extra rows are a liability.
 *   - **Exceeding the limit blocks for longer than the window.** Otherwise an
 *     attacker simply waits out the window and continues at the limit rate
 *     indefinitely, which is not a limit.
 */

import { createHash } from "node:crypto";
import type { Database } from "@myownnotion/database";
import { securityRateLimits } from "@myownnotion/database";
import { and, eq, sql } from "drizzle-orm";

/**
 * Operation classes, each with its own budget.
 *
 * Bootstrap claims are the tightest: there is exactly one legitimate owner
 * doing this exactly once, so anything beyond a handful of attempts is either
 * a bug or an attack.
 */
export const RATE_LIMIT_POLICIES = {
  "bootstrap.claim": { limit: 5, windowMs: 15 * 60_000, blockMs: 60 * 60_000 },
  "bootstrap.credential": { limit: 10, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  "bootstrap.download": { limit: 5, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  "bootstrap.confirm": { limit: 10, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  "auth.login": { limit: 10, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  "auth.password": { limit: 5, windowMs: 15 * 60_000, blockMs: 60 * 60_000 },
  "recovery.download": { limit: 5, windowMs: 60 * 60_000, blockMs: 60 * 60_000 },
} as const;

export type RateLimitOperation = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Attempts already recorded in the current window, including this one. */
  readonly attempts: number;
  readonly limit: number;
  /** Present when blocked; the instant the block lifts. */
  readonly retryAfter?: Date;
}

/**
 * Bucket key: the operation plus a digest of the subject.
 *
 * Domain-separated so a digest computed elsewhere over the same subject can
 * never collide into a rate-limit bucket, and truncated because its only job
 * is to distinguish subjects.
 */
export function bucketKey(operation: RateLimitOperation, subject: string): string {
  const digest = createHash("sha256")
    .update("mn.rate-limit.v1")
    .update(operation)
    .update(subject)
    .digest("base64url")
    .slice(0, 22);
  return `${operation}:${digest}`;
}

/**
 * Records an attempt and decides whether it may proceed.
 *
 * The whole decision is one upserting statement so two concurrent attempts
 * cannot both read "4 attempts" and both proceed. Reading then writing would
 * make the limit advisory under exactly the concurrency an attacker creates.
 */
export async function consumeRateLimit(
  db: Database,
  input: {
    installationId: string;
    operation: RateLimitOperation;
    subject: string;
    now: Date;
  },
): Promise<RateLimitDecision> {
  const policy = RATE_LIMIT_POLICIES[input.operation];
  const key = bucketKey(input.operation, input.subject);
  const windowStart = new Date(input.now.getTime() - policy.windowMs);

  const result = await db
    .insert(securityRateLimits)
    .values({
      id: crypto.randomUUID(),
      installationId: input.installationId,
      bucketKey: key,
      windowStartedAt: input.now,
      attemptCount: 1,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [securityRateLimits.installationId, securityRateLimits.bucketKey],
      set: {
        // A stale window resets to a single attempt; a live one increments.
        windowStartedAt: sql`CASE WHEN ${securityRateLimits.windowStartedAt} < ${windowStart}
                                  THEN ${input.now}
                                  ELSE ${securityRateLimits.windowStartedAt} END`,
        attemptCount: sql`CASE WHEN ${securityRateLimits.windowStartedAt} < ${windowStart}
                               THEN 1
                               ELSE ${securityRateLimits.attemptCount} + 1 END`,
        updatedAt: input.now,
      },
    })
    .returning();

  const row = result[0];
  if (row === undefined) {
    // Fail closed: an unrecorded attempt is an unlimited attempt.
    return { allowed: false, attempts: 0, limit: policy.limit };
  }

  if (row.blockedUntil !== null && row.blockedUntil.getTime() > input.now.getTime()) {
    return {
      allowed: false,
      attempts: row.attemptCount,
      limit: policy.limit,
      retryAfter: row.blockedUntil,
    };
  }

  if (row.attemptCount > policy.limit) {
    const blockedUntil = new Date(input.now.getTime() + policy.blockMs);
    await db
      .update(securityRateLimits)
      .set({ blockedUntil, updatedAt: input.now })
      .where(
        and(
          eq(securityRateLimits.installationId, input.installationId),
          eq(securityRateLimits.bucketKey, key),
        ),
      );
    return {
      allowed: false,
      attempts: row.attemptCount,
      limit: policy.limit,
      retryAfter: blockedUntil,
    };
  }

  return { allowed: true, attempts: row.attemptCount, limit: policy.limit };
}

/**
 * Clears a bucket after a legitimate success.
 *
 * Called only on success, so a failing attacker never resets their own budget.
 */
export async function clearRateLimit(
  db: Database,
  input: { installationId: string; operation: RateLimitOperation; subject: string },
): Promise<void> {
  await db
    .delete(securityRateLimits)
    .where(
      and(
        eq(securityRateLimits.installationId, input.installationId),
        eq(securityRateLimits.bucketKey, bucketKey(input.operation, input.subject)),
      ),
    );
}
