import {
  MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
} from "@myownnotion/contracts";
import type { RawData } from "ws";

export interface PendingAuthenticationFrame {
  readonly frame: RawData;
  readonly isBinary: boolean;
}

function frameByteLength(frame: RawData): number {
  return Array.isArray(frame)
    ? frame.reduce((size, part) => size + part.byteLength, 0)
    : frame.byteLength;
}

/**
 * Keeps only the first bounded frames received while the durable owner session
 * is being resolved after Bun's synchronous WebSocket upgrade.
 */
export class PendingAuthenticationFrames {
  readonly #maxFrames: number;
  readonly #maxBytes: number;
  #frames: PendingAuthenticationFrame[] = [];
  #bytes = 0;

  constructor(
    maxFrames = MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
    maxBytes = MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
  ) {
    this.#maxFrames = maxFrames;
    this.#maxBytes = maxBytes;
  }

  enqueue(frame: RawData, isBinary: boolean): boolean {
    const bytes = frameByteLength(frame);
    if (this.#frames.length >= this.#maxFrames || bytes > this.#maxBytes - this.#bytes) {
      return false;
    }
    this.#frames.push({ frame, isBinary });
    this.#bytes += bytes;
    return true;
  }

  drain(): readonly PendingAuthenticationFrame[] {
    const frames = this.#frames;
    this.#frames = [];
    this.#bytes = 0;
    return frames;
  }
}
