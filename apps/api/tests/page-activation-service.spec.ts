import type { Database } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { PageActivationService } from "../src/page-state/page-activation-service.ts";

describe("active checkpoint reads", () => {
  it("reads state, checkpoint and following updates from one PostgreSQL snapshot", async () => {
    const interrupted = new Error("stop after observing the transaction boundary");
    const transaction = vi.fn().mockRejectedValue(interrupted);
    const service = new PageActivationService({
      db: { transaction } as unknown as Database,
      workspaceId: generateUuidV7(),
      crypto: {} as never,
      protectedContent: {} as never,
      rotationPolicies: {} as never,
    });

    await expect(
      service.checkpointResponse({
        pageId: generateUuidV7(),
        requestId: generateUuidV7(),
        maxRemoteBytes: 1024,
      }),
    ).rejects.toBe(interrupted);

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  });
});
