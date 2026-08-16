/**
 * The guarantees an accepted write carries, and how a refusal is reported.
 *
 * Written after all three of these went wrong at once, and each assertion here
 * corresponds to one of them:
 *
 *   - a route that submits a mutation without the guards, which is how the
 *     offline batch route came to enforce neither the rotation block nor
 *     sealing while every single-command route enforced both;
 *   - a refusal reported as an unexpected server error, which is how the block
 *     came to be enforced and never explicable to the client;
 *   - a refusal reported for the whole batch rather than per mutation, which
 *     would leave the client unable to tell which of its queued writes were
 *     refused, and retrying all of them.
 *
 * See docs/architecture/write-guarantees.md.
 */

import { describe, expect, it, vi } from "vitest";
import { acceptedWriteGuards } from "../src/plugins/mutations.ts";
import { RotationWriteBlockedError } from "../src/security/rotation-policy-service.ts";

const command = {
  type: "item.rename" as const,
  itemId: "01a00b44-06d6-7000-b69e-dd075224d0f8" as never,
  name: "renamed",
};

describe("the guards attached to an accepted write", () => {
  it("attaches nothing when there is no security layer", () => {
    // A feature-001 harness builds an app with no deployment key and must keep
    // writing: there is nothing to seal and no policy to consult.
    expect(acceptedWriteGuards(command, undefined, undefined)).toEqual({});
  });

  it("consults the rotation policy inside the transaction", async () => {
    const assertWritesAllowed = vi.fn(async () => {});
    const guards = acceptedWriteGuards(
      command,
      { sealItemName: vi.fn(async () => {}) } as never,
      { assertWritesAllowed } as never,
    );

    const tx = {} as never;
    await guards.onAccepted?.(tx, { revisionIds: [] });

    // The transaction handle itself is passed on, not a fresh connection. A
    // check made outside the transaction can be overtaken by a block committing
    // in between, and the write it let through would be sealed under a key the
    // policy had already stopped.
    expect(assertWritesAllowed).toHaveBeenCalledWith(tx);
  });

  it("does not seal when the policy refuses", async () => {
    const sealItemName = vi.fn(async () => {});
    const guards = acceptedWriteGuards(
      command,
      { sealItemName } as never,
      {
        assertWritesAllowed: async () => {
          throw new RotationWriteBlockedError("data-key");
        },
      } as never,
    );

    await expect(guards.onAccepted?.({} as never, { revisionIds: [] })).rejects.toBeInstanceOf(
      RotationWriteBlockedError,
    );
    // The throw is what rolls the mutation back, so a refused write leaves
    // neither content nor envelope behind.
    expect(sealItemName).not.toHaveBeenCalled();
  });
});

describe("how a blocked write describes itself", () => {
  it("names the rotation that has to complete", () => {
    const error = new RotationWriteBlockedError("data-key");
    // The client shows this reason verbatim. "Something went wrong" would leave
    // an owner unable to tell an outage from a key rotation, which are the two
    // situations with opposite right answers.
    expect(error.message).toMatch(/data-key/);
    expect(error.kind).toBe("data-key");
  });
});
