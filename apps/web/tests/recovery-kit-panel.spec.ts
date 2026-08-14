/**
 * What the recovery-kit panel promises (T081, T088, US5, FR-016, SC-008).
 *
 * This installation seals its kit under the deployment key on the host. That
 * choice removes the passphrase an owner would otherwise have to transcribe
 * and never lose, and it introduces one thing they could not possibly guess:
 *
 * **The kit alone restores nothing.**
 *
 * An owner who is not told that stores the file carefully, decommissions the
 * old machine along with its key, and finds the gap at the only moment it
 * cannot be fixed. The wording is therefore asserted rather than reviewed —
 * it is the difference between a backup and the belief in one.
 */

import { describe, expect, it } from "vitest";
import { DEPLOYMENT_KEY_REQUIREMENT } from "../src/features/security/recovery-kit-panel.tsx";

describe("what the owner is told to keep", () => {
  it("names the deployment key, not just the kit", () => {
    expect(DEPLOYMENT_KEY_REQUIREMENT).toMatch(/deployment key/i);
  });

  it("says the kit alone is not enough", () => {
    // The sentence that stops an owner concluding the file is a complete
    // backup. Without it the panel is accurate about the file and wrong about
    // what the file achieves.
    expect(DEPLOYMENT_KEY_REQUIREMENT).toMatch(/on its own|alone|cannot restore/i);
  });

  it("says to keep the two apart", () => {
    // A kit and the key that opens it, in the same place, are one thing that
    // can be lost together — which is the scenario the kit exists for.
    expect(DEPLOYMENT_KEY_REQUIREMENT).toMatch(/separate|somewhere else/i);
  });

  it("uses no jargon an owner would have to look up", () => {
    for (const term of ["AES", "envelope", "wrapping", "HKDF", "scrypt", "KDF"]) {
      expect(DEPLOYMENT_KEY_REQUIREMENT).not.toMatch(new RegExp(term, "i"));
    }
  });
});
