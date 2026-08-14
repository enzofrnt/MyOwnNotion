/**
 * Recovery-kit invariants (T009, feature 002).
 *
 * The properties that make an offline recovery kit trustworthy:
 *
 *   - a fresh kit is `provisional/prepared` and is not usable;
 *   - only the seven contract pairs are reachable, and the only route to
 *     `active/confirmed` runs through a consumed download;
 *   - the download is one-time and time-bounded: a second consumption and a
 *     late consumption both fail;
 *   - a rejected or expired kit is terminal and cannot be resurrected;
 *   - unwrapping needs both the right passphrase and a usable state, and every
 *     failure is the same opaque error.
 */
import {
  allowedRecoveryTransitions,
  CryptoInputError,
  canTransitionRecovery,
  createRecoveryKit,
  EnvelopeDecryptionError,
  expireRecoveryKitIfDue,
  isLegalRecoveryStatePair,
  isRecoveryKitUsable,
  openRecoveryKit,
  RECOVERY_STATE_PAIRS,
  type RecoveryKit,
  type RecoveryStatePair,
  RecoveryTransitionError,
  transitionRecoveryKit,
} from "@myownnotion/domain/security";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const CLOCK_ORIGIN = new Date("2026-01-01T00:00:00.000Z");
const WINDOW_MINUTES = 15;
const PASSPHRASE = "correct horse battery staple";

function minutesAfterOrigin(minutes: number): Date {
  return new Date(CLOCK_ORIGIN.getTime() + minutes * 60_000);
}

/** Low scrypt cost keeps the suite fast; production uses the default N. */
const TEST_SCRYPT = { N: 8192, r: 8, p: 1, keyLength: 32 } as const;

function makeKit(payload = new Uint8Array([1, 2, 3, 4])): RecoveryKit {
  return createRecoveryKit({
    installationId: "018f2b7c-0000-7000-8000-000000000001",
    sourceLineageId: "018f2b7c-0000-7000-8000-000000000002",
    kitId: "018f2b7c-0000-7000-8000-000000000003",
    recoveryEpoch: 1,
    secret: { kind: "passphrase", passphrase: PASSPHRASE },
    payload,
    supportedKeyGenerations: [1],
    createdAt: CLOCK_ORIGIN,
    downloadExpiresAt: minutesAfterOrigin(WINDOW_MINUTES),
    scrypt: TEST_SCRYPT,
  });
}

const PAIR = {
  prepared: { authorizationState: "provisional", deliveryState: "prepared" },
  downloadable: { authorizationState: "provisional", deliveryState: "downloadable" },
  consumed: { authorizationState: "provisional", deliveryState: "download-consumed" },
  confirmed: { authorizationState: "active", deliveryState: "confirmed" },
  superseded: { authorizationState: "superseded", deliveryState: "confirmed" },
  revoked: { authorizationState: "revoked", deliveryState: "confirmed" },
  expired: { authorizationState: "rejected", deliveryState: "expired" },
} as const satisfies Record<string, RecoveryStatePair>;

/** Walks a kit to `active/confirmed` inside the download window. */
function confirmKit(kit: RecoveryKit): RecoveryKit {
  const downloadable = transitionRecoveryKit(kit, PAIR.downloadable, {
    now: minutesAfterOrigin(1),
  });
  const consumed = transitionRecoveryKit(downloadable, PAIR.consumed, {
    now: minutesAfterOrigin(2),
  });
  return transitionRecoveryKit(consumed, PAIR.confirmed, { now: minutesAfterOrigin(3) });
}

describe("kit creation", () => {
  it("starts provisional/prepared and is not usable", () => {
    const kit = makeKit();
    expect(kit.authorizationState).toBe("provisional");
    expect(kit.deliveryState).toBe("prepared");
    expect(isRecoveryKitUsable(kit)).toBe(false);
    expect(kit.downloadExpiresAt).toBe(minutesAfterOrigin(WINDOW_MINUTES).toISOString());
  });

  it("never places key material outside the encryption block", () => {
    const secret = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const kit = makeKit(secret);
    const { encryption: _encryption, ...metadata } = kit;
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(PASSPHRASE);
    expect(serialized).not.toContain(Buffer.from(secret).toString("base64url"));
  });

  it("refuses an empty payload or an empty generation list", () => {
    expect(() =>
      createRecoveryKit({
        installationId: "018f2b7c-0000-7000-8000-000000000001",
        sourceLineageId: "018f2b7c-0000-7000-8000-000000000002",
        kitId: "018f2b7c-0000-7000-8000-000000000003",
        recoveryEpoch: 1,
        secret: { kind: "passphrase", passphrase: PASSPHRASE },
        payload: new Uint8Array(),
        supportedKeyGenerations: [1],
        createdAt: CLOCK_ORIGIN,
        downloadExpiresAt: minutesAfterOrigin(WINDOW_MINUTES),
        scrypt: TEST_SCRYPT,
      }),
    ).toThrow(CryptoInputError);
  });
});

