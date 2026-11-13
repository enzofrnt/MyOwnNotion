import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { displayDatabaseValue } from "../src/features/databases/database-value.ts";

describe("status default option", () => {
  it("shows the default option on an empty status cell", () => {
    const property: DatabaseProperty = {
      id: "018f4000-0000-7000-8000-000000000010" as Uuid,
      name: "État",
      type: "status",
      positionKey: "a",
      state: "active",
      config: {
        options: [
          {
            id: "018f4000-0000-7000-8000-000000000011" as Uuid,
            label: "Pas commencé",
            positionKey: "a",
            tone: "gray",
            state: "active",
            group: "todo",
          },
          {
            id: "018f4000-0000-7000-8000-000000000012" as Uuid,
            label: "En cours",
            positionKey: "b",
            tone: "blue",
            state: "active",
            group: "in-progress",
          },
        ],
        defaultOptionId: "018f4000-0000-7000-8000-000000000012" as Uuid,
      },
    };
    const row = {
      entryId: "018f4000-0000-7000-8000-000000000013" as Uuid,
      revisionId: "018f4000-0000-7000-8000-000000000014" as Uuid,
      title: "Ligne",
      values: {},
      relationTargets: {},
      groupId: null,
    } as never;
    expect(displayDatabaseValue(row, property)).toBe("En cours");
  });
});
