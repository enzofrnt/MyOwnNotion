/**
 * Best-effort same-browser propagation for operational page updates.
 *
 * BroadcastChannel is an accelerator, never the durability authority. A
 * receiver acknowledges only after its caller has imported and persisted the
 * update. Failures stay unacknowledged and the normal IndexedDB/server catch-up
 * path remains authoritative.
 */

import type { Uuid } from "@myownnotion/domain";
import { copyPageOperationBytes } from "./encrypted-update-log.ts";

const PAGE_TAB_CHANNEL_VERSION = 1 as const;

export interface PageTabTransport {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
  close(): void;
}

export interface IncomingPageTabUpdate {
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly updateBytes: Uint8Array;
  readonly senderTabId: string;
  readonly senderPeerId: string;
}

export interface DurablePageTabAcknowledgement {
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly recipientTabId: string;
  readonly recipientPeerId: string;
}

interface UpdateMessage {
  readonly channelVersion: typeof PAGE_TAB_CHANNEL_VERSION;
  readonly type: "page-update";
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly updateBytes: Uint8Array;
  readonly senderTabId: string;
  readonly senderPeerId: string;
}

interface AcknowledgementMessage {
  readonly channelVersion: typeof PAGE_TAB_CHANNEL_VERSION;
  readonly type: "page-update-durable";
  readonly pageId: Uuid;
  readonly updateId: Uuid;
  readonly targetTabId: string;
  readonly recipientTabId: string;
  readonly recipientPeerId: string;
}

type PageTabMessage = UpdateMessage | AcknowledgementMessage;

export interface PageTabChannelOptions {
  readonly pageId: Uuid;
  /** Random for this browser tab/session; never an owner or device id. */
  readonly tabId?: string;
  /** The random peer id owned by this exact OperationalPageDocument instance. */
  readonly peerId: string;
  readonly transport: PageTabTransport;
  readonly persistIncoming: (update: IncomingPageTabUpdate) => Promise<void>;
  readonly onDurableAcknowledgement?: (ack: DurablePageTabAcknowledgement) => void;
  readonly onError?: (error: unknown) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPageTabMessage(value: unknown): value is PageTabMessage {
  if (
    !isObject(value) ||
    value["channelVersion"] !== PAGE_TAB_CHANNEL_VERSION ||
    typeof value["pageId"] !== "string" ||
    typeof value["updateId"] !== "string"
  ) {
    return false;
  }
  if (value["type"] === "page-update") {
    return (
      value["updateBytes"] instanceof Uint8Array &&
      typeof value["senderTabId"] === "string" &&
      typeof value["senderPeerId"] === "string"
    );
  }
  if (value["type"] === "page-update-durable") {
    return (
      typeof value["targetTabId"] === "string" &&
      typeof value["recipientTabId"] === "string" &&
      typeof value["recipientPeerId"] === "string"
    );
  }
  return false;
}

function browserTransport(name: string): PageTabTransport {
  const channel = new BroadcastChannel(name);
  return {
    post(message) {
      channel.postMessage(message);
    },
    subscribe(listener) {
      const handler = (event: MessageEvent<unknown>) => listener(event.data);
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
    close() {
      channel.close();
    },
  };
}

export function pageTabChannelName(workspaceId: string, pageId: Uuid): string {
  return `myownnotion.page-operations.v1.${workspaceId}.${pageId}`;
}

export function openBrowserPageTabChannel(
  input: Omit<PageTabChannelOptions, "transport"> & { readonly workspaceId: string },
): PageTabChannel {
  return new PageTabChannel({
    ...input,
    transport: browserTransport(pageTabChannelName(input.workspaceId, input.pageId)),
  });
}

export class PageTabChannel {
  readonly tabId: string;
  readonly peerId: string;
  readonly #pageId: Uuid;
  readonly #transport: PageTabTransport;
  readonly #persistIncoming: PageTabChannelOptions["persistIncoming"];
  readonly #onDurableAcknowledgement: PageTabChannelOptions["onDurableAcknowledgement"] | undefined;
  readonly #onError: PageTabChannelOptions["onError"] | undefined;
  readonly #unsubscribe: () => void;
  readonly #durablyReceived = new Set<string>();
  readonly #receiving = new Map<string, Promise<void>>();
  readonly #publishedUpdates = new Set<Uuid>();
  readonly #acknowledgements = new Set<string>();
  #closed = false;

  constructor(options: PageTabChannelOptions) {
    if (options.peerId.length === 0) throw new TypeError("a random page peer id is required");
    this.tabId = options.tabId ?? crypto.randomUUID();
    this.peerId = options.peerId;
    this.#pageId = options.pageId;
    this.#transport = options.transport;
    this.#persistIncoming = options.persistIncoming;
    this.#onDurableAcknowledgement = options.onDurableAcknowledgement;
    this.#onError = options.onError;
    this.#unsubscribe = this.#transport.subscribe((message) => {
      void this.#receive(message).catch((error: unknown) => this.#onError?.(error));
    });
  }

  publishUpdate(updateId: Uuid, updateBytes: Uint8Array): void {
    if (this.#closed) throw new Error("page tab channel is closed");
    this.#publishedUpdates.add(updateId);
    const message: UpdateMessage = {
      channelVersion: PAGE_TAB_CHANNEL_VERSION,
      type: "page-update",
      pageId: this.#pageId,
      updateId,
      updateBytes: copyPageOperationBytes(updateBytes),
      senderTabId: this.tabId,
      senderPeerId: this.peerId,
    };
    this.#transport.post(message);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe();
    this.#transport.close();
    this.#receiving.clear();
  }

  async #receive(value: unknown): Promise<void> {
    if (this.#closed || !isPageTabMessage(value) || value.pageId !== this.#pageId) return;
    if (value.type === "page-update-durable") {
      if (
        value.targetTabId !== this.tabId ||
        value.recipientTabId === this.tabId ||
        !this.#publishedUpdates.has(value.updateId)
      ) {
        return;
      }
      const acknowledgementKey = `${value.updateId}:${value.recipientTabId}`;
      if (this.#acknowledgements.has(acknowledgementKey)) return;
      this.#acknowledgements.add(acknowledgementKey);
      this.#onDurableAcknowledgement?.({
        pageId: value.pageId,
        updateId: value.updateId,
        recipientTabId: value.recipientTabId,
        recipientPeerId: value.recipientPeerId,
      });
      return;
    }
    if (value.senderTabId === this.tabId) return;

    const receiptKey = `${value.senderTabId}:${value.updateId}`;
    if (!this.#durablyReceived.has(receiptKey)) {
      let persistence = this.#receiving.get(receiptKey);
      if (persistence === undefined) {
        persistence = this.#persistIncoming({
          pageId: value.pageId,
          updateId: value.updateId,
          updateBytes: copyPageOperationBytes(value.updateBytes),
          senderTabId: value.senderTabId,
          senderPeerId: value.senderPeerId,
        });
        this.#receiving.set(receiptKey, persistence);
      }
      try {
        await persistence;
        this.#durablyReceived.add(receiptKey);
      } finally {
        this.#receiving.delete(receiptKey);
      }
    }

    const acknowledgement: AcknowledgementMessage = {
      channelVersion: PAGE_TAB_CHANNEL_VERSION,
      type: "page-update-durable",
      pageId: this.#pageId,
      updateId: value.updateId,
      targetTabId: value.senderTabId,
      recipientTabId: this.tabId,
      recipientPeerId: this.peerId,
    };
    this.#transport.post(acknowledgement);
  }
}
