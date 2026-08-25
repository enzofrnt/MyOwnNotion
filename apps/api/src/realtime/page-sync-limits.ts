/** Per-connection admission limits for the persistent page-sync channel. */

import {
  MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
} from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";

export const REALTIME_PAGE_SYNC_RATE_WINDOW_MS = 10_000;
export const MAX_REALTIME_PAGE_SYNC_FRAMES_PER_WINDOW = 120;

export type RealtimeFrameAdmission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "message-too-large" | "rate-limited" };

export type RealtimeExchangeAdmission =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "duplicate-request" | "page-in-flight" | "too-many-in-flight";
    };

/**
 * Keeps every transport-only limit in one bounded object owned by one socket.
 *
 * It never owns updates and never decides whether a page operation is valid;
 * it only prevents one connection from consuming unbounded memory or work.
 */
export class PageSyncLimits {
  readonly #now: () => number;
  readonly #recentFrames: number[] = [];
  readonly #inFlightRequests = new Set<Uuid>();
  readonly #inFlightPages = new Set<Uuid>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  admitFrame(frame: string): RealtimeFrameAdmission {
    if (Buffer.byteLength(frame, "utf8") > MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES) {
      return { allowed: false, reason: "message-too-large" };
    }

    const now = this.#now();
    const cutoff = now - REALTIME_PAGE_SYNC_RATE_WINDOW_MS;
    while (this.#recentFrames[0] !== undefined && this.#recentFrames[0] <= cutoff) {
      this.#recentFrames.shift();
    }
    if (this.#recentFrames.length >= MAX_REALTIME_PAGE_SYNC_FRAMES_PER_WINDOW) {
      return { allowed: false, reason: "rate-limited" };
    }
    this.#recentFrames.push(now);
    return { allowed: true };
  }

  admitExchange(requestId: Uuid, pageId: Uuid): RealtimeExchangeAdmission {
    if (this.#inFlightRequests.has(requestId)) {
      return { allowed: false, reason: "duplicate-request" };
    }
    if (this.#inFlightPages.has(pageId)) {
      return { allowed: false, reason: "page-in-flight" };
    }
    if (this.#inFlightRequests.size >= MAX_REALTIME_PAGE_SYNC_IN_FLIGHT) {
      return { allowed: false, reason: "too-many-in-flight" };
    }
    this.#inFlightRequests.add(requestId);
    this.#inFlightPages.add(pageId);
    return { allowed: true };
  }

  releaseExchange(requestId: Uuid, pageId: Uuid): void {
    this.#inFlightRequests.delete(requestId);
    this.#inFlightPages.delete(pageId);
  }
}
