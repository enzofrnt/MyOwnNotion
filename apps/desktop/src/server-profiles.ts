import type { ProtocolCompatibility } from "./ipc-contract.ts";

export interface HealthProbe {
  readonly ok: boolean;
  readonly protocolVersion: number | null;
  readonly schemaVersion: number | null;
}

export interface ProtocolWindow {
  readonly clientVersion: number;
  readonly minimumRead: number;
  readonly minimumWrite: number;
}

/** Default window matches the shipped web client (protocol 3, writes ≥ 2). */
export const DESKTOP_PROTOCOL_WINDOW: ProtocolWindow = {
  clientVersion: 3,
  minimumRead: 1,
  minimumWrite: 2,
};

export function compatibilityForHealth(
  probe: HealthProbe,
  window: ProtocolWindow = DESKTOP_PROTOCOL_WINDOW,
): ProtocolCompatibility {
  if (!probe.ok) {
    return "unknown";
  }
  const serverVersion = probe.protocolVersion ?? 1;
  if (window.clientVersion < window.minimumRead) {
    return "incompatible";
  }
  if (serverVersion < window.minimumRead) {
    return "incompatible";
  }
  if (window.clientVersion < window.minimumWrite || serverVersion < window.minimumWrite) {
    return "read-only";
  }
  return "compatible";
}

export function parseHealthHeaders(headers: Headers): number | null {
  const raw = headers.get("x-myownnotion-protocol");
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
