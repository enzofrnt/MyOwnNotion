// @vitest-environment jsdom
import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardView } from "../src/features/databases/board-view.tsx";
import type { DatabaseViewPage } from "../src/services/databases.ts";

it("blocks repeated moves while pending, shows a refusal without claiming success and allows retry", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const propertyId = generateUuidV7(),
    a = generateUuidV7(),
    b = generateUuidV7(),
    viewId = generateUuidV7();
  const property: DatabaseProperty = {
    id: propertyId,
    name: "Matières",
    type: "multi-select",
    state: "active",
    positionKey: "a",
    config: {
      options: [a, b].map((id, i) => ({
        id,
        label: i === 0 ? "Alpha" : "Beta",
        tone: "blue",
        state: "active",
        positionKey: String(i),
      })),
    },
  };
  const view: Extract<DatabaseView, { type: "board" }> = {
    id: viewId,
    name: "Matières",
    type: "board",
    positionKey: "a",
    state: "active",
    properties: [],
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: { propertyId },
    options: { axisPropertyId: propertyId, columnOrder: [a, b], collapsedColumnIds: [] },
  };
  const page: DatabaseViewPage = {
    databaseId: generateUuidV7(),
    definitionRevisionId: generateUuidV7(),
    viewId,
    generation: 1,
    coverage: "complete",
    availableCount: 1,
    expectedCount: 1,
    rows: [
      {
        entryId: generateUuidV7(),
        revisionId: generateUuidV7(),
        title: "Shared task",
        values: { [propertyId]: { kind: "multi-select", optionIds: [a] } },
        relationTargets: {},
        groupId: a,
        syncState: "synced",
      },
    ],
    groups: [],
    nextCursor: null,
    source: "local",
    staleCursorRecovered: false,
  };
  let reject: (e: Error) => void = () => {};
  const update = vi.fn(
    () =>
      new Promise<void>((_, failure) => {
        reject = failure;
      }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(BoardView, {
          properties: [property],
          view,
          page,
          onOpenEntry: vi.fn(),
          onChangeView: vi.fn(),
          onUpdateEntry: update,
        }),
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(".database-card__menu");
    if (!trigger) throw new Error("Missing move menu");
    const open = async () => {
      await act(async () => {
        trigger.click();
        await new Promise((r) => setTimeout(r, 60));
      });
      const move = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
        item.textContent?.includes("Déplacer dans un groupe"),
      );
      if (!move) throw new Error("Missing grouping destinations menu");
      await act(async () => move.click());
      const choice = document.querySelector<HTMLElement>(`[data-board-destination="${b}"]`);
      if (!choice) throw new Error("Missing destination");
      return choice;
    };
    const choice = await open();
    expect(document.querySelector(".database-board-menu")?.textContent).toContain(
      "Retirer toutes les sélections",
    );
    await act(async () => choice.click());
    expect(update).toHaveBeenCalledWith(page.rows[0]?.entryId, {
      kind: "property",
      propertyId,
      optionMove: { from: a, to: b },
    });
    const pendingChoice = await open();
    expect(pendingChoice.getAttribute("aria-disabled")).toBe("true");
    await act(async () => pendingChoice.click());
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Refused")));
    expect(host.querySelector('.database-board-scroll > p[role="status"]')?.textContent).toContain(
      "n'a pas pu être déplacé",
    );
    expect(pendingChoice.getAttribute("aria-disabled")).not.toBe("true");
    expect(host.querySelector(`[data-board-column="${a}"] .database-card`)).not.toBeNull();
    await act(async () => pendingChoice.click());
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => reject(new Error("Refused")));
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
