/**
 * Mutation idempotency and validation rejection unit tests (T069, US4).
 */

import {
  asUuid,
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
      [
        "item.create",
        {
          id: generateUuidV7(),
          kind: "page",
          name: "x",
          placement: "not-an-object",
        },
      ],
      [
        "item.create",
        {
          id: generateUuidV7(),
          kind: "page",
          name: "x",
          placement: { kind: "invalid", parentItemId: null, positionKey: "V" },
        },
      ],
      [
        "item.create",
        {
          id: generateUuidV7(),
          kind: "page",
          name: "x",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "" },
        },
      ],
      [
        "item.create",
        {
          id: generateUuidV7(),
          kind: "page",
          name: "x",
          placement: {
            id: "invalid",
            kind: "hierarchy",
            parentItemId: null,
            positionKey: "V",
          },
        },
      ],
      ["item.trash", { itemId: "invalid" }],
      ["item.restore", { itemId: "invalid" }],
      ["item.restore", { itemId: generateUuidV7(), fallbackParentItemId: "invalid" }],
      ["item.rename", { itemId: generateUuidV7() }],
      ["placement.move", { placementId: generateUuidV7(), parentItemId: 42, positionKey: "V" }],
      ["placement.remove", { placementId: "invalid" }],
      [
        "file.placement.add",
        { itemId: "invalid", kind: "hierarchy", parentItemId: null, positionKey: "V" },
      ],
      [
        "page.document.replace",
        { itemId: generateUuidV7(), baseRevisionId: generateUuidV7(), document: { format: "md" } },
      ],
      ["relationship.create", { id: generateUuidV7(), sourceItemId: generateUuidV7() }],
      [
        "relationship.create",
        {
          id: generateUuidV7(),
          sourceItemId: generateUuidV7(),
          targetItemId: generateUuidV7(),
          relationType: "references",
          metadata: null,
        },
      ],
      ["relationship.remove", { relationshipId: "invalid" }],
      ["revision.restore", { revisionId: generateUuidV7() }],
    ];
    for (const [commandType, payload] of mismatches) {
      const parsed = parseMutationCommand(commandType, payload);
      expect(parsed.ok, `${commandType} should reject`).toBe(false);
    }
  });

  it("brands only valid UUID strings", () => {
    const id = generateUuidV7();
    expect(asUuid(id)).toBe(id);
    expect(() => asUuid("invalid")).toThrow(TypeError);
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
});
