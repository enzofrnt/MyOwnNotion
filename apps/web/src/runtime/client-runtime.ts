export type ClientRuntimeKind = "web" | "desktop";

export interface ClientRuntimeProfile {
  readonly kind: ClientRuntimeKind;
  /**
   * Empty string means same-origin: the browser, and the desktop after the
   * window is loaded on the configured server origin.
   */
  readonly apiBaseUrl: string;
  readonly platform: "web" | "win32" | "darwin" | "linux";
  readonly appVersion: string | null;
}

export function isDesktopBridgePresent(): boolean {
  return typeof window !== "undefined" && window.myownnotionDesktop !== undefined;
}

export function webRuntimeProfile(): ClientRuntimeProfile {
  return {
    kind: "web",
    apiBaseUrl: "",
    platform: "web",
    appVersion: null,
  };
}

export async function detectClientRuntime(): Promise<ClientRuntimeProfile> {
  const desktop = typeof window === "undefined" ? undefined : window.myownnotionDesktop;
  if (desktop === undefined) {
    return webRuntimeProfile();
  }
  const profile = await desktop.getActiveProfile();
  const origin =
    typeof window !== "undefined" && window.location.origin === profile?.serverUrl
      ? ""
      : (profile?.serverUrl ?? "");
  return {
    kind: "desktop",
    apiBaseUrl: origin,
    platform: desktop.platform,
    appVersion: desktop.appVersion,
  };
}

export function needsDesktopOnboarding(profile: ClientRuntimeProfile): boolean {
  return profile.kind === "desktop" && profile.apiBaseUrl === "" && !isLoadedOnConfiguredOrigin();
}

function isLoadedOnConfiguredOrigin(): boolean {
  if (typeof window === "undefined" || window.myownnotionDesktop === undefined) {
    return false;
  }
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}
