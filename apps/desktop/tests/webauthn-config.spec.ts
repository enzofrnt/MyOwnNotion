import { describe, expect, it } from "vitest";
import { signedWebAuthnGroup } from "../src/webauthn-config.ts";

describe("desktop WebAuthn signed entitlement", () => {
  it("uses the exact signed Team ID and ignores unrelated entitlement strings", () => {
    expect(
      signedWebAuthnGroup(
        `<dict><key>keychain-access-groups</key><array><string>ABCDE12345.dev.myownnotion.desktop.webauthn</string></array></dict>`,
      ),
    ).toBe("ABCDE12345.dev.myownnotion.desktop.webauthn");
    expect(
      signedWebAuthnGroup(
        `<dict><key>unrelated</key><array><string>ABCDE12345.dev.myownnotion.desktop.webauthn</string></array></dict>`,
      ),
    ).toBeNull();
  });
  it("does not activate Touch ID with missing or unexpanded signing entitlements", () => {
    expect(signedWebAuthnGroup("")).toBeNull();
    expect(
      signedWebAuthnGroup(
        `<key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)dev.myownnotion.desktop.webauthn</string></array>`,
      ),
    ).toBeNull();
  });
});