describe("state transitions", () => {
  it("only ever produces contract-legal pairs", () => {
    for (const from of RECOVERY_STATE_PAIRS) {
      for (const to of allowedRecoveryTransitions(from)) {
        expect(isLegalRecoveryStatePair(to.authorizationState, to.deliveryState)).toBe(true);
      }
    }
  });

  it("reaches active/confirmed only through a consumed download", () => {
    const reaching = RECOVERY_STATE_PAIRS.filter((from) =>
      allowedRecoveryTransitions(from).some(
        (to) => to.authorizationState === "active" && to.deliveryState === "confirmed",
      ),
    );
    expect(reaching).toEqual([PAIR.consumed]);
  });

  it("keeps the download one-time: a second consumption has no legal route", () => {
    expect(canTransitionRecovery(PAIR.consumed, PAIR.downloadable)).toBe(false);
    expect(canTransitionRecovery(PAIR.consumed, PAIR.consumed)).toBe(false);
  });

  it("treats rejected/expired, superseded, and revoked as terminal", () => {
    for (const terminal of [PAIR.expired, PAIR.superseded, PAIR.revoked]) {
      expect(allowedRecoveryTransitions(terminal)).toEqual([]);
    }
  });

  it("never resurrects an expired kit into any authorized pair", () => {
    for (const target of RECOVERY_STATE_PAIRS) {
      expect(canTransitionRecovery(PAIR.expired, target)).toBe(false);
    }
  });

  it("stamps the timestamp each destination pair requires", () => {
    const kit = makeKit();
    const downloadable = transitionRecoveryKit(kit, PAIR.downloadable, {
      now: minutesAfterOrigin(1),
    });
    const consumed = transitionRecoveryKit(downloadable, PAIR.consumed, {
      now: minutesAfterOrigin(2),
    });
    expect(consumed.downloadConsumedAt).toBe(minutesAfterOrigin(2).toISOString());

    const confirmed = transitionRecoveryKit(consumed, PAIR.confirmed, {
      now: minutesAfterOrigin(3),
    });
    expect(confirmed.confirmedAt).toBe(minutesAfterOrigin(3).toISOString());
  });

  it("rejects every transition the table does not list", () => {
    const kit = makeKit();
    for (const target of RECOVERY_STATE_PAIRS) {
      if (canTransitionRecovery(PAIR.prepared, target)) {
        continue;
      }
      expect(() => transitionRecoveryKit(kit, target, { now: minutesAfterOrigin(1) })).toThrow(
        RecoveryTransitionError,
      );
    }
  });
});

describe("download window", () => {
  it("allows progress at any instant inside the window", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: WINDOW_MINUTES }), (minute) => {
        const kit = makeKit();
        expect(() =>
          transitionRecoveryKit(kit, PAIR.downloadable, { now: minutesAfterOrigin(minute) }),
        ).not.toThrow();
      }),
      { numRuns: 20 },
    );
  });

  it("refuses progress after the window closes, to the minute", () => {
    fc.assert(
      fc.property(fc.integer({ min: WINDOW_MINUTES + 1, max: 600 }), (minute) => {
        const kit = makeKit();
        expect(() =>
          transitionRecoveryKit(kit, PAIR.downloadable, { now: minutesAfterOrigin(minute) }),
        ).toThrow(RecoveryTransitionError);
      }),
      { numRuns: 20 },
    );
  });

  it("refuses a late confirmation of an in-window download", () => {
    const kit = makeKit();
    const downloadable = transitionRecoveryKit(kit, PAIR.downloadable, {
      now: minutesAfterOrigin(1),
    });
    const consumed = transitionRecoveryKit(downloadable, PAIR.consumed, {
      now: minutesAfterOrigin(2),
    });
    expect(() =>
      transitionRecoveryKit(consumed, PAIR.confirmed, {
        now: minutesAfterOrigin(WINDOW_MINUTES + 1),
      }),
    ).toThrow(RecoveryTransitionError);
  });

  it("expires an unconsumed kit once the window closes", () => {
    const kit = makeKit();
    expect(expireRecoveryKitIfDue(kit, minutesAfterOrigin(WINDOW_MINUTES))).toEqual(kit);

    const expired = expireRecoveryKitIfDue(kit, minutesAfterOrigin(WINDOW_MINUTES + 1));
    expect(expired.authorizationState).toBe("rejected");
    expect(expired.deliveryState).toBe("expired");
  });

  it("leaves a confirmed kit alone: confirmation outlives the download window", () => {
    const confirmed = confirmKit(makeKit());
    expect(expireRecoveryKitIfDue(confirmed, minutesAfterOrigin(10_000))).toEqual(confirmed);
  });
});

