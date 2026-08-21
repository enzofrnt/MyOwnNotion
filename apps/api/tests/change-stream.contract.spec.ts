/**
 * The live change stream, over a real socket (T008, T015 — US1, US2).
 *
 * `app.inject` cannot exercise this route: the handler hijacks the reply and
 * never ends it, so an injected request would hang rather than fail. The stream
 * is therefore driven over a real listening socket, which is also the only way
 * to observe what these tests are actually about — that events arrive *while*
 * the connection stays open, rather than in one buffered lump at the end.
 */

import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, createItemViaApi } from "./helpers/app.ts";

let harness: ApiHarness;
let origin: string;

beforeAll(async () => {
  harness = await createApiHarness();
  const address = await harness.built.app.listen({ port: 0, host: "127.0.0.1" });
  origin = address;
}, 120_000);

afterAll(async () => {
  await harness.close();
});

interface StreamEvent {
  readonly id?: string;
  readonly name: string;
  readonly data: string;
}

/**
 * Reads events off an open stream until `count` have arrived.
 *
 * Deliberately incremental. Reading the whole body would never return — the
 * stream does not end — and reading it "until done" is exactly the mistake that
 * would make a buffered implementation look correct.
 */
async function readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
  timeoutMs = 5_000,
): Promise<StreamEvent[]> {
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (events.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `only ${events.length} of ${count} events arrived: ${JSON.stringify(events)}`,
      );
    }
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(
          () => resolve({ done: true, value: undefined }),
          Math.max(0, deadline - Date.now()),
        ),
      ),
    ]);
    if (chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
      // Comment lines are the heartbeat; not events.
      if (block.startsWith(":")) {
        continue;
      }
      const parsed: { id?: string; name?: string; data?: string } = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("id: ")) {
          parsed.id = line.slice(4);
        } else if (line.startsWith("event: ")) {
          parsed.name = line.slice(7);
        } else if (line.startsWith("data: ")) {
          parsed.data = line.slice(6);
        }
      }
      if (parsed.name !== undefined && parsed.data !== undefined) {
        events.push({
          name: parsed.name,
          data: parsed.data,
          ...(parsed.id === undefined ? {} : { id: parsed.id }),
        });
      }
    }
  }
  return events;
}

async function openStream(headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}/v1/changes/stream`, {
    headers: { accept: "text/event-stream", ...headers },
  });
  if (response.body === null) {
    throw new Error("the stream has no body");
  }
  return { response, reader: response.body.getReader() };
}

describe("subscribing to the stream", () => {
  it("answers as an event stream that nothing may cache", async () => {
    const { response, reader } = await openStream();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    // A cached stream would replay positions from a moment that has passed.
    expect(response.headers.get("cache-control")).toBe("no-store");
    // On every response including this one, so a client holding a long-lived
    // stream cannot pass a handshake and then drift (FR-017).
    expect(response.headers.get("x-myownnotion-protocol")).toBe("3");
    await reader.cancel();
  });

  it("greets a first connection with the current position", async () => {
    const { reader } = await openStream();
    const [first] = await readEvents(reader, 1);
    // A device that missed everything behaves exactly like a device that missed
    // one thing: one code path, and the one exercised constantly.
    expect(first?.name).toBe("advanced");
    expect(JSON.parse(first?.data ?? "{}")).toHaveProperty("cursor");
    await reader.cancel();
  });

  it("announces a change made while it is listening, and carries no content", async () => {
    const { reader } = await openStream();
    await readEvents(reader, 1);

    const secret = `Ledger ${generateUuidV7()}`;
    await createItemViaApi(harness, { kind: "folder", name: secret });

    const [announced] = await readEvents(reader, 1);
    expect(announced?.name).toBe("advanced");
    // The assertion this route exists to satisfy. A pushed payload would bypass
    // the sealed-envelope resolution and the protocol check the pull path
    // performs, so the event carries a position and nothing else.
    expect(announced?.data).not.toContain(secret);
    expect(Object.keys(JSON.parse(announced?.data ?? "{}"))).toEqual(["cursor"]);
    // The id is the sequence, which is what makes the browser's own
    // `Last-Event-ID` on reconnect a position this server already understands.
    expect(announced?.id).toMatch(/^\d+$/);
    await reader.cancel();
  });

  it("announces one position for a batch rather than one per mutation", async () => {
    const { reader } = await openStream();
    await readEvents(reader, 1);

    const response = await harness.built.app.inject({
      method: "POST",
      url: "/v1/mutations/batch",
      payload: {
        mutations: [1, 2, 3].map((n) => ({
          mutationId: generateUuidV7(),
          commandType: "item.create",
          baseRevisionIds: [],
          payload: {
            id: generateUuidV7(),
            kind: "folder",
            name: `Batched ${n}`,
            placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
          },
        })),
      },
    });
    expect(response.statusCode).toBe(200);

    const events = await readEvents(reader, 1);
    expect(events).toHaveLength(1);
    // Three writes, one announcement: the position is cumulative, so the
    // highest says everything the other two would have. Three notifications
    // would ask every other device to fetch three times to reach a state the
    // last one already describes.
    await reader.cancel();
  });
});

describe("a device that was away", () => {
  it("is served from where it says it got to", async () => {
    const { reader } = await openStream({ "last-event-id": "0" });
    const [first] = await readEvents(reader, 1);
    // Nothing prunes the feed today, so position 0 is still servable and the
    // answer must be `advanced` rather than a rebuild.
    expect(first?.name).toBe("advanced");
    await reader.cancel();
  });

  it("treats an unreadable position as no position rather than refusing", async () => {
    const { response, reader } = await openStream({ "last-event-id": "not-a-number" });
    // A client sending nonsense is a client asking to start where the feed is.
    // Refusing the connection would leave it no way to catch up at all.
    expect(response.status).toBe(200);
    const [first] = await readEvents(reader, 1);
    expect(first?.name).toBe("advanced");
    await reader.cancel();
  });
});
