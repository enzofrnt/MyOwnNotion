import type { WindowState } from "./ipc-contract.ts";

export type { WindowState };

export const DEFAULT_WINDOW_STATE: WindowState = {
  bounds: { x: 80, y: 80, width: 1280, height: 800 },
  isMaximized: false,
  lastRoute: null,
  lastProfileId: null,
};

export function sanitizeWindowState(
  value: unknown,
  displays: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[],
): WindowState {
  const candidate = isWindowState(value) ? value : DEFAULT_WINDOW_STATE;
  const width = clamp(candidate.bounds.width, 640, 4096);
  const height = clamp(candidate.bounds.height, 480, 2160);
  const visible = displays.some((display) =>
    intersects({ x: candidate.bounds.x, y: candidate.bounds.y, width, height }, display),
  );
  const origin = visible
    ? { x: candidate.bounds.x, y: candidate.bounds.y }
    : {
        x: displays[0]?.x ?? DEFAULT_WINDOW_STATE.bounds.x,
        y: displays[0]?.y ?? DEFAULT_WINDOW_STATE.bounds.y,
      };
  return {
    bounds: { ...origin, width, height },
    isMaximized: candidate.isMaximized,
    lastRoute: safeWindowRoute(candidate.lastRoute),
    lastProfileId: candidate.lastProfileId,
  };
}

function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const bounds = record["bounds"];
  if (typeof bounds !== "object" || bounds === null) {
    return false;
  }
  const box = bounds as Record<string, unknown>;
  return (
    typeof box["x"] === "number" &&
    typeof box["y"] === "number" &&
    typeof box["width"] === "number" &&
    typeof box["height"] === "number" &&
    [box["x"], box["y"], box["width"], box["height"]].every(Number.isFinite) &&
    typeof record["isMaximized"] === "boolean" &&
    (record["lastRoute"] === null || typeof record["lastRoute"] === "string") &&
    (record["lastProfileId"] === null || typeof record["lastProfileId"] === "string")
  );
}

/** Persist identities only; query strings, titles and arbitrary paths are excluded. */
export function safeWindowRoute(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\/(notes|graph)(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i.test(
    value,
  )
    ? value
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function intersects(
  windowBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  display: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): boolean {
  return (
    windowBounds.x < display.x + display.width &&
    windowBounds.x + windowBounds.width > display.x &&
    windowBounds.y < display.y + display.height &&
    windowBounds.y + windowBounds.height > display.y
  );
}
