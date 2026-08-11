/**
 * Bootstrap state-machine invariants (T025, feature 002).
 *
 * The single property everything else depends on: **no state before
 * `confirmed` constitutes ownership.** Records exist, credentials are
 * verified, a kit is prepared — and the installation still reports `0/0`.
 * Every test below is a way that could stop being true:
 *
 *   - a path to `confirmed` that skips the consumed download;
 *   - a second download consumption;
 *   - a download or confirmation that lands after the 15-minute window;
 *   - a regenerated kit that revives the one it replaced;
 *   - a capability replayed against a different attempt;
 *   - an interrupted attempt that leaves something usable behind.
 */

import {
  abandonAttempt,
  allowedBootstrapTransitions,
  BOOTSTRAP_KIT_WINDOW_MINUTES,
  BOOTSTRAP_STATES,
  type BootstrapAttempt,
  BootstrapCapabilityError,
  type BootstrapState,
  BootstrapTransitionError,
  canTransitionBootstrap,
  confirmOfflineStorage,
  consumeDownload,
  countsForBootstrapState,
  downloadWindowEnd,
  expireAttemptIfDue,
  isDownloadWindowOpen,
  isOpenBootstrapState,
  isTerminalBootstrapState,
  prepareRecovery,
  readinessSatisfied,
  recordCredentialVerified,
  regenerationSupersedes,
  rejectAttempt,
  startAttempt,
  verifyAttemptCapability,
} from "@myownnotion/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const ATTEMPT_ID = "018f2b7c-0000-7000-8000-000000000001";
const INSTALLATION_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KIT_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const CAPABILITY_HASH = "capability-digest";
const TOKEN_HASH = "download-token-digest";

function at(minutes: number): Date {
  return new Date(ORIGIN.getTime() + minutes * 60_000);
}

/** Naive equality stands in for the constant-time comparison the API injects. */
const compare = (left: string, right: string) => left === right;

function fresh(): BootstrapAttempt {
  return startAttempt({
    attemptId: ATTEMPT_ID,
    installationId: INSTALLATION_ID,
    capabilityHash: CAPABILITY_HASH,
    clientNonceHash: "nonce-digest",
    now: ORIGIN,
  });
}

function verified(): BootstrapAttempt {
  return recordCredentialVerified(fresh(), { challengeHash: "challenge", now: at(1) });
}

function prepared(now = at(2)): BootstrapAttempt {
  return prepareRecovery(verified(), { recoveryKitId: KIT_ID, downloadTokenHash: TOKEN_HASH, now });
}

function consumed(now = at(3)): BootstrapAttempt {
  return consumeDownload(prepared(), { downloadTokenHash: TOKEN_HASH, now });
}

describe("committed counts", () => {
  it("reports 0/0 for every state except confirmed", () => {
    for (const state of BOOTSTRAP_STATES) {
      const expected = state === "confirmed" ? 1 : 0;
      expect(countsForBootstrapState(state), state).toEqual({
        ownerCount: expected,
        workspaceCount: expected,
      });
    }
  });

  it("reports 0/0 even for attempts with real durable records", () => {
    // `rejected` and `abandoned` have persisted rows; they are attempt-scoped
    // and never constitute ownership.
    for (const state of ["rejected", "abandoned"] as const) {
      expect(countsForBootstrapState(state), state).toEqual({
        ownerCount: 0,
        workspaceCount: 0,
      });
    }
  });

  it("moves owner and workspace counts together, never one at a time", () => {
    for (const state of BOOTSTRAP_STATES) {
      const counts = countsForBootstrapState(state);
      expect(counts.ownerCount, state).toBe(counts.workspaceCount);
    }
  });
});

