/**
 * Mutation idempotency and validation rejection unit tests (T069, US4).
 */

import {
  COMMAND_TYPES,
  generateUuidV7,
  type MutationRecord,
  parseMutationCommand,
  replayResult,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("typed mutation dispatch (T073)", () => {
  it("parses every owned command type", () => {
    const itemId = generateUuidV7();
    const revisionId = generateUuidV7();
    const samples: Record<string, Record<string, unknown>> = {
      "item.create": {
        id: generateUuidV7(),
        kind: "page",
        name: "n",
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      },
      "item.rename": { itemId, name: "renamed" },
      "item.trash": { itemId },
      "item.restore": { itemId },
      "placement.move": { placementId: generateUuidV7(), parentItemId: null, positionKey: "V" },
      "placement.remove": { placementId: generateUuidV7() },
      "file.placement.add": {
        itemId,
        kind: "attachment",
        parentItemId: generateUuidV7(),
        positionKey: "V",
      },
      "page.document.replace": {
        itemId,
        baseRevisionId: revisionId,
        document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      },
      "relationship.create": {
        id: generateUuidV7(),
        sourceItemId: itemId,
        targetItemId: generateUuidV7(),
        relationType: "link:references",
      },
      "relationship.remove": { relationshipId: generateUuidV7() },
      "revision.restore": { revisionId, currentRevisionId: generateUuidV7() },
    };
    for (const commandType of COMMAND_TYPES) {
      const payload = samples[commandType];
      expect(payload, `sample for ${commandType}`).toBeDefined();
      const parsed = parseMutationCommand(commandType, payload as Record<string, unknown>);
      expect(parsed.ok, `${commandType} should parse`).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.type).toBe(commandType);
      }
    }
  });

  it("rejects unknown command types", () => {
    const parsed = parseMutationCommand("workspace.explode", {});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("validation.invalid-payload");
    }
  });

  it("rejects payloads that do not match their command type", () => {
    const mismatches: Array<[string, Record<string, unknown>]> = [
      ["item.create", { id: "not-a-uuid", kind: "page", name: "x" }],
      ["item.create", { id: generateUuidV7(), kind: "file", name: "x" }],
      ["item.rename", { itemId: generateUuidV7() }],
      ["placement.move", { placementId: generateUuidV7(), parentItemId: 42, positionKey: "V" }],
      [
        "page.document.replace",
        { itemId: generateUuidV7(), baseRevisionId: generateUuidV7(), document: { format: "md" } },
      ],
      ["relationship.create", { id: generateUuidV7(), sourceItemId: generateUuidV7() }],
      ["revision.restore", { revisionId: generateUuidV7() }],
    ];
    for (const [commandType, payload] of mismatches) {
      const parsed = parseMutationCommand(commandType, payload);
      expect(parsed.ok, `${commandType} should reject`).toBe(false);
    }
  });

  it("restore with explicit null fallback is distinguished from no fallback", () => {
    const itemId = generateUuidV7();
    const withNull = parseMutationCommand("item.restore", {
      itemId,
      fallbackParentItemId: null,
    });
    const without = parseMutationCommand("item.restore", { itemId });
    expect(withNull.ok && without.ok).toBe(true);
    if (withNull.ok && without.ok && withNull.value.type === "item.restore") {
      expect("fallbackParentItemId" in withNull.value).toBe(true);
      expect(without.value.type === "item.restore" && "fallbackParentItemId" in without.value).toBe(
        false,
      );
    }
  });
});

describe("idempotent replay semantics (FR-040)", () => {
  const base: MutationRecord = {
    id: generateUuidV7(),
    workspaceId: generateUuidV7(),
    commandType: "item.create",
    status: "accepted",
    submittedAt: new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    resultRevisionIds: [generateUuidV7()],
    failureCode: null,
  };

  it("an accepted mutation replays already-accepted with the prior revisions", () => {
    const replay = replayResult(base);
    expect(replay.status).toBe("already-accepted");
    expect(replay.revisionIds).toEqual(base.resultRevisionIds);
  });

  it("a rejected mutation replays rejected", () => {
    const replay = replayResult({
      ...base,
      status: "rejected",
      resultRevisionIds: [],
      failureCode: "validation.invalid-payload",
    });
    expect(replay.status).toBe("rejected");
  });

  it("a conflict rejection replays as conflict", () => {
    for (const failureCode of ["mutation.conflict", "revision.stale-base"]) {
      const replay = replayResult({
        ...base,
        status: "rejected",
        resultRevisionIds: [],
        failureCode,
      });
      expect(replay.status).toBe("conflict");
    }
  });

  it("preserves the recorded failure code so the reason survives a replay", () => {
    // Flattening every rejection to a generic code loses the only signal a
    // client has for telling a competing revision from a bad command, and it
    // classifies its durable conflict record wrongly (FR-042).
    for (const failureCode of [
      "revision.stale-base",
      "mutation.conflict",
      "validation.invalid-payload",
      "containment.cycle-rejected",
    ]) {
      const replay = replayResult({
        ...base,
        status: "rejected",
        resultRevisionIds: [],
        failureCode,
      });
      expect(replay.problem?.code).toBe(failureCode);
    }
  });

  it("returns the recorded competing identities so a replay can still be resolved", () => {
    // Without these, a client whose first response was lost keeps the local
    // work but has nothing to compare it against (FR-042).
    const competing = [generateUuidV7(), generateUuidV7()];
    const replay = replayResult({
      ...base,
      status: "rejected",
      resultRevisionIds: [],
      failureCode: "revision.stale-base",
      competingRevisionIds: competing,
    });
    expect(replay.status).toBe("conflict");
    expect(replay.competingRevisionIds).toEqual(competing);
    expect(replay.problem?.competingRevisionIds).toEqual(competing);
  });

  it("omits competing identities when none were recorded", () => {
    const replay = replayResult({
      ...base,
      status: "rejected",
      resultRevisionIds: [],
      failureCode: "validation.invalid-payload",
      competingRevisionIds: [],
    });
    expect(replay.competingRevisionIds).toBeUndefined();
  });

  it("falls back to a generic code only when none was recorded", () => {
    const replay = replayResult({
      ...base,
      status: "rejected",
      resultRevisionIds: [],
      failureCode: null,
    });
    expect(replay.status).toBe("rejected");
    expect(replay.problem?.code).toBe("mutation.rejected");
  });
});
