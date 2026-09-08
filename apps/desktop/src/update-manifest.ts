export const UPDATE_MANIFEST_FORMAT = "myownnotion.desktop-update.v1";

export type UpdateChannel = "stable" | "beta";
export type UpdatePlatform = "win32" | "darwin" | "linux";
export type UpdateArchitecture = "x64" | "arm64";

export const PUBLISHED_DESKTOP_TARGETS = [
  { platform: "win32", architecture: "x64" },
  { platform: "win32", architecture: "arm64" },
  { platform: "darwin", architecture: "arm64" },
  { platform: "linux", architecture: "x64" },
  { platform: "linux", architecture: "arm64" },
] as const satisfies readonly {
  readonly platform: UpdatePlatform;
  readonly architecture: UpdateArchitecture;
}[];

export function isPublishedDesktopTarget(platform: string, architecture: string): boolean {
  return PUBLISHED_DESKTOP_TARGETS.some(
    (target) => target.platform === platform && target.architecture === architecture,
  );
}

export interface DesktopUpdateManifest {
  readonly format: typeof UPDATE_MANIFEST_FORMAT;
  readonly version: string;
  readonly channel: UpdateChannel;
  readonly platform: UpdatePlatform;
  readonly architecture: UpdateArchitecture;
  readonly artifactUrl: string;
  readonly artifactSha512: string;
  readonly releaseNotesUrl: string;
  readonly minimumServerProtocol: string;
  readonly maximumServerProtocol: string;
}

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: DesktopUpdateManifest }
  | { readonly ok: false; readonly reason: string };

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA512_HEX = /^[a-f0-9]{128}$/i;
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

export function parseUpdateManifest(value: unknown): ManifestValidation {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "manifest is not an object" };
  }
  const record = value as Record<string, unknown>;
  if (record["format"] !== UPDATE_MANIFEST_FORMAT) {
    return { ok: false, reason: "unsupported manifest format" };
  }
  const version = readString(record, "version");
  const channel = readString(record, "channel");
  const platform = readString(record, "platform");
  const architecture = readString(record, "architecture");
  const artifactUrl = readString(record, "artifactUrl");
  const artifactSha512 = readString(record, "artifactSha512");
  const releaseNotesUrl = readString(record, "releaseNotesUrl");
  const minimumServerProtocol = readString(record, "minimumServerProtocol");
  const maximumServerProtocol = readString(record, "maximumServerProtocol");
  if (
    version === null ||
    channel === null ||
    platform === null ||
    architecture === null ||
    artifactUrl === null ||
    artifactSha512 === null ||
    releaseNotesUrl === null ||
    minimumServerProtocol === null ||
    maximumServerProtocol === null
  ) {
    return { ok: false, reason: "manifest is missing a required field" };
  }
  if (
    !/^[1-9]\d*$/.test(minimumServerProtocol) ||
    !/^[1-9]\d*$/.test(maximumServerProtocol) ||
    Number(minimumServerProtocol) > Number(maximumServerProtocol)
  )
    return { ok: false, reason: "invalid protocol window" };
  if (!VERSION.test(version)) {
    return { ok: false, reason: "version is not a strict semver triple" };
  }
  if (channel !== "stable" && channel !== "beta") {
    return { ok: false, reason: "channel is not recognized" };
  }
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") {
    return { ok: false, reason: "platform is not a supported desktop host" };
  }
  if (architecture !== "x64" && architecture !== "arm64") {
    return { ok: false, reason: "architecture is not a supported desktop host" };
  }
  if (!isPublishedDesktopTarget(platform, architecture)) {
    return { ok: false, reason: "platform and architecture are not a published desktop target" };
  }
  if (!isHttpsUrl(artifactUrl) || !isHttpsUrl(releaseNotesUrl)) {
    return { ok: false, reason: "manifest and artifact URLs must be HTTPS" };
  }
  if (!SHA512_HEX.test(artifactSha512) && !SHA512_BASE64.test(artifactSha512)) {
    return { ok: false, reason: "artifact digest is not SHA-512 hex or base64" };
  }
  if (looksLikeSecret(record)) {
    return { ok: false, reason: "manifest must not carry secrets or local paths" };
  }
  return {
    ok: true,
    manifest: {
      format: UPDATE_MANIFEST_FORMAT,
      version,
      channel,
      platform,
      architecture,
      artifactUrl,
      artifactSha512,
      releaseNotesUrl,
      minimumServerProtocol,
      maximumServerProtocol,
    },
  };
}

export function manifestMatchesHost(
  manifest: DesktopUpdateManifest,
  host: {
    readonly version: string;
    readonly platform: UpdatePlatform;
    readonly architecture: UpdateArchitecture;
  },
): ManifestValidation {
  if (manifest.platform !== host.platform || manifest.architecture !== host.architecture) {
    return { ok: false, reason: "manifest does not match this installation" };
  }
  if (compareSemver(manifest.version, host.version) < 0) {
    return { ok: false, reason: "downgrade is not authorized" };
  }
  return { ok: true, manifest };
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function looksLikeSecret(record: Record<string, unknown>): boolean {
  const forbidden = ["token", "secret", "password", "privatekey", "cookie", "path"];
  const encoded = JSON.stringify(record).toLowerCase();
  if (encoded.includes("file:") || encoded.includes("\\\\") || encoded.includes("/users/")) {
    return true;
  }
  return Object.keys(record).some((key) =>
    forbidden.some((part) => key.toLowerCase().includes(part)),
  );
}

function compareSemver(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10));
  const b = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}
