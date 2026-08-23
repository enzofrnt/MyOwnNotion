// @vitest-environment jsdom
import type { DatabaseDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabasePage } from "../src/features/databases/database-page.tsx";

function input(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function database(): DatabaseDto {
  const databaseId = generateUuidV7();
  const titlePropertyId = generateUuidV7();
  return {
    databaseId,
    definitionRevisionId: generateUuidV7(),
    lifecycle: "active",
    name: "Projects",
    definition: {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId,
      properties: [
        {
          id: titlePropertyId,
          name: "Title",
          type: "title",
          positionKey: "a",
          state: "active",
          config: {},
        },
      ],
      views: [
        {
          id: generateUuidV7(),
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          properties: [{ propertyId: titlePropertyId, visible: true, positionKey: "a" }],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable", freezeTitle: true },
        },
      ],
      taskRoles: null,
    },
  } as DatabaseDto;
}

describe("database page interaction durability", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("submits the latest option text even before React commits its next render", async () => {
    const onReplaceDefinition = vi.fn();
    act(() =>
      root.render(
        <DatabasePage
          database={database()}
          entries={[]}
          onReplaceDefinition={onReplaceDefinition}
          onCreateEntry={vi.fn()}
          onOpenEntry={vi.fn()}
        />,
      ),
    );

    act(() => container.querySelector<HTMLButtonElement>(".database-page__header button")?.click());
    const name = container.querySelector<HTMLInputElement>("#property-name");
    expect(name).not.toBeNull();
    act(() => {
      if (name === null) return;
      input(name, "Status");
    });

    const type = container.querySelector<HTMLSelectElement>("#property-type");
    expect(type).not.toBeNull();
    act(() => {
      if (type === null) return;
      type.value = "status";
      type.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const options = container.querySelector<HTMLInputElement>(
      '.property-editor input[placeholder="Planned, In progress, Done"]',
    );
    const save = container.querySelector<HTMLButtonElement>(
      '.property-editor button[type="submit"]',
    );
    expect(options).not.toBeNull();
    expect(save).not.toBeNull();
    await act(async () => {
      if (options === null || save === null) return;
      input(options, "To do, Done");
      save.click();
      await Promise.resolve();
    });

    expect(onReplaceDefinition).toHaveBeenCalledTimes(1);
    const submitted = onReplaceDefinition.mock.calls[0]?.[0] as DatabaseDefinition;
    const status = submitted.properties.find((property) => property.name === "Status");
    expect(status?.type).toBe("status");
    expect(status?.config).toMatchObject({
      options: [{ label: "To do" }, { label: "Done" }],
    });
  });
});