describe("transition table", () => {
  it("partitions every state into open or terminal", () => {
    for (const state of BOOTSTRAP_STATES) {
      expect(isOpenBootstrapState(state) !== isTerminalBootstrapState(state), state).toBe(true);
    }
  });

  it("reaches confirmed only from download-consumed", () => {
    // Downloading the kit is not the same as confirming it was stored offline.
    const reaching = BOOTSTRAP_STATES.filter((state) =>
      allowedBootstrapTransitions(state).includes("confirmed"),
    );
    expect(reaching).toEqual(["download-consumed"]);
  });

  it("offers no shortcut from credential verification to confirmation", () => {
    expect(canTransitionBootstrap("credential-verified", "confirmed")).toBe(false);
    expect(canTransitionBootstrap("recovery-prepared", "confirmed")).toBe(false);
    expect(canTransitionBootstrap("started", "confirmed")).toBe(false);
  });

  it("treats every terminal state as terminal", () => {
    for (const terminal of ["confirmed", "abandoned", "rejected"] as const) {
      expect(allowedBootstrapTransitions(terminal), terminal).toEqual([]);
    }
  });

  it("allows abandonment and rejection from any open state", () => {
    for (const state of BOOTSTRAP_STATES.filter(isOpenBootstrapState)) {
      expect(canTransitionBootstrap(state, "abandoned"), state).toBe(true);
      expect(canTransitionBootstrap(state, "rejected"), state).toBe(true);
    }
  });

  it("never moves backwards, except for regeneration", () => {
    const forward: BootstrapState[] = [
      "started",
      "credential-verified",
      "recovery-prepared",
      "download-consumed",
      "confirmed",
    ];
    fc.assert(
      fc.property(fc.constantFrom(...forward), fc.constantFrom(...forward), (from, to) => {
        if (!canTransitionBootstrap(from, to)) {
          return;
        }
        // The only exception is regeneration, which re-enters
        // `recovery-prepared`. It rewinds the *delivery* and nothing else: the
        // verified credential is kept and the superseded kit is rejected
        // rather than revived. Confirmation is never rewound.
        const isRegeneration =
          to === "recovery-prepared" &&
          (from === "recovery-prepared" || from === "download-consumed");
        expect(isRegeneration || forward.indexOf(to) > forward.indexOf(from)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it("allows regeneration after a lost download, so the owner is never stuck", () => {
    // Without this edge, an owner who downloaded the kit and lost it before
    // confirming could neither confirm nor re-download.
    expect(canTransitionBootstrap("download-consumed", "recovery-prepared")).toBe(true);
    // And before any download, when the window simply lapsed.
    expect(canTransitionBootstrap("recovery-prepared", "recovery-prepared")).toBe(true);
    // Regeneration never rewinds past the delivery: the verified credential
    // stands, and confirmation is never undone.
    expect(canTransitionBootstrap("confirmed", "recovery-prepared")).toBe(false);
    expect(canTransitionBootstrap("recovery-prepared", "credential-verified")).toBe(false);
    expect(canTransitionBootstrap("download-consumed", "started")).toBe(false);
  });
});

describe("credential verification", () => {
  it("holds verified material without creating an owner", () => {
    const attempt = verified();
    expect(attempt.state).toBe("credential-verified");
    expect(attempt.credentialVerified).toBe(true);
    expect(countsForBootstrapState(attempt.state)).toEqual({ ownerCount: 0, workspaceCount: 0 });
  });

  it("refuses to prepare a kit without a verified credential", () => {
    expect(() =>
      prepareRecovery(fresh(), {
        recoveryKitId: KIT_ID,
        downloadTokenHash: TOKEN_HASH,
        now: at(1),
      }),
    ).toThrow(BootstrapTransitionError);
  });
});

describe("the one-time 15-minute download", () => {
  it("opens a window of exactly fifteen minutes", () => {
    expect(downloadWindowEnd(ORIGIN).getTime() - ORIGIN.getTime()).toBe(
      BOOTSTRAP_KIT_WINDOW_MINUTES * 60_000,
    );
    expect(prepared(at(2)).downloadExpiresAt).toEqual(at(2 + BOOTSTRAP_KIT_WINDOW_MINUTES));
  });

  it("accepts a consumption at any instant inside the window", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: BOOTSTRAP_KIT_WINDOW_MINUTES }), (offset) => {
        const attempt = prepared(at(2));
        expect(() =>
          consumeDownload(attempt, { downloadTokenHash: TOKEN_HASH, now: at(2 + offset) }),
        ).not.toThrow();
      }),
      { numRuns: 20 },
    );
  });

  it("refuses a consumption after the window closes, to the minute", () => {
    fc.assert(
      fc.property(fc.integer({ min: BOOTSTRAP_KIT_WINDOW_MINUTES + 1, max: 600 }), (offset) => {
        const attempt = prepared(at(2));
        expect(() =>
          consumeDownload(attempt, { downloadTokenHash: TOKEN_HASH, now: at(2 + offset) }),
        ).toThrow(BootstrapTransitionError);
      }),
      { numRuns: 20 },
    );
  });

  it("refuses a second consumption", () => {
    const once = consumed();
    expect(() => consumeDownload(once, { downloadTokenHash: TOKEN_HASH, now: at(4) })).toThrow(
      BootstrapTransitionError,
    );
  });

  it("refuses a download token from another attempt", () => {
    expect(() =>
      consumeDownload(prepared(), { downloadTokenHash: "someone-elses-token", now: at(3) }),
    ).toThrow(BootstrapTransitionError);
  });

  it("records when the download was consumed", () => {
    expect(consumed(at(5)).downloadConsumedAt).toEqual(at(5));
  });
});

describe("offline confirmation", () => {
  it("promotes to confirmed and 1/1 only after a consumed download", () => {
    const confirmed = confirmOfflineStorage(consumed(), { now: at(4) });
    expect(confirmed.state).toBe("confirmed");
    expect(countsForBootstrapState(confirmed.state)).toEqual({ ownerCount: 1, workspaceCount: 1 });
  });

  it("refuses confirmation without a consumed download", () => {
    // The whole point: an owner must not reach `ready` with a kit they never
    // saved.
    expect(() => confirmOfflineStorage(prepared(), { now: at(3) })).toThrow(
      BootstrapTransitionError,
    );
  });

  it("refuses confirmation after the window closed", () => {
    const attempt = consumed(at(3));
    expect(() =>
      confirmOfflineStorage(attempt, { now: at(2 + BOOTSTRAP_KIT_WINDOW_MINUTES + 1) }),
    ).toThrow(BootstrapTransitionError);
  });

  it("requires the confirmed kit for readiness, not just an owner", () => {
    // An installation with an owner and no confirmed offline recovery is one
    // lost device away from unrecoverable.
    expect(
      readinessSatisfied({
        bootstrapState: "confirmed",
        recoveryAuthorizationState: "active",
        recoveryDeliveryState: "confirmed",
      }),
    ).toBe(true);
    expect(
      readinessSatisfied({
        bootstrapState: "confirmed",
        recoveryAuthorizationState: "provisional",
        recoveryDeliveryState: "download-consumed",
      }),
    ).toBe(false);
    expect(
      readinessSatisfied({
        bootstrapState: "download-consumed",
        recoveryAuthorizationState: "active",
        recoveryDeliveryState: "confirmed",
      }),
    ).toBe(false);
  });
});

describe("regeneration", () => {
  it("stays on the same attempt and keeps the same capability", () => {
    const first = prepared(at(2));
    const second = prepareRecovery(first, {
      recoveryKitId: "018f2b7c-0000-7000-8000-0000000000cc",
      downloadTokenHash: "second-token",
      now: at(10),
    });
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.capabilityHash).toBe(first.capabilityHash);
    expect(second.credentialVerified).toBe(true);
  });

  it("opens a fresh window and clears the previous consumption", () => {
    const downloaded = consumed(at(3));
    const regenerated = prepareRecovery(downloaded, {
      recoveryKitId: "018f2b7c-0000-7000-8000-0000000000cc",
      downloadTokenHash: "second-token",
      now: at(10),
    });
    // A regenerated kit has never been downloaded, whatever the previous did.
    expect(regenerated.downloadConsumedAt).toBeNull();
    expect(regenerated.downloadExpiresAt).toEqual(at(10 + BOOTSTRAP_KIT_WINDOW_MINUTES));
  });

  it("rejects and expires the kit it replaces, without reviving it", () => {
    const superseded = regenerationSupersedes(prepared());
    expect(superseded.previousKitId).toBe(KIT_ID);
    expect(superseded.previousAuthorizationState).toBe("rejected");
    expect(superseded.previousDeliveryState).toBe("expired");
  });

  it("refuses regeneration once the attempt is terminal", () => {
    const rejected = rejectAttempt(prepared(), at(4));
    expect(() =>
      prepareRecovery(rejected, {
        recoveryKitId: KIT_ID,
        downloadTokenHash: "third-token",
        now: at(5),
      }),
    ).toThrow(BootstrapTransitionError);
  });
});

