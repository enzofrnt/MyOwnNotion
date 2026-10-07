// @vitest-environment jsdom
import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardView } from "../src/features/databases/board-view.tsx";
import { DatabaseEntryActionsContext } from "../src/features/databases/database-entry-actions-context.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

async function mount(save: ReturnType<typeof vi.fn>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const axis = generateUuidV7(),
    option = generateUuidV7(),
    checkbox = generateUuidV7(),
    hidden = generateUuidV7();
  const properties: readonly DatabaseProperty[] = [
    {
      id: axis,
      name: "Status",
      type: "status",
      state: "active",
      positionKey: "a",
      config: { options: [{ id: option, label: "Todo", state: "active", positionKey: "a" }] },
    },
    { id: hidden, name: "Details", type: "text", state: "active", positionKey: "b", config: {} },
    {
      id: checkbox,
      name: "Reviewed",
      type: "checkbox",
      state: "active",
      positionKey: "c",
      config: {},
    },
  ];
  const view: Extract<DatabaseView, { type: "board" }> = {
    id: generateUuidV7(),
    name: "Board",
    type: "board",
    state: "active",
    positionKey: "a",
    properties: [{ propertyId: checkbox, visible: true, positionKey: "a" }],
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: { propertyId: axis },
    options: { axisPropertyId: axis, columnOrder: [option], collapsedColumnIds: [] },
  };
  const page: DatabaseViewPage = {
    databaseId: generateUuidV7(),
    definitionRevisionId: generateUuidV7(),
    viewId: view.id,
    generation: 1,
    coverage: "complete",
    availableCount: 2,
    expectedCount: 2,
    rows: ["Alpha", "Beta"].map((title) => ({
      entryId: generateUuidV7(),
      revisionId: generateUuidV7(),
      title,
      values: { [axis]: { kind: "status", optionId: option } },
      relationTargets: {},
      groupId: option,
      syncState: "synced",
    })),
    groups: [],
    nextCursor: null,
    source: "local",
    staleCursorRecovered: false,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const open = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        DatabaseEntryActionsContext.Provider,
        {
          value: {
            save,
            relationOptions: [],
            convert: vi.fn(),
            trash: vi.fn(),
            editIcon: vi.fn(),
            openFullPage: vi.fn(),
          },
        },
        createElement(BoardView, {
          properties,
          view,
          page,
          onOpenEntry: open,
          onUpdateEntry: vi.fn(),
          onChangeView: vi.fn(),
        }),
      ),
    ),
  );
  return {
    host,
    checkbox,
    hidden,
    open,
    destroy: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

async function pencil(host: HTMLElement, name: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Modifier ${name}"]`);
  if (!button) throw new Error(`Missing pencil for ${name}`);
  await act(async () => {
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.click();
    await pause();
  });
}

async function title(host: HTMLElement, value: string) {
  const text = host.querySelector<HTMLElement>('[role="textbox"]');
  if (!text) throw new Error("Missing editable title");
  await act(async () => {
    text.textContent = value;
    text.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

it("edits a visible property without expanding or opening the entry, then retains its control when revealing hidden fields", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const ui = await mount(save);
  try {
    const field = ui.host.querySelector<HTMLInputElement>('input[aria-label="Reviewed"]');
    if (!field) throw new Error("Missing visible property");
    expect(ui.host.querySelector('[role="textbox"]')).toBeNull();
    await act(async () => {
      field.click();
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1].changedPropertyIds).toEqual([ui.checkbox]);
    expect(ui.open).not.toHaveBeenCalled();
    await pencil(ui.host, "Alpha");
    expect(ui.host.querySelector('input[aria-label="Reviewed"]')).toBe(field);
    expect(field.checked).toBe(true);
    expect(ui.host.querySelector('input[aria-label="Details"]')).not.toBeNull();
    const fields = [...(ui.host.querySelector(".database-card-editor__fields")?.children ?? [])];
    expect(fields[0]?.contains(field)).toBe(true);
    const textbox = ui.host.querySelector('[role="textbox"]');
    expect(textbox?.textContent).toBe("Alpha");
    const selection = window.getSelection();
    if (!textbox || !selection?.focusNode) throw new Error("Missing title caret");
    const beforeCaret = document.createRange();
    beforeCaret.selectNodeContents(textbox);
    beforeCaret.setEnd(selection.focusNode, selection.focusOffset);
    expect(beforeCaret.toString()).toBe("Alpha");
  } finally {
    ui.destroy();
  }
});

it("waits for an in-flight property and the latest title before opening another card's pencil", async () => {
  const finish: Array<() => void> = [];
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish.push(resolve);
      }),
  );
  const ui = await mount(save);
  try {
    await act(async () => {
      ui.host.querySelector<HTMLInputElement>('input[aria-label="Reviewed"]')?.click();
      await pause();
    });
    await pencil(ui.host, "Alpha");
    await title(ui.host, "Alpha updated");
    await pencil(ui.host, "Beta");
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Alpha updated");
    await act(async () => {
      finish[0]?.();
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1].title).toBe("Alpha updated");
    expect(save.mock.calls[1]?.[0].values[ui.checkbox]).toEqual({
      kind: "checkbox",
      checked: true,
    });
    await act(async () => {
      finish[1]?.();
      await pause();
    });
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Beta");
    expect(ui.host.querySelectorAll('[data-editing="true"]')).toHaveLength(1);
  } finally {
    ui.destroy();
  }
});

it("keeps the first card expanded while pressing or focusing the next pencil, and switches only on activation", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const ui = await mount(save);
  try {
    await pencil(ui.host, "Alpha");
    const next = ui.host.querySelector<HTMLButtonElement>('button[aria-label="Modifier Beta"]');
    if (!next) throw new Error("Missing second pencil");
    const icon = next.querySelector("svg");
    if (!icon) throw new Error("Missing pencil icon");
    await act(async () => {
      icon.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      next.focus();
      await pause();
    });
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Alpha");
    expect(ui.host.querySelectorAll('[data-editing="true"]')).toHaveLength(1);
    // Release away from the pencil: no native click, and no premature switch.
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await pause();
    });
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Alpha");
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      next.click();
      await pause();
    });
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Beta");
    expect(ui.host.querySelectorAll('[data-editing="true"]')).toHaveLength(1);
    // Ordinary outside interaction still closes the expanded card.
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await pause();
    });
    expect(ui.host.querySelector('[role="textbox"]')).toBeNull();
  } finally {
    ui.destroy();
  }
});

it("keeps a refused title on its card and allows switching after retry succeeds", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Refused")).mockResolvedValue(undefined);
  const ui = await mount(save);
  try {
    await pencil(ui.host, "Alpha");
    await title(ui.host, "Keep this draft");
    await pencil(ui.host, "Beta");
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Keep this draft");
    expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain("conservée");
    await act(async () => {
      [...ui.host.querySelectorAll("button")].find((b) => b.textContent === "Réessayer")?.click();
      await pause();
    });
    await pencil(ui.host, "Beta");
    expect(ui.host.querySelector('[role="textbox"]')?.textContent).toBe("Beta");
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    ui.destroy();
  }
});
