// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardCreateCard } from "../src/features/databases/board-create-card.tsx";

it("keeps the creation command mounted while pending, blocks duplicate clicks and allows retry after refusal", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const create = vi.fn(
    () =>
      new Promise<void>((success, failure) => {
        resolve = success;
        reject = failure;
      }),
  );
  try {
    await act(async () =>
      root.render(createElement(BoardCreateCard, { columnLabel: "Alpha", onCreate: create })),
    );
    const button = host.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error("Missing creation command");
    expect(button.textContent).toContain("Nouvel élément");
    await act(async () => {
      button.click();
      button.click();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(host.querySelector("button")).toBe(button);
    expect(host.querySelector(".database-board__create")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => reject(new Error("Refused")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Réessayez");
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(create).toHaveBeenCalledTimes(2);
    await act(async () => resolve());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("button")).toBe(button);
    expect(button.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