describe("capability verification", () => {
  it("accepts the matching attempt and capability", () => {
    expect(() =>
      verifyAttemptCapability(
        prepared(),
        { attemptId: ATTEMPT_ID, capabilityHash: CAPABILITY_HASH },
        compare,
      ),
    ).not.toThrow();
  });

  it("refuses a capability replayed against a different attempt", () => {
    expect(() =>
      verifyAttemptCapability(
        prepared(),
        { attemptId: "018f2b7c-0000-7000-8000-0000000000ff", capabilityHash: CAPABILITY_HASH },
        compare,
      ),
    ).toThrow(BootstrapCapabilityError);
  });

  it("refuses a wrong capability on the right attempt", () => {
    expect(() =>
      verifyAttemptCapability(
        prepared(),
        { attemptId: ATTEMPT_ID, capabilityHash: "forged" },
        compare,
      ),
    ).toThrow(BootstrapCapabilityError);
  });

  it("refuses any capability once the attempt is terminal", () => {
    for (const terminal of [
      abandonAttempt(prepared(), at(4)),
      rejectAttempt(prepared(), at(4)),
      confirmOfflineStorage(consumed(), at(4) && { now: at(4) }),
    ]) {
      expect(
        () =>
          verifyAttemptCapability(
            terminal,
            { attemptId: ATTEMPT_ID, capabilityHash: CAPABILITY_HASH },
            compare,
          ),
        terminal.state,
      ).toThrow(BootstrapCapabilityError);
    }
  });
});

