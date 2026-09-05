export type DesktopPlatform = "win32" | "darwin" | "linux";

export interface DesktopServerProfile {
  readonly profileId: string;
  readonly label: string;
  readonly serverUrl: string;
  readonly protocolCompatibility: "unknown" | "compatible" | "read-only" | "incompatible";
  readonly deviceId: string | null;
  readonly lastReachability: string | null;
  readonly lastSyncAt: string | null;
  readonly active: boolean;
}

export interface SetProfileInput {
  readonly label?: string;
  readonly serverUrl: string;
}

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

export interface WrappedKeyEnvelope {
  readonly keyId: string;
  readonly algorithm: "os-protected-envelope-v1";
  readonly ciphertext: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export type WrappedKeyResult =
  | { readonly ok: true; readonly envelope: WrappedKeyEnvelope }
  | { readonly ok: false; readonly state: KeyAvailability; readonly message: string };

export type UnwrappedKeyResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly state: KeyAvailability; readonly message: string };

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
  readonly saveFile: (input: {
    defaultName: string;
    bytes: Uint8Array;
  }) => Promise<{ ok: true; canceled: boolean } | { ok: false; message: string }>;
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

declare global {
  interface Window {
    readonly myownnotionDesktop?: DesktopRuntime;
  }
}
