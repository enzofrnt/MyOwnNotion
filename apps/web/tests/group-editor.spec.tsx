// @vitest-environment jsdom
import { type DatabaseProperty, type DatabaseView, generateUuidV7 } from "@myownnotion/domain";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GroupEditor, withGroupingProperty } from "../src/features/databases/group-editor.tsx";

const statusId = generateUuidV7();
const subjectId = generateUuidV7();
const optionId = generateUuidV7();
const properties: readonly DatabaseProperty[] = [
  {
    id: statusId,
    name: "État",
    type: "status",
    state: "active",
    positionKey: "a",
    config: { options: [] },
  },
  {
    id: subjectId,
    name: "Matière",
    type: "multi-select",
    state: "active",
    positionKey: "b",
    config: { options: [] },
  },
  {
    id: generateUuidV7(),
    name: "Retirée",
    type: "select",
    state: "retired",
    positionKey: "c",
    config: { options: [] },
  },
  {
    id: generateUuidV7(),
    name: "Texte",
    type: "text",
    state: "active",
    positionKey: "d",
    config: {},
  },
];
const view: Extract<DatabaseView, { type: "board" }> = {
  id: generateUuidV7(),
  name: "Par état",
  type: "board",
  state: "active",
  positionKey: "a",
  properties: [{ propertyId: subjectId, visible: false, positionKey: "a" }],
  filter: { mode: "all", criteria: [] },
  sorts: [{ propertyId: statusId, direction: "descending", missing: "first" }],
  group: { propertyId: statusId },
  options: { axisPropertyId: statusId, columnOrder: [optionId], collapsedColumnIds: [optionId] },
};

it("changes only grouping and the old axis layout, preserving filters, sorting and hidden properties", () => {
  const changed = withGroupingProperty(view, subjectId);
  expect(changed).toEqual({
    ...view,
    group: { propertyId: subjectId },
    options: { axisPropertyId: subjectId, columnOrder: [], collapsedColumnIds: [] },
  });
  expect(withGroupingProperty(view, statusId)).toEqual(view);
  expect(withGroupingProperty(view, null)).toBe(view);
  const table: DatabaseView = {
    ...view,
    type: "table",
    options: { density: "compact", freezeTitle: true },
  };
  expect(withGroupingProperty(table, null)).toEqual({ ...table, group: null });
});

it("applies from the selector once, retains a refused choice for retry and excludes unavailable properties", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let reject: (error: Error) => void = () => {};
  const onChange = vi.fn(
    () =>
      new Promise<void>((_, failure) => {
        reject = failure;
      }),
  );
  try {
    await act(async () => root.render(createElement(GroupEditor, { properties, view, onChange })));
    const trigger = host.querySelector<HTMLButtonElement>("button");
    if (!trigger) throw new Error("Missing selector");
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).not.toMatch(/Retirée|Texte|Aucun/);
    const choice = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Matière",
    );
    if (!choice) throw new Error("Missing grouping choice");
    await act(async () => choice.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]).toEqual([withGroupingProperty(view, subjectId)]);
    expect(trigger.disabled).toBe(true);
    await act(async () => trigger.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("Refused")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Matière");
    expect(trigger.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Réessayer",
    );
    if (!retry) throw new Error("Missing retry");
    await act(async () => retry.click());
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1]).toEqual([withGroupingProperty(view, subjectId)]);
    await act(async () => reject(new Error("Refused again")));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
