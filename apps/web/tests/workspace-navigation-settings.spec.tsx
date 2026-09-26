// @vitest-environment jsdom
/**
 * Favoris / Récents preference UI is retired from the settings shell. The
 * presentation fields and helpers remain for a later return — this suite only
 * guards that the product no longer exposes the switches.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "../src/features/settings/settings-shell.tsx";

describe("workspace navigation settings", () => {
  it("no longer exposes a Navigation section for Favoris / Récents", () => {
    expect(SETTINGS_SECTIONS.some((section) => section.id === "navigation")).toBe(false);
  });
});
