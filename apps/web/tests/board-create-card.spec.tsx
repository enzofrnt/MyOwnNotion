// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardCreateCard } from "../src/features/databases/board-create-card.tsx";

it("keeps the draft after refusal, blocks repeated Enter while pending, and cancels the next blank draft", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const create = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  const enter = (input: HTMLElement) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  try {
    await act(async () =>
      root.render(
        createElement(BoardCreateCard, {
          columnLabel: "Alpha",
          canCreateFolder: true,
          onCreate: create,
        }),
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>(".database-board__add")?.click());
    const input = host.querySelector<HTMLElement>('[role="textbox"]');
    if (!input) throw new Error("Missing draft");
    await act(async () => {
      input.textContent = "First card";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      enter(input);
      enter(input);
    });
    expect(create).toHaveBeenCalledExactlyOnceWith("page", "First card", {}, {});
    await act(async () => fail?.(new Error("Refused")));
    expect(input.textContent).toBe("First card");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("conservé");
    await act(async () => enter(input));
    expect(create).toHaveBeenCalledTimes(2);
    await act(async () => finish?.());
    expect(host.querySelector('[role="textbox"]')?.textContent).toBe("");
    await act(async () =>
      host
        .querySelector('[role="textbox"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(host.querySelector('[role="textbox"]')).toBeNull();
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("keeps creation open across property focus and commits type, column, date, checkbox and relation together", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const create = vi.fn(async () => undefined);
  const checkboxId = "00000000-0000-7000-8000-000000000001" as import("@myownnotion/domain").Uuid;
  const axisId = "00000000-0000-7000-8000-000000000002" as import("@myownnotion/domain").Uuid;
  const dateId = "00000000-0000-7000-8000-000000000004" as import("@myownnotion/domain").Uuid;
  const relationId = "00000000-0000-7000-8000-000000000005" as import("@myownnotion/domain").Uuid;
  const targetId = "00000000-0000-7000-8000-000000000006" as import("@myownnotion/domain").Uuid;
  const optionId = "00000000-0000-7000-8000-000000000003";
  try {
    await act(async () =>
      root.render(
        createElement(BoardCreateCard, {
          columnLabel: "Alpha",
          canCreateFolder: true,
          onCreate: create,
          relationOptions: [{ id: targetId, label: "Related page" }],
          properties: [
            {
              id: checkboxId,
              name: "Reviewed",
              type: "checkbox",
              config: {},
              state: "active",
              positionKey: "a",
            },
            {
              id: dateId,
              name: "Due date",
              type: "date",
              config: { mode: "instant" },
              state: "active",
              positionKey: "b",
            },
            {
              id: relationId,
              name: "Related",
              type: "relation",
              config: { cardinality: "one" },
              state: "active",
              positionKey: "c",
            },
          ],
          initialValues: { [axisId]: { kind: "status", optionId } },
        }),
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>(".database-board__add")?.click());
    const title = host.querySelector<HTMLElement>('[role="textbox"]');
    if (!title) throw new Error("Missing title");
    await act(async () => {
      title.textContent = "Complete draft";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title.blur();
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Dossier"))?.click();
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Due date"]')?.click(),
    );
    const date =
      host.querySelector<HTMLInputElement>(`#database-value-${dateId}`) ??
      [...host.querySelectorAll<HTMLInputElement>("input")].find((i) =>
        i.id.startsWith(`database-value-${dateId}`),
      );
    if (!date) throw new Error("Missing date");
    await act(async () => {
      date.value = "2026-10-08T09:00";
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Related"]')?.click());
    await act(async () => document.querySelector<HTMLElement>('[role="menuitemradio"]')?.click());
    expect(create).not.toHaveBeenCalled();
    expect(title.textContent).toBe("Complete draft");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Créer" || b.textContent === "Annuler",
      ),
    ).toBe(false);
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(create).toHaveBeenCalledExactlyOnceWith(
      "folder",
      "Complete draft",
      {
        [axisId]: { kind: "status", optionId },
        [checkboxId]: { kind: "checkbox", checked: true },
        [dateId]: { kind: "instant", instant: new Date("2026-10-08T09:00").toISOString() },
      },
      { [relationId]: [targetId] },
    );
    expect(host.querySelector("input")).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("retries a refused outside creation once and closes the saved draft", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const create = vi.fn().mockRejectedValueOnce(new Error("Refused")).mockResolvedValue(undefined);
  try {
    await act(async () =>
      root.render(
        createElement(BoardCreateCard, {
          columnLabel: "Alpha",
          canCreateFolder: true,
          onCreate: create,
        }),
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>(".database-board__add")?.click());
    const input = host.querySelector<HTMLElement>('[role="textbox"]');
    if (!input) throw new Error("Missing draft");
    await act(async () => {
      input.textContent = "Retry card";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(create).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="textbox"]')?.textContent).toBe("Retry card");
    await act(async () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Réessayer")?.click(),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(host.querySelector("input")).toBeNull();
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