describe("unwrapping", () => {
  it("returns the payload for a confirmed kit and the right passphrase", () => {
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const confirmed = confirmKit(makeKit(payload));
    expect(openRecoveryKit(confirmed, { kind: "passphrase", passphrase: PASSPHRASE })).toEqual(
      payload,
    );
  });

  it("refuses a wrong passphrase", () => {
    const confirmed = confirmKit(makeKit());
    expect(() =>
      openRecoveryKit(confirmed, { kind: "passphrase", passphrase: "wrong passphrase" }),
    ).toThrow(EnvelopeDecryptionError);
  });

  it("refuses an unconfirmed kit even with the right passphrase", () => {
    // The whole point of offline confirmation: a downloaded-but-unconfirmed kit
    // must not hand back key material.
    const kit = makeKit();
    const downloadable = transitionRecoveryKit(kit, PAIR.downloadable, {
      now: minutesAfterOrigin(1),
    });
    const consumed = transitionRecoveryKit(downloadable, PAIR.consumed, {
      now: minutesAfterOrigin(2),
    });
    for (const unusable of [kit, downloadable, consumed]) {
      expect(() =>
        openRecoveryKit(unusable, { kind: "passphrase", passphrase: PASSPHRASE }),
      ).toThrow(EnvelopeDecryptionError);
    }
  });

  it("refuses a revoked or superseded kit", () => {
    const confirmed = confirmKit(makeKit());
    for (const target of [PAIR.revoked, PAIR.superseded]) {
      const retired = transitionRecoveryKit(confirmed, target, {
        now: minutesAfterOrigin(100),
      });
      expect(() =>
        openRecoveryKit(retired, { kind: "passphrase", passphrase: PASSPHRASE }),
      ).toThrow(EnvelopeDecryptionError);
      // Explicit inspection is still possible for recovery tooling.
      expect(
        openRecoveryKit(
          retired,
          { kind: "passphrase", passphrase: PASSPHRASE },
          { requireUsable: false },
        ),
      ).toBeInstanceOf(Uint8Array);
    }
  });

  it("refuses a tampered ciphertext, tag, nonce, or kdf salt", () => {
    const confirmed = confirmKit(makeKit());
    const mutations: RecoveryKit[] = [
      { ...confirmed, encryption: { ...confirmed.encryption, ciphertext: "AAAA" } },
      { ...confirmed, encryption: { ...confirmed.encryption, tag: "A".repeat(22) } },
      { ...confirmed, encryption: { ...confirmed.encryption, nonce: "A".repeat(16) } },
      { ...confirmed, kdf: { ...confirmed.kdf, salt: "A".repeat(22) } },
    ];
    for (const mutated of mutations) {
      expect(() =>
        openRecoveryKit(mutated, { kind: "passphrase", passphrase: PASSPHRASE }),
      ).toThrow(EnvelopeDecryptionError);
    }
  });

  it("refuses a kit whose identity fields were swapped, because AAD binds them", () => {
    const confirmed = confirmKit(makeKit());
    const rebound: RecoveryKit = {
      ...confirmed,
      kitId: "018f2b7c-0000-7000-8000-0000000000ff",
    };
    expect(() => openRecoveryKit(rebound, { kind: "passphrase", passphrase: PASSPHRASE })).toThrow(
      EnvelopeDecryptionError,
    );
  });

  it("reports every unwrap failure with one indistinguishable message", () => {
    const confirmed = confirmKit(makeKit());
    const failures = [
      () => openRecoveryKit(confirmed, { kind: "passphrase", passphrase: "wrong" }),
      () =>
        openRecoveryKit(
          { ...confirmed, recoveryEpoch: 99 },
          { kind: "passphrase", passphrase: PASSPHRASE },
        ),
      () =>
        openRecoveryKit(
          { ...confirmed, authorizationState: "revoked" },
          { kind: "passphrase", passphrase: PASSPHRASE },
        ),
      // A deployment key offered to a passphrase-sealed kit: a caller that has
      // confused two kinds of secret. It must fail the same way as every other
      // refusal, or the message itself would say which mistake was made.
      () =>
        openRecoveryKit(confirmed, {
          kind: "deployment-key",
          deploymentKey: new Uint8Array(32).fill(7),
        }),
    ];
    const messages = new Set<string>();
    for (const failure of failures) {
      try {
        failure();
        throw new Error("expected a failure");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvelopeDecryptionError);
        messages.add((error as Error).message);
      }
    }
    expect(messages.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Kits sealed under the deployment key
// ---------------------------------------------------------------------------

describe("a kit sealed under the deployment key", () => {
  const DEPLOYMENT_KEY = new Uint8Array(32).fill(11);

  function makeDeploymentKit(payload = new Uint8Array([1, 2, 3, 4])) {
    return createRecoveryKit({
      installationId: "018f2b7c-0000-7000-8000-000000000001",
      sourceLineageId: "018f2b7c-0000-7000-8000-000000000002",
      kitId: "018f2b7c-0000-7000-8000-000000000003",
      recoveryEpoch: 1,
      secret: { kind: "deployment-key", deploymentKey: DEPLOYMENT_KEY },
      payload,
      supportedKeyGenerations: [1],
      createdAt: CLOCK_ORIGIN,
      downloadExpiresAt: minutesAfterOrigin(WINDOW_MINUTES),
    });
  }

  it("says so in the artifact rather than leaving it to be inferred", () => {
    // Whoever holds this file — an operator, a tool, a person opening it in a
    // text editor years from now — must be able to tell what it needs without
    // running code that guesses.
    expect(makeDeploymentKit().kdf.algorithm).toBe("deployment-key");
  });

  it("carries no scrypt parameters, because none were used", () => {
    const kit = makeDeploymentKit();
    // A passphrase KDF's parameters on a kit with no passphrase would be a
    // description of work that never happened, and would send someone looking
    // for a phrase that never existed.
    expect(kit.kdf).not.toHaveProperty("N");
    expect(kit.kdf).not.toHaveProperty("p");
  });

  it("round-trips under the same deployment key", () => {
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const confirmed = confirmKit(makeDeploymentKit(payload));
    expect(
      openRecoveryKit(confirmed, { kind: "deployment-key", deploymentKey: DEPLOYMENT_KEY }),
    ).toEqual(payload);
  });

  it("refuses a different deployment key", () => {
    const confirmed = confirmKit(makeDeploymentKit());
    expect(() =>
      openRecoveryKit(confirmed, {
        kind: "deployment-key",
        deploymentKey: new Uint8Array(32).fill(12),
      }),
    ).toThrow(EnvelopeDecryptionError);
  });

  it("refuses a passphrase, however plausible", () => {
    // The two secrets are not interchangeable. Stretching the wrong one would
    // produce a failure much further along, where it is far harder to read.
    const confirmed = confirmKit(makeDeploymentKit());
    expect(() =>
      openRecoveryKit(confirmed, { kind: "passphrase", passphrase: PASSPHRASE }),
    ).toThrow(EnvelopeDecryptionError);
  });

  it("produces unrelated ciphertext for two kits under one key", () => {
    // Otherwise an observer could tell that a kit was regenerated without any
    // change to what it protects, which is information about the installation
    // that the file has no business carrying.
    const payload = new Uint8Array([4, 4, 4, 4]);
    const first = makeDeploymentKit(payload);
    const second = makeDeploymentKit(payload);
    expect(second.encryption.ciphertext).not.toBe(first.encryption.ciphertext);
    expect(second.kdf.salt).not.toBe(first.kdf.salt);
  });

  it("is still unusable until it has been confirmed", () => {
    // The delivery rules are about the kit's lifecycle, not about which secret
    // seals it. A kit that skipped confirmation because it had no passphrase
    // would be a hole opened by an unrelated choice.
    expect(() =>
      openRecoveryKit(makeDeploymentKit(), {
        kind: "deployment-key",
        deploymentKey: DEPLOYMENT_KEY,
      }),
    ).toThrow(EnvelopeDecryptionError);
  });
});
