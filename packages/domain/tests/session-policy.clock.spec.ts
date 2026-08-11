/**
 * Session policy under a controlled clock (T038, feature 002).
 *
 * Session lifetimes are boundaries, and a boundary is the one thing a test
 * that waits can never check. Every instant here is constructed, so "one
 * millisecond before the deadline" and "one millisecond after" are both
 * reachable and both asserted.
 *
 * The properties are chosen for what they would catch if they broke:
 * off-by-one at a deadline, a window measured from the wrong instant, and a
 * revoked session that comes back to life.
 */

import {
  canRenew,
  DEFAULT_RECENT_AUTH_MINUTES,
  DEFAULT_SESSION_INACTIVITY_DAYS,
  evaluateSession,
  inactivityDeadline,
  isRecentlyAuthenticated,
  issueSession,
  MAX_RECENT_AUTH_MINUTES,
  MAX_SESSION_INACTIVITY_DAYS,
  MIN_RECENT_AUTH_MINUTES,
  MIN_SESSION_INACTIVITY_DAYS,
  refreshRecentAuthentication,
  revokeSession,
  SessionPolicyError,
  type SessionRecord,
  sessionPolicy,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const MINUTE = 60_000;

function at(offsetMs: number): Date {
  return new Date(ORIGIN.getTime() + offsetMs);
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ...issueSession(
      {
        sessionId: "018f2b7c-0000-7000-8000-000000000001",
        ownerId: "018f2b7c-0000-7000-8000-0000000000aa",
        deviceId: "018f2b7c-0000-7000-8000-0000000000bb",
        authMethod: "passkey",
        now: ORIGIN,
      },
      sessionPolicy(),
    ),
    ...overrides,
  };
}

describe("the configured range, and what falls outside it", () => {
  it("defaults to 30 days and 15 minutes", () => {
    // The defaults are part of the requirement, not an implementation choice,
    // so they are asserted rather than assumed.
    expect(sessionPolicy()).toEqual({ inactivityDays: 30, recentAuthMinutes: 15 });
    expect(DEFAULT_SESSION_INACTIVITY_DAYS).toBe(30);
    expect(DEFAULT_RECENT_AUTH_MINUTES).toBe(15);
  });

  it("accepts every whole value in range", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_SESSION_INACTIVITY_DAYS, max: MAX_SESSION_INACTIVITY_DAYS }),
        fc.integer({ min: MIN_RECENT_AUTH_MINUTES, max: MAX_RECENT_AUTH_MINUTES }),
        (inactivityDays, recentAuthMinutes) => {
          expect(sessionPolicy({ inactivityDays, recentAuthMinutes })).toEqual({
            inactivityDays,
            recentAuthMinutes,
          });
        },
      ),
      { numRuns: 80 },
    );
  });

  it("refuses a value outside the range rather than clamping it", () => {
    // Clamping would let a deployment ask for a year, receive 90 days, and
    // never learn that the policy it believes it configured is not in force.
    for (const days of [0, -1, MAX_SESSION_INACTIVITY_DAYS + 1, 365]) {
      expect(() => sessionPolicy({ inactivityDays: days }), `${days} days`).toThrow(
        SessionPolicyError,
      );
    }
    for (const minutes of [0, -1, MAX_RECENT_AUTH_MINUTES + 1, 1440]) {
      expect(() => sessionPolicy({ recentAuthMinutes: minutes }), `${minutes} min`).toThrow(
        SessionPolicyError,
      );
    }
  });

  it("refuses a fractional value", () => {
    expect(() => sessionPolicy({ inactivityDays: 1.5 })).toThrow(SessionPolicyError);
    expect(() => sessionPolicy({ recentAuthMinutes: 0.5 })).toThrow(SessionPolicyError);
  });

  it("names the offending value, so a misconfiguration is fixable", () => {
    expect(() => sessionPolicy({ inactivityDays: 365 })).toThrow(/365/);
  });
});

