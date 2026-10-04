// @vitest-environment jsdom
import type { DatabaseProperty } from "@myownnotion/domain";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PropertyConfiguration } from "../src/features/databases/property-configuration.tsx";
import { reviewId } from "../src/ui/ui-lab-review-fixtures.ts";

const cases = [
  ["select", { options: [] }, "Autoriser plusieurs options", "multi-select", { options: [] }],
  ["multi-select", { options: [] }, "Autoriser plusieurs options", "select", { options: [] }],
  ["date", { mode: "date" }, "Inclure l’heure", "date", { mode: "instant" }],
  ["date", { mode: "instant" }, "Inclure l’heure", "date", { mode: "date" }],
  [
    "relation",
    { cardinality: "one" },
    "Autoriser plusieurs pages",
    "relation",
    { cardinality: "many" },
  ],
  [
    "relation",
    { cardinality: "many" },
    "Autoriser plusieurs pages",
    "relation",
    { cardinality: "one" },
  ],
] as const;

describe("property toggles during asynchronous source updates", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  it.each(cases)(
    "retains the chosen %s setting until the source read completes (%s)",
    async (type, config, label, expectedType, expectedConfig) => {
      const initial = {
        id: reviewId(81),
        type,
        config,
        name: "Property",
        state: "active",
        positionKey: "a0",
      } as DatabaseProperty;
      let pending: ((property: DatabaseProperty) => DatabaseProperty) | undefined;
      let committed: DatabaseProperty | undefined;
      let finish: () => void = () => {};
      function Harness() {
        const [property, setProperty] = useState(initial);
        finish = () => {
          if (pending === undefined) throw new Error("Missing asynchronous source edit");
          committed = pending(property);
          setProperty(committed);
        };
        return (
          <PropertyConfiguration
            property={property}
            anchor={new DOMRect(0, 0, 140, 30)}
            open
            structure
            onClose={() => {}}
            onOptions={() => {}}
            onDuplicate={() => {}}
            onRetire={() => {}}
            onChange={(edit) => {
              pending = edit;
            }}
          />
        );
      }
      await act(async () => root.render(<Harness />));
      const input = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        (node) => node.parentElement?.textContent?.trim() === label,
      );
      if (input === undefined) throw new Error(`Missing ${label}`);
      const checked = input.checked;
      act(() => input.click());
      // React restores a controlled field while the source is being read. The
      // command must retain the gesture's value rather than reading this DOM later.
      expect(input.checked).toBe(checked);
      await act(async () => finish());
      expect(committed).toMatchObject({ type: expectedType, config: expectedConfig });
      expect(input.checked).toBe(!checked);
    },
  );
});
