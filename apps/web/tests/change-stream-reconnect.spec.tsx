// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChangeStream } from "../src/features/sync/use-change-stream.ts";
import type { LocalContentService } from "../src/services/local-content.ts";

class Stream extends EventTarget {
  static readonly CLOSED = 2;
  static instances: Stream[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    super();
    Stream.instances.push(this);
  }
  close() {
    this.readyState = Stream.CLOSED;
  }
}
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  Stream.instances = [];
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", Stream);
  let applied = "4";
  const synchronize = vi.fn(async () => {
    applied = "7";
    return "synced";
  });
  const service = {
    api: { changeStreamUrl: () => "/v1/changes/stream" },
    repository: { getLastChangeCursor: async () => applied },
    synchronize,
    getSnapshot: () => ({ syncState: "synced" }),
  } as unknown as LocalContentService;
  const Consumer = () => {
    useChangeStream(service);
    return null;
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Consumer />));
  return { synchronize };
}
describe("workspace recovery after external CLI writes", () => {
  it("pulls from its applied cursor on reconnect announcements and ignores an already applied cursor", async () => {
    const { synchronize } = await mount();
    const stream = Stream.instances[0];
    await act(async () => {
      stream?.dispatchEvent(
        new MessageEvent("advanced", { data: JSON.stringify({ cursor: "7" }) }),
      );
    });
    expect(synchronize).toHaveBeenCalledOnce();
    await act(async () => {
      stream?.dispatchEvent(
        new MessageEvent("advanced", { data: JSON.stringify({ cursor: "7" }) }),
      );
    });
    expect(synchronize).toHaveBeenCalledOnce();
  });
  it("reopens a closed connection and synchronizes workspace metadata immediately on online", async () => {
    const { synchronize } = await mount();
    Stream.instances[0]?.close();
    expect(synchronize).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(Stream.instances).toHaveLength(2);
    expect(synchronize).toHaveBeenCalledOnce();
  });
});