describe("interruption and expiry", () => {
  it("expires an unconsumed attempt once its window closes", () => {
    const attempt = prepared(at(2));
    expect(expireAttemptIfDue(attempt, at(2 + BOOTSTRAP_KIT_WINDOW_MINUTES))).toEqual(attempt);
    const expired = expireAttemptIfDue(attempt, at(2 + BOOTSTRAP_KIT_WINDOW_MINUTES + 1));
    expect(expired.state).toBe("rejected");
  });

  it("never expires a confirmed attempt", () => {
    // Confirmation outlives the delivery window; only the delivery does not.
    const confirmed = confirmOfflineStorage(consumed(), { now: at(4) });
    expect(expireAttemptIfDue(confirmed, at(10_000))).toEqual(confirmed);
  });

  it("leaves an attempt with no window untouched", () => {
    const attempt = verified();
    expect(attempt.downloadExpiresAt).toBeNull();
    expect(expireAttemptIfDue(attempt, at(10_000))).toEqual(attempt);
  });

  it("leaves 0/0 behind whatever the interruption", () => {
    for (const attempt of [
      fresh(),
      verified(),
      prepared(),
      consumed(),
      abandonAttempt(prepared(), at(4)),
      rejectAttempt(prepared(), at(4)),
      expireAttemptIfDue(prepared(at(2)), at(100)),
    ]) {
      expect(countsForBootstrapState(attempt.state), attempt.state).toEqual({
        ownerCount: 0,
        workspaceCount: 0,
      });
    }
  });

  it("keeps the window closed check on the transition, not the read", () => {
    // Reading a stale attempt is fine; acting on it late is not.
    const attempt = prepared(at(2));
    expect(isDownloadWindowOpen(attempt, at(3))).toBe(true);
    expect(isDownloadWindowOpen(attempt, at(100))).toBe(false);
  });
});
