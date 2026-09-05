/**
 * Typed IPC surface between the sandboxed renderer and the privileged host.
 *
 * The renderer never sees Electron, filesystem paths, cookies, or tokens.
 * Every payload is JSON-serializable except transient key bytes, which cross
 * the preload boundary only for an immediate wrap/unwrap and are not stored
 * on the bridge object.
 */

export const DESKTOP_PROTOCOL_SCHEME = "myownnotion";
export const DESKTOP_PROTOCOL_HOST = "app";
export const DESKTOP_APP_ORIGIN = `${DESKTOP_PROTOCOL_SCHEME}://${DESKTOP_PROTOCOL_HOST}`;

/** Custom schemes serialize `origin` as `"null"`; compare protocol and host instead. */
export function isDesktopAppUrl(url: URL): boolean {
  return url.protocol === `${DESKTOP_PROTOCOL_SCHEME}:` && url.hostname === DESKTOP_PROTOCOL_HOST;
}

export const IPC_CHANNELS = {
  getActiveProfile: "desktop:get-active-profile",
  setActiveProfile: "desktop:set-active-profile",
  getKeyState: "desktop:get-key-state",
  wrapDeviceKey: "desktop:wrap-device-key",
  unwrapDeviceKey: "desktop:unwrap-device-key",
  chooseFile: "desktop:choose-file",
  saveFile: "desktop:save-file",
  openExternal: "desktop:open-external",
  getWindowState: "desktop:get-window-state",
  updateCheck: "desktop:update-check",
  updateContext: "desktop:update-context",
  updateDefer: "desktop:update-defer",
  updateInstall: "desktop:update-install",
  getDiagnostics: "desktop:get-diagnostics",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type DesktopPlatform = "win32" | "darwin" | "linux";

export function resolveDesktopPlatform(
  platform: NodeJS.Platform = process.platform,
): DesktopPlatform {
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  return "win32";
}

export type ProtocolCompatibility = "unknown" | "compatible" | "read-only" | "incompatible";

export type ConnectionStatusKind =
  | "configured"
  | "checking"
  | "compatible"
  | "authenticated"
  | "read-only"
  | "unreachable"
  | "insecure"
  | "incompatible"
  | "revoked"
  | "reauthorization";

export interface DesktopServerProfile {
  readonly profileId: string;
  readonly label: string;
  readonly serverUrl: string;
  readonly protocolCompatibility: ProtocolCompatibility;
  readonly deviceId: string | null;
  readonly lastReachability: string | null;
  readonly lastSyncAt: string | null;
  readonly active: boolean;
}

export interface SetProfileInput {
  readonly label?: string;
  readonly serverUrl: string;
}

export type ProfileResult =
  | {
      readonly ok: true;
      readonly profile: DesktopServerProfile;
      readonly status: ConnectionStatusKind;
    }
  | { readonly ok: false; readonly status: ConnectionStatusKind; readonly message: string };

export type KeyAvailability = "missing" | "available" | "locked" | "unavailable" | "revoked";

export interface KeyStateResult {
  readonly state: KeyAvailability;
  readonly encryptionAvailable: boolean;
  readonly platform: DesktopPlatform;
}

export type WrappedKeyResult =
  | { readonly ok: true; readonly envelope: WrappedKeyEnvelope }
  | { readonly ok: false; readonly state: KeyAvailability; readonly message: string };

export type UnwrappedKeyResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly state: KeyAvailability; readonly message: string };

export interface WrappedKeyEnvelope {
  readonly keyId: string;
  readonly algorithm: "os-protected-envelope-v1";
  readonly ciphertext: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export type NativeCapability =
  | "choose-file"
  | "save-file"
  | "open-external"
  | "get-key-state"
  | "wrap-key"
  | "unwrap-key"
  | "window-state";

export interface FileDialogInput {
  readonly title?: string;
  readonly filters?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

export type FileDialogResult =
  | { readonly ok: true; readonly canceled: true }
  | {
      readonly ok: true;
      readonly canceled: false;
      readonly name: string;
      readonly bytes: Uint8Array;
    }
  | { readonly ok: false; readonly message: string };

export type SaveFileInput = {
  readonly defaultName: string;
  readonly bytes: Uint8Array;
};

export type SaveFileResult =
  | { readonly ok: true; readonly canceled: boolean }
  | { readonly ok: false; readonly message: string };

export type OpenExternalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface WindowState {
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly isMaximized: boolean;
  readonly lastRoute: string | null;
  readonly lastProfileId: string | null;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "deferred"
  | "downloading"
  | "downloaded"
  | "installing"
  | "restarted"
  | "unavailable"
  | "invalid-manifest"
  | "incompatible"
  | "download-failed"
  | "install-failed"
  | "rollback-required";

export interface UpdateState {
  readonly phase: UpdatePhase;
  readonly version: string | null;
  readonly message: string | null;
  readonly pendingLocalChanges: boolean;
  readonly migrationActive: boolean;
}

export interface DesktopRuntime {
  readonly platform: DesktopPlatform;
  readonly appVersion: string;
  readonly getActiveProfile: () => Promise<DesktopServerProfile | null>;
  readonly setActiveProfile: (input: SetProfileInput) => Promise<ProfileResult>;
  readonly getKeyState: () => Promise<KeyStateResult>;
  readonly wrapDeviceKey: (input: Uint8Array) => Promise<WrappedKeyResult>;
  readonly unwrapDeviceKey: (input: WrappedKeyEnvelope) => Promise<UnwrappedKeyResult>;
  readonly saveFile: (input: SaveFileInput) => Promise<SaveFileResult>;
  readonly chooseFile: (input: FileDialogInput) => Promise<FileDialogResult>;
  readonly openExternal: (input: { readonly url: string }) => Promise<OpenExternalResult>;
  readonly getWindowState: () => Promise<WindowState>;
  readonly update: {
    readonly check: () => Promise<UpdateState>;
    readonly context: (input: { pendingLocalChanges: boolean }) => Promise<UpdateState>;
    readonly defer: () => Promise<UpdateState>;
    readonly install: () => Promise<UpdateState>;
  };
}

export interface RedactedDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly occurredAt: string;
}

export function isIpcChannel(value: string): value is IpcChannel {
  return (Object.values(IPC_CHANNELS) as string[]).includes(value);
}
