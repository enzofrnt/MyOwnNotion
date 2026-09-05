import { execFileSync } from "node:child_process";
import path from "node:path";
import { app, type Session } from "electron";

/** Must match `packagerConfig.appBundleId` in `forge.config.ts`. */
export const DESKTOP_BUNDLE_ID = "dev.myownnotion.desktop";

/** Read the actual signed entitlement: Apple requires the Team ID prefix. */
export function signedWebAuthnGroup(entitlements: string): string | null {
  const groups = entitlements.match(
    /<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/,
  )?.[1];
  return (
    groups?.match(/<string>([A-Z0-9]{10}\.dev\.myownnotion\.desktop\.webauthn)<\/string>/)?.[1] ??
    null
  );
}

const configuredSessions = new WeakSet<Session>();

export function touchIdEnabledInThisHost(): boolean {
  if (process.platform !== "darwin") {
    return false;
  }
  if (process.env["MYOWNNOTION_DESKTOP_TOUCH_ID"] === "1") {
    return true;
  }
  return process.execPath.includes(`${path.sep}MyOwnNotion.app${path.sep}`);
}

/**
 * Enables the macOS Touch ID platform authenticator for `navigator.credentials`.
 *
 * Without this call, WebAuthn requests hang until timeout and no system sheet
 * appears (Electron/Chromium do not wire platform authenticators by default).
 */
export function configureDesktopWebAuthn(): void {
  if (!touchIdEnabledInThisHost()) {
    return;
  }
  if (typeof app.configureWebAuthn !== "function") {
    console.warn("desktop: configureWebAuthn is unavailable in this Electron build");
    return;
  }
  try {
    const entitlements = execFileSync(
      "/usr/bin/codesign",
      ["-d", "--entitlements", ":-", process.execPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const keychainAccessGroup = signedWebAuthnGroup(entitlements);
    if (keychainAccessGroup === null) return;
    app.configureWebAuthn({
      touchID: {
        keychainAccessGroup,
        promptReason: "verify your identity on $1",
      },
    });
  } catch {
    console.warn("desktop: Touch ID WebAuthn could not be configured");
  }
}

/** Auto-pick the first discoverable credential when the platform asks. */
export function registerWebAuthnSessionHandlers(targetSession: Session): void {
  if (configuredSessions.has(targetSession)) return;
  configuredSessions.add(targetSession);
  targetSession.on("select-webauthn-account", (_event, details, callback) => {
    callback(details.accounts[0]?.credentialId ?? null);
  });
}
