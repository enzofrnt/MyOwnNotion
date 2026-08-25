/** In-memory fan-out for post-commit page frontier announcements. */

import type { Uuid } from "@myownnotion/domain";
import type { PageAdvanceEvent } from "./page-advance-notifier.ts";

export interface PageSyncHubPeer {
  readonly connectionId: Uuid;
  readonly ownerId: string;
  readonly deviceId: string;
  sendPageAdvance(event: PageAdvanceEvent): boolean;
  close(code: number, reason: string): void;
}

export class PageSyncHub {
  readonly #peers = new Map<Uuid, PageSyncHubPeer>();

  add(peer: PageSyncHubPeer): void {
    const existing = this.#peers.get(peer.connectionId);
    if (existing !== undefined && existing !== peer) {
      throw new Error("a realtime connection identity is already registered");
    }
    this.#peers.set(peer.connectionId, peer);
  }

  remove(connectionId: Uuid): void {
    this.#peers.delete(connectionId);
  }

  publish(event: PageAdvanceEvent): void {
    for (const peer of [...this.#peers.values()]) {
      if (!peer.sendPageAdvance(event)) this.#peers.delete(peer.connectionId);
    }
  }

  closeDevice(ownerId: string, deviceId: string, code: number, reason: string): number {
    const matches = [...this.#peers.values()].filter(
      (peer) => peer.ownerId === ownerId && peer.deviceId === deviceId,
    );
    for (const peer of matches) {
      this.#peers.delete(peer.connectionId);
      peer.close(code, reason);
    }
    return matches.length;
  }

  close(): void {
    const peers = [...this.#peers.values()];
    this.#peers.clear();
    for (const peer of peers) peer.close(1001, "server-shutdown");
  }

  get size(): number {
    return this.#peers.size;
  }
}
