import type { McpAction, McpScope } from "@myownnotion/contracts";
import type { ItemReadModel } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { expect, it } from "vitest";
import { requireMcpAction, scopedMcpItem } from "../src/mcp/scope.ts";

const actions: McpAction[] = ["search", "read", "create", "edit", "delete"];

it.each(actions)("grants %s independently from every other action", (selected) => {
  const scope: McpScope = {
    actions: [selected],
    allContent: true,
    branchRootIds: [],
    files: true,
  };
  for (const action of actions) {
    if (action === selected) expect(() => requireMcpAction(scope, action)).not.toThrow();
    else expect(() => requireMcpAction(scope, action)).toThrow();
  }
});

it("redacts nested private page/database/file references without modifying canonical content", () => {
  const id = generateUuidV7();
  const allowed = generateUuidV7();
  const privateId = generateUuidV7();
  const item: ItemReadModel = {
    id,
    kind: "page",
    name: "Visible page",
    icon: null,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: false,
    file: null,
    placements: [null, allowed, privateId].map((parentItemId) => ({
      id: generateUuidV7(),
      itemId: id,
      kind: "hierarchy",
      parentItemId,
      positionKey: "a",
    })),
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: {
        blocks: [
          { type: "paragraph", content: [{ text: "Kept text" }] },
          ...["targetItemId", "fileItemId", "databaseId", "pageId"].map((field) => ({
            children: [{ props: { [field]: privateId, caption: "Private reference caption" } }],
          })),
          { props: { targetItemId: allowed, caption: "Allowed link" } },
          { props: { targetItemId: null }, values: [null, true, 5, "literal"] },
        ],
      },
    },
  };
  const before = structuredClone(item);
  const scope = new Set([id, allowed]);
  const result = scopedMcpItem(item, scope);
  expect(JSON.stringify(result)).not.toContain(privateId);
  expect(JSON.stringify(result)).not.toContain("Private reference caption");
  expect(JSON.stringify(result)).toContain("unavailable-reference");
  expect(JSON.stringify(result)).toContain("Kept text");
  expect(JSON.stringify(result)).toContain("Allowed link");
  expect(result.placements.map((placement) => placement.parentItemId)).toEqual([null, allowed]);
  expect(item).toEqual(before);
  expect(scopedMcpItem(item, new Set([id, allowed, privateId])).pageDocument).toEqual(
    item.pageDocument,
  );
});
