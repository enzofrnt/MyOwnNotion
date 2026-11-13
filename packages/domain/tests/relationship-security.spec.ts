import { generateUuidV7, validateCreateRelationship } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("generic relationship ownership (057 T007)", () => {
  it.each(["database:property", "page:link"])(
    "rejects creation of managed %s rows",
    (relationType) => {
      const graph = new MemoryGraph();
      const sourceItemId = graph.addItem("page", "Source");
      const targetItemId = graph.addItem("page", "Target");
      const result = validateCreateRelationship((id) => graph.getItem(id), {
        id: generateUuidV7(),
        sourceItemId,
        targetItemId,
        relationType,
        metadata: { databaseId: generateUuidV7(), propertyId: generateUuidV7() },
      });
      expect(result).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
    },
  );

  it.each(["link:references", "embed:file", "database:reference"])(
    "preserves the custom vocabulary %s and authored metadata",
    (relationType) => {
      const graph = new MemoryGraph();
      const sourceItemId = graph.addItem("page", "Source");
      const targetItemId = graph.addItem("page", "Target");
      const metadata = { databaseId: generateUuidV7(), propertyId: generateUuidV7() };
      const result = validateCreateRelationship((id) => graph.getItem(id), {
        id: generateUuidV7(),
        sourceItemId,
        targetItemId,
        relationType,
        metadata,
      });
      expect(result).toMatchObject({ ok: true, value: { relationType, metadata } });
    },
  );
});
