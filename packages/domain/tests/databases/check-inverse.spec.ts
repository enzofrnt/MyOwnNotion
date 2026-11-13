import {
  createInitialDatabaseDefinition,
  generateUuidV7,
  validateDatabaseDefinition,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

describe("definition validation", () => {
  it("keeps inverseEdges on a relation config", () => {
    const base = createInitialDatabaseDefinition({
      type: "database.create",
      id: generateUuidV7(),
      name: "Base",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
      titlePropertyId: generateUuidV7(),
      initialViewId: generateUuidV7(),
      initialViewName: "Table",
    } as never);
    const candidate = {
      ...base,
      properties: [
        ...base.properties,
        {
          id: generateUuidV7(),
          name: "Inverse",
          type: "relation",
          positionKey: "b",
          state: "active",
          config: {
            cardinality: "many",
            targetSourceId: generateUuidV7(),
            reciprocalPropertyId: generateUuidV7(),
            inverseEdges: true,
          },
        },
      ],
    };
    const result = validateDatabaseDefinition(JSON.parse(JSON.stringify(candidate)));
    expect(result.ok).toBe(true);
    const relation = result.ok
      ? result.value.properties.find((property) => property.type === "relation")
      : undefined;
    expect(relation?.config).toMatchObject({ inverseEdges: true });
  });
});
