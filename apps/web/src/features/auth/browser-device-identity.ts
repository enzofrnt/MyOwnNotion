import type { BrowserDeviceClaimDto } from "@myownnotion/contracts";

export const BROWSER_DEVICE_IDENTITY_STORAGE_KEY = "myownnotion.browser-device.v1";

interface StoredBrowserDeviceIdentity extends BrowserDeviceClaimDto {
  readonly version: 1;
}

interface BrowserDeviceIdentityDeps {
  readonly storage?: () => Storage;
  readonly randomUuid?: () => string;
  readonly browserName?: () => string;
  readonly platformName?: () => string;
}

const BINDING_PATTERN =
  /^web-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function bounded(value: string, maximum: number, fallback: string): string {
  const normalized = value.trim().slice(0, maximum);
  return normalized.length === 0 ? fallback : normalized;
}

function detectBrowser(): string {
  if (typeof navigator === "undefined") return "Browser";
  const userAgent = navigator.userAgent;
  if (/Edg\//u.test(userAgent)) return "Edge";
  if (/Firefox\//u.test(userAgent)) return "Firefox";
  if (/Chrome\//u.test(userAgent)) return "Chrome";
  if (/Safari\//u.test(userAgent)) return "Safari";
  return "Browser";
}

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "Unknown platform";
  const modernPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  return bounded(modernPlatform ?? navigator.platform ?? "", 64, "Unknown platform");
}

function isStoredIdentity(value: unknown): value is StoredBrowserDeviceIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredBrowserDeviceIdentity>;
  return (
    candidate.version === 1 &&
    typeof candidate.deviceBindingId === "string" &&
    BINDING_PATTERN.test(candidate.deviceBindingId) &&
    typeof candidate.name === "string" &&
    candidate.name.length >= 1 &&
    candidate.name.length <= 120 &&
    typeof candidate.platform === "string" &&
    candidate.platform.length >= 1 &&
    candidate.platform.length <= 64
  );
}

/**
 * One origin-local browser identity, shared by tabs but never treated as a
 * credential. If storage is unavailable, the instance remains stable for the
 * current page lifetime and authentication still fails closed server-side.
 */
export class BrowserDeviceIdentityStore {
  readonly #deps: Required<BrowserDeviceIdentityDeps>;
  #memoryIdentity: StoredBrowserDeviceIdentity | null = null;

  constructor(deps: BrowserDeviceIdentityDeps = {}) {
    this.#deps = {
      storage: deps.storage ?? (() => window.localStorage),
      randomUuid: deps.randomUuid ?? (() => crypto.randomUUID()),
      browserName: deps.browserName ?? detectBrowser,
      platformName: deps.platformName ?? detectPlatform,
    };
  }

  getOrCreate(): BrowserDeviceClaimDto {
    if (this.#memoryIdentity !== null) return this.#claim(this.#memoryIdentity);

    try {
      const raw = this.#deps.storage().getItem(BROWSER_DEVICE_IDENTITY_STORAGE_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isStoredIdentity(parsed)) {
          this.#memoryIdentity = parsed;
          return this.#claim(parsed);
        }
      }
    } catch {
      // Storage access and malformed JSON are both repaired by the same fresh,
      // non-secret identity. No authentication decision is made here.
    }

    const platform = bounded(this.#deps.platformName(), 64, "Unknown platform");
    const browser = bounded(this.#deps.browserName(), 64, "Browser");
    const created: StoredBrowserDeviceIdentity = {
      version: 1,
      deviceBindingId: `web-${this.#deps.randomUuid()}`,
      name: bounded(`${browser} on ${platform}`, 120, "Browser device"),
      platform,
    };
    if (!isStoredIdentity(created)) {
      throw new Error("browser device identity generation failed");
    }
    this.#memoryIdentity = created;
    try {
      this.#deps.storage().setItem(BROWSER_DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(created));
    } catch {
      // The page-lifetime identity above remains usable. A later fresh page may
      // be enrolled as a new device, which is honest when storage cannot persist.
    }
    return this.#claim(created);
  }

  #claim(identity: StoredBrowserDeviceIdentity): BrowserDeviceClaimDto {
    return {
      deviceBindingId: identity.deviceBindingId,
      name: identity.name,
      platform: identity.platform,
    };
  }
}

export const browserDeviceIdentity = new BrowserDeviceIdentityStore();
