import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorFileTransferQueue } from "../src/features/editor/editor-files.ts";
import { FileSynchronizationStatus } from "../src/services/local-content.ts";

function response(init: {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}): Response {
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realtime file synchronization status", () => {
  it("keeps a confirmed document pending until both transfer and server requirement agree", () => {
    const pageId = generateUuidV7();
    const fileId = generateUuidV7();
    const status = new FileSynchronizationStatus();

    status.recordRequirements(pageId, [{ fileId, state: "upload-required" }]);
    status.recordTransfers(new Map([[fileId, { kind: "synchronized" as const }]]));
    expect([...status.pendingIds]).toEqual([fileId]);

    status.recordRequirements(pageId, [{ fileId, state: "present" }]);
    status.recordTransfers(new Map([[fileId, { kind: "verifying" as const }]]));
    expect([...status.pendingIds]).toEqual([fileId]);

    status.recordTransfers(new Map([[fileId, { kind: "synchronized" as const }]]));
    expect(status.pendingIds.size).toBe(0);
  });

  it("resumes a blocked upload and accepts only a verified matching identity", async () => {
    const fileId = generateUuidV7() as Uuid;
    let patchAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          return response({
            status: 201,
            headers: { location: `/v1/uploads/${fileId}` },
            body: { id: fileId },
          });
        }
        if (init.method === "HEAD") {
          return response({ headers: { "upload-offset": patchAttempts === 0 ? "0" : "2" } });
        }
        patchAttempts += 1;
        return patchAttempts === 1
          ? response({ status: 503 })
          : response({
              status: 201,
              headers: { "upload-offset": "4", "upload-complete": "true" },
              body: { itemId: fileId, verified: true },
            });
      }),
    );
    const queue = new EditorFileTransferQueue();
    const file = new File([new Uint8Array(4)], "resume.bin");
    queue.enqueue(fileId, file);

    await queue.flush();
    expect(queue.stateFor(fileId)).toMatchObject({ kind: "blocked" });

    await queue.flush();
    expect(queue.stateFor(fileId)).toEqual({ kind: "synchronized" });
  });
});
