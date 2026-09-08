import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DesktopServerProfile, ProfileResult, SetProfileInput } from "./ipc-contract.ts";
import { connectionStatusForClassification, normalizeServerUrl } from "./server-profile-policy.ts";

export interface ProfileStore {
  loadAll(): DesktopServerProfile[];
  saveAll(profiles: readonly DesktopServerProfile[]): void;
}

export class FileProfileStore implements ProfileStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  loadAll(): DesktopServerProfile[] {
    try {
      const parsed = JSON.parse(readFileSync(this.#filePath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isProfile);
    } catch {
      return [];
    }
  }

  saveAll(profiles: readonly DesktopServerProfile[]): void {
    // A damaged registry must not silently become a fresh installation: the
    // original profile IDs locate its encrypted vaults and session partitions.
    if (existsSync(this.#filePath)) {
      const previous: unknown = JSON.parse(readFileSync(this.#filePath, "utf8"));
      if (!Array.isArray(previous) || !previous.every(isProfile)) {
        throw new Error("The existing desktop profile registry requires recovery");
      }
    }
    mkdirSync(path.dirname(this.#filePath), { recursive: true });
    const temp = `${this.#filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(profiles, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temp, this.#filePath);
  }
}

function isProfile(value: unknown): value is DesktopServerProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["profileId"] === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record["profileId"]) &&
    typeof record["label"] === "string" &&
    typeof record["serverUrl"] === "string" &&
    normalizeServerUrl(record["serverUrl"]).ok &&
    typeof record["active"] === "boolean"
  );
}

export function activeProfile(
  profiles: readonly DesktopServerProfile[],
): DesktopServerProfile | null {
  return profiles.find((profile) => profile.active) ?? null;
}

export interface ProfileMutation {
  readonly result: ProfileResult;
  readonly profiles: readonly DesktopServerProfile[];
}

export function upsertActiveProfile(
  profiles: readonly DesktopServerProfile[],
  input: SetProfileInput,
): ProfileMutation {
  const normalized = normalizeServerUrl(input.serverUrl);
  if (!normalized.ok) {
    const message =
      normalized.reason === "unsupported-scheme"
        ? "This address is not an HTTP or HTTPS server."
        : "Enter a complete http(s) origin, without a path.";
    return {
      result: { ok: false, status: "incompatible", message },
      profiles,
    };
  }
  if (normalized.classification === "insecure-http")
    return {
      result: {
        ok: false,
        status: "insecure",
        message: "Utilisez HTTPS pour un serveur distant. HTTP est réservé à la machine locale.",
      },
      profiles,
    };
  const existing = profiles.find((profile) => profile.serverUrl === normalized.origin);
  const profile: DesktopServerProfile = {
    profileId: existing?.profileId ?? randomUUID(),
    label: input.label?.trim() || existing?.label || new URL(normalized.origin).host,
    serverUrl: normalized.origin,
    protocolCompatibility: existing?.protocolCompatibility ?? "unknown",
    deviceId:
      existing !== undefined && existing.serverUrl === normalized.origin ? existing.deviceId : null,
    lastReachability: existing?.lastReachability ?? null,
    lastSyncAt: existing?.lastSyncAt ?? null,
    active: true,
  };
  const next = [
    profile,
    ...profiles
      .filter((candidate) => candidate.profileId !== profile.profileId)
      .map((candidate) => ({ ...candidate, active: false })),
  ];
  return {
    result: {
      ok: true,
      profile,
      status: connectionStatusForClassification(normalized.classification),
    },
    profiles: next,
  };
}

export function persistUpsert(store: ProfileStore, input: SetProfileInput): ProfileMutation {
  const mutation = upsertActiveProfile(store.loadAll(), input);
  if (mutation.result.ok) {
    store.saveAll(mutation.profiles);
  }
  return mutation;
}
