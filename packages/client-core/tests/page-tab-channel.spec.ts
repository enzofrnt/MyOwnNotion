import {
  type DurablePageTabAcknowledgement,
  PageTabChannel,
  type PageTabTransport,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { describe, expect, it, vi } from "vitest";

class MemoryChannelHub {
  readonly #listeners = new Map<string, Set<(message: unknown) => void>>();

  connect(id: string): PageTabTransport {
    const listeners = new Set<(message: unknown) => void>();
    this.#listeners.set(id, listeners);
    return {
      post: (message) => {
        queueMicrotask(() => {
          for (const endpoint of this.#listeners.values()) {
            for (const listener of endpoint) listener(message);
          }
        });
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close: () => {
        listeners.clear();
        this.#listeners.delete(id);
      },
    };
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function twoTabDocuments() {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const origin = OperationalPageDocument.create({
    pageId,
    document: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "A" }] }] },
  });
  const checkpoint = await origin.checkpoint();
  const author = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
  const receiver = await OperationalPageDocument.fromCheckpoint({ pageId, checkpoint });
  const transaction = author.transact([
    { type: "replace-text", blockId, from: 1, to: 1, text: " from tab A" },
  ]);
  return { pageId, blockId, author, receiver, transaction };
}

describe("same-browser page update channel", () => {
  it("uses a distinct random CRDT peer for every tab session", async () => {
    const { author, receiver } = await twoTabDocuments();
    expect(author.peerId).not.toBe(receiver.peerId);
  });

  it("acknowledges only after the receiving tab has durably persisted the update", async () => {
    const { pageId, author, receiver, transaction } = await twoTabDocuments();
    const hub = new MemoryChannelHub();
    const gate = deferred();
    const acknowledgements: DurablePageTabAcknowledgement[] = [];
    let receiverPersistCalls = 0;
    let authorEchoCalls = 0;

    const channelA = new PageTabChannel({
      pageId,
      tabId: "tab-a",
      peerId: author.peerId,
      transport: hub.connect("tab-a"),
      persistIncoming: async () => {
        authorEchoCalls += 1;
      },
      onDurableAcknowledgement: (ack) => acknowledgements.push(ack),
    });
    const channelB = new PageTabChannel({
      pageId,
      tabId: "tab-b",
      peerId: receiver.peerId,
      transport: hub.connect("tab-b"),
      persistIncoming: async ({ updateBytes, senderPeerId }) => {
        receiverPersistCalls += 1;
        expect(senderPeerId).toBe(author.peerId);
        expect(receiver.importUpdate(updateBytes).pending).toBe(false);
        await gate.promise;
      },
    });

    const updateId = generateUuidV7();
    channelA.publishUpdate(updateId, transaction.updateBytes);
    await vi.waitFor(() => expect(receiverPersistCalls).toBe(1));
    expect(acknowledgements).toEqual([]);
    expect(authorEchoCalls).toBe(0);

    gate.resolve();
    await vi.waitFor(() => expect(acknowledgements).toHaveLength(1));
    expect(acknowledgements[0]).toMatchObject({
      pageId,
      updateId,
      recipientTabId: "tab-b",
      recipientPeerId: receiver.peerId,
    });
    expect((await receiver.project()).document).toEqual((await author.project()).document);

    channelA.close();
    channelB.close();
  });

  it("deduplicates retries but can acknowledge the already durable update again", async () => {
    const { pageId, author, receiver, transaction } = await twoTabDocuments();
    const hub = new MemoryChannelHub();
    const acknowledgements: DurablePageTabAcknowledgement[] = [];
    let persistCalls = 0;
    const channelA = new PageTabChannel({
      pageId,
      tabId: "tab-a",
      peerId: author.peerId,
      transport: hub.connect("tab-a"),
      persistIncoming: async () => {},
      onDurableAcknowledgement: (ack) => acknowledgements.push(ack),
    });
    const channelB = new PageTabChannel({
      pageId,
      tabId: "tab-b",
      peerId: receiver.peerId,
      transport: hub.connect("tab-b"),
      persistIncoming: async ({ updateBytes }) => {
        persistCalls += 1;
        receiver.importUpdate(updateBytes);
      },
    });
    const updateId = generateUuidV7();

    channelA.publishUpdate(updateId, transaction.updateBytes);
    channelA.publishUpdate(updateId, transaction.updateBytes);

    await vi.waitFor(() => expect(acknowledgements.length).toBeGreaterThanOrEqual(1));
    expect(persistCalls).toBe(1);
    channelA.close();
    channelB.close();
  });

  it("sends no false acknowledgement when import or persistence fails", async () => {
    const { pageId, author, receiver, transaction } = await twoTabDocuments();
    const hub = new MemoryChannelHub();
    const acknowledgements: DurablePageTabAcknowledgement[] = [];
    const errors: unknown[] = [];
    const channelA = new PageTabChannel({
      pageId,
      tabId: "tab-a",
      peerId: author.peerId,
      transport: hub.connect("tab-a"),
      persistIncoming: async () => {},
      onDurableAcknowledgement: (ack) => acknowledgements.push(ack),
    });
    const channelB = new PageTabChannel({
      pageId,
      tabId: "tab-b",
      peerId: receiver.peerId,
      transport: hub.connect("tab-b"),
      persistIncoming: async () => {
        throw new Error("quota exceeded");
      },
      onError: (error) => errors.push(error),
    });

    channelA.publishUpdate(generateUuidV7(), transaction.updateBytes);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(acknowledgements).toEqual([]);
    channelA.close();
    channelB.close();
  });

  it("ignores messages for another page and becomes inert after close", async () => {
    const { pageId, author } = await twoTabDocuments();
    const hub = new MemoryChannelHub();
    let calls = 0;
    let acknowledgementCalls = 0;
    const channel = new PageTabChannel({
      pageId,
      tabId: "tab-a",
      peerId: author.peerId,
      transport: hub.connect("tab-a"),
      persistIncoming: async () => {
        calls += 1;
      },
      onDurableAcknowledgement: () => {
        acknowledgementCalls += 1;
      },
    });
    const outsider = hub.connect("outsider");
    outsider.post({
      channelVersion: 1,
      type: "page-update",
      pageId: generateUuidV7(),
      updateId: generateUuidV7(),
      updateBytes: new Uint8Array([1]),
      senderTabId: "outsider",
      senderPeerId: "other-peer",
    });
    outsider.post({
      channelVersion: 1,
      type: "page-update-durable",
      pageId,
      updateId: generateUuidV7(),
      targetTabId: "tab-a",
      recipientTabId: "outsider",
      recipientPeerId: "other-peer",
    });
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(acknowledgementCalls).toBe(0);
    channel.close();
    expect(() => channel.publishUpdate(generateUuidV7(), new Uint8Array([1]))).toThrow("closed");
    outsider.close();
  });
});
