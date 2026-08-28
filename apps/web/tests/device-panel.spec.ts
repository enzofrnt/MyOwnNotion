/**
 * How the device inventory reads (T071, US3, FR-010).
 *
 * One decision in this panel changes what an owner concludes, so it is tested
 * on its own rather than only through a browser journey: a device the server
 * reported as never used must say so in words. Rendering its authorization
 * date instead would make every device look recently active, hiding the row
 * an owner most needs to see — one authorized long ago and never touched.
 */

import { describe, expect, it } from "vitest";
import {
  describeLastUse,
  describeState,
  REVOKED_NOTICE,
} from "../src/features/security/device-panel.tsx";

describe("a device that has never been used", () => {
  it("says never, rather than borrowing a date", () => {
    expect(describeLastUse(null)).toBe("jamais");
  });

  it("renders a real instant when there is one", () => {
    const rendered = describeLastUse("2026-05-01T12:00:00.000Z");
    expect(rendered).not.toBe("jamais");
    expect(rendered).not.toBe("inconnue");
  });

  it("admits when a timestamp cannot be read", () => {
    // A malformed value is not "never used" — saying so would report a bug as
    // a fact about the device.
    expect(describeLastUse("not-a-date")).toBe("inconnue");
  });
});

describe("device states in the owner's words", () => {
  it("distinguishes revoked from needing to sign in again", () => {
    // The two mean different things: one device is no longer theirs, the other
    // still is. A shared label would make the owner treat them the same.
    expect(describeState("revoked")).toBe("Révoqué");
    expect(describeState("reauthorization-required")).toBe("Nouvelle connexion nécessaire");
  });

  it("names a pending device as unconfirmed rather than active", () => {
    expect(describeState("pending")).toBe("Pas encore confirmé");
  });

  it("calls an active device active", () => {
    expect(describeState("active")).toBe("Actif");
  });
});

describe("what revoking does not do", () => {
  it("says data on an unreachable device cannot be erased remotely", () => {
    // FR-010. Saying only "revoked" would let an owner believe their data was
    // wiped and stop looking for the lost device — the opposite of what the
    // situation calls for.
    expect(REVOKED_NOTICE).toMatch(/ne peuvent pas être effacées à distance/i);
    expect(REVOKED_NOTICE).toMatch(/reconnecte/i);
  });

  it("still says what revoking did achieve", () => {
    // The limitation must not swallow the reassurance: the device really has
    // lost its access from now on.
    expect(REVOKED_NOTICE).toMatch(/ne peut plus accéder/i);
  });
});