describe("inactivity expiry", () => {
  const policy = sessionPolicy();

  it("is usable one millisecond before the deadline", () => {
    const record = session();
    const evaluated = evaluateSession(record, at(30 * DAY - 1), policy);
    expect(evaluated.usable).toBe(true);
  });

  it("is usable exactly at the deadline", () => {
    // The comparison is strictly greater-than, so the last instant still
    // works. Pinned because flipping it to `>=` is a silent one-off.
    expect(evaluateSession(session(), at(30 * DAY), policy).usable).toBe(true);
  });

  it("has lapsed one millisecond after the deadline", () => {
    const evaluated = evaluateSession(session(), at(30 * DAY + 1), policy);
    expect(evaluated).toEqual({ usable: false, reason: "expired" });
  });

  it("measures from last activity, not from issuance", () => {
    // A session in daily use must not expire on a fixed schedule. This is the
    // difference between a sliding window and a fixed lifetime, and it is
    // invisible unless a test uses the session in between.
    let record = session();
    for (let day = 1; day <= 60; day += 1) {
      const evaluated = evaluateSession(record, at(day * DAY), policy);
      expect(evaluated.usable, `day ${day}`).toBe(true);
      if (evaluated.usable) {
        record = evaluated.session;
      }
    }
    // Sixty days after issuance, still alive — because it was never idle.
    expect(record.expiresAt.getTime()).toBe(at(60 * DAY).getTime() + 30 * DAY);
  });

  it("still lapses when activity stops", () => {
    let record = session();
    const evaluated = evaluateSession(record, at(10 * DAY), policy);
    expect(evaluated.usable).toBe(true);
    if (evaluated.usable) {
      record = evaluated.session;
    }
    // Idle for the full window from that last activity.
    expect(evaluateSession(record, at(40 * DAY + 1), policy)).toEqual({
      usable: false,
      reason: "expired",
    });
  });

  it("honours a shorter configured window", () => {
    const short = sessionPolicy({ inactivityDays: MIN_SESSION_INACTIVITY_DAYS });
    expect(evaluateSession(session(), at(DAY), short).usable).toBe(true);
    expect(evaluateSession(session(), at(DAY + 1), short).usable).toBe(false);
  });

  it("honours a longer configured window", () => {
    const long = sessionPolicy({ inactivityDays: MAX_SESSION_INACTIVITY_DAYS });
    expect(evaluateSession(session(), at(90 * DAY), long).usable).toBe(true);
    expect(evaluateSession(session(), at(90 * DAY + 1), long).usable).toBe(false);
  });

  it("a shortened policy curtails sessions that already exist", () => {
    // Decided here: expiry follows the inactivity period in force, not the
    // `expiresAt` written when the session was issued. An operator who
    // shortens the window because something went wrong needs it to apply to
    // the sessions that are already out there — those are the ones they are
    // worried about. Reading the stored column instead would leave every
    // existing session on its old, longer deadline, and the change would look
    // applied while doing nothing.
    const record = session(); // issued under the 30-day default
    const short = sessionPolicy({ inactivityDays: 1 });
    expect(evaluateSession(record, at(2 * DAY), short)).toEqual({
      usable: false,
      reason: "expired",
    });
    // The stored projection still says 30 days; the decision does not use it.
    expect(record.expiresAt.getTime()).toBe(at(30 * DAY).getTime());
  });

  it("a lengthened policy extends them, symmetrically", () => {
    const record = session();
    const long = sessionPolicy({ inactivityDays: 60 });
    expect(evaluateSession(record, at(45 * DAY), long).usable).toBe(true);
  });

  it("never places a deadline before the activity it follows", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_SESSION_INACTIVITY_DAYS, max: MAX_SESSION_INACTIVITY_DAYS }),
        fc.integer({ min: 0, max: 400 }),
        (inactivityDays, dayOffset) => {
          const lastSeen = at(dayOffset * DAY);
          const deadline = inactivityDeadline(lastSeen, sessionPolicy({ inactivityDays }));
          expect(deadline.getTime()).toBeGreaterThan(lastSeen.getTime());
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("recent authentication", () => {
  const policy = sessionPolicy();

  it("is a shorter clock than the session, by a wide margin", () => {
    // If these ever converge, a month-old session could change the password.
    expect(policy.recentAuthMinutes * MINUTE).toBeLessThan(policy.inactivityDays * DAY);
  });

  it("holds up to and including the boundary", () => {
    expect(isRecentlyAuthenticated(ORIGIN, at(15 * MINUTE - 1), policy)).toBe(true);
    expect(isRecentlyAuthenticated(ORIGIN, at(15 * MINUTE), policy)).toBe(true);
  });

  it("lapses one millisecond later", () => {
    expect(isRecentlyAuthenticated(ORIGIN, at(15 * MINUTE + 1), policy)).toBe(false);
  });

  it("honours the configured bounds", () => {
    const brief = sessionPolicy({ recentAuthMinutes: MIN_RECENT_AUTH_MINUTES });
    expect(isRecentlyAuthenticated(ORIGIN, at(MINUTE), brief)).toBe(true);
    expect(isRecentlyAuthenticated(ORIGIN, at(MINUTE + 1), brief)).toBe(false);

    const generous = sessionPolicy({ recentAuthMinutes: MAX_RECENT_AUTH_MINUTES });
    expect(isRecentlyAuthenticated(ORIGIN, at(60 * MINUTE), generous)).toBe(true);
    expect(isRecentlyAuthenticated(ORIGIN, at(60 * MINUTE + 1), generous)).toBe(false);
  });

  it("refuses a proof dated in the future", () => {
    // A clock that jumped backwards must not read as freshly authenticated.
    // Trusting it would make a sensitive operation available to whoever can
    // nudge the clock.
    expect(isRecentlyAuthenticated(at(MINUTE), ORIGIN, policy)).toBe(false);
  });

  it("does not slide with ordinary session activity", () => {
    // Using the session must not count as proving possession. This is the
    // property that keeps a long-lived session from becoming a standing
    // authorization for sensitive operations.
    let record = session();
    for (let minute = 1; minute <= 60; minute += 1) {
      const evaluated = evaluateSession(record, at(minute * MINUTE), policy);
      if (evaluated.usable) {
        record = evaluated.session;
      }
    }
    expect(record.recentAuthAt.getTime()).toBe(ORIGIN.getTime());
    expect(isRecentlyAuthenticated(record.recentAuthAt, at(60 * MINUTE), policy)).toBe(false);
  });

  it("slides only on a fresh proof, and leaves the session window alone", () => {
    const record = session();
    const refreshed = refreshRecentAuthentication(record, at(20 * MINUTE));
    expect(isRecentlyAuthenticated(refreshed.recentAuthAt, at(20 * MINUTE), policy)).toBe(true);
    // The session's own deadline is untouched: the two clocks are independent.
    expect(refreshed.expiresAt.getTime()).toBe(record.expiresAt.getTime());
  });
});

describe("revocation", () => {
  const policy = sessionPolicy();

  it("takes effect immediately, inside the window", () => {
    const revoked = revokeSession(session(), at(MINUTE));
    expect(evaluateSession(revoked, at(2 * MINUTE), policy)).toEqual({
      usable: false,
      reason: "revoked",
    });
  });

  it("reports revoked rather than expired when both are true", () => {
    // The owner needs to see that their decision took effect, not a generic
    // timeout that says nothing about why.
    const revoked = revokeSession(session(), at(MINUTE));
    expect(evaluateSession(revoked, at(100 * DAY), policy)).toEqual({
      usable: false,
      reason: "revoked",
    });
  });

  it("cannot be undone by activity", () => {
    const revoked = revokeSession(session(), at(MINUTE));
    for (const offset of [2 * MINUTE, DAY, 10 * DAY]) {
      expect(evaluateSession(revoked, at(offset), policy).usable, `${offset}`).toBe(false);
    }
  });

  it("keeps the instant the owner's decision took effect", () => {
    // Re-revoking must not move the timestamp: the audit trail refers to when
    // the decision was made, not to the last time someone repeated it.
    const first = revokeSession(session(), at(MINUTE));
    const again = revokeSession(first, at(DAY));
    expect(again.revokedAt?.getTime()).toBe(at(MINUTE).getTime());
  });

  it("denies renewal to anything that cannot authorize a request", () => {
    // Renewal is not a separate power. If these ever disagree, a revoked or
    // lapsed session gains a way to extend itself.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), (dayOffset) => {
        const now = at(dayOffset * DAY);
        for (const record of [session(), revokeSession(session(), at(MINUTE))]) {
          expect(canRenew(record, now, policy)).toBe(evaluateSession(record, now, policy).usable);
        }
      }),
      { numRuns: 60 },
    );
  });
});
