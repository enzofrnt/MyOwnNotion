// @vitest-environment jsdom
import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardCardEditor } from "../src/features/databases/board-card-editor.tsx";

const propertyId = "00000000-0000-7000-8000-000000000001" as Uuid;
const property: DatabaseProperty = {
  id: propertyId,
  type: "checkbox",
  name: "Reviewed",
  config: {},
  state: "active",
  positionKey: "a",
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

it("creates atomically from the editable title, then clears the next draft without creating an empty entry", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const save = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(BoardCardEditor, {
          properties: [property],
          creating: true,
          initial: { kind: "page", title: "", values: {}, relationTargets: {} },
          label: "New task",
          onSave: save,
          onCancel: close,
        }),
      ),
    );
    const title = host.querySelector<HTMLElement>('[role="textbox"]');
    if (!title) throw new Error("Missing title");
    await act(async () => {
      title.textContent = "First task";
      title.dispatchEvent(new InputEvent("input", { bubbles: true }));
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await pause();
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      title: "First task",
      values: { [propertyId]: { kind: "checkbox", checked: true } },
    });
    expect(save.mock.calls[0]?.[1]).toBe(true);
    expect(title.textContent).toBe("");
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await pause();
    });
    expect(close).toHaveBeenCalledWith(false);
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("serializes changes received during a save, advances the baseline, then closes outside without stealing focus", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let finish: (() => void) | undefined;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(BoardCardEditor, {
          properties: [property],
          initial: { kind: "page", title: "Task", values: {}, relationTargets: {} },
          label: "Task",
          canChooseKind: true,
          onSave: save,
          onCancel: close,
        }),
      ),
    );
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error("Missing checkbox");
    await act(async () => {
      checkbox.click();
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      checkbox.click();
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish?.();
      await pause();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[2].values[propertyId]).toEqual({ kind: "checkbox", checked: true });
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await pause();
    });
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      finish?.();
      await pause();
    });
    expect(close).toHaveBeenCalledWith(false);
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("keeps refused drafts open and retries the latest value without save/cancel buttons", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const save = vi.fn().mockRejectedValueOnce(new Error("Refused")).mockResolvedValue(undefined);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(BoardCardEditor, {
          properties: [property],
          initial: { kind: "page", title: "Task", values: {}, relationTargets: {} },
          label: "Task",
          onSave: save,
          onCancel: close,
        }),
      ),
    );
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
      await pause();
    });
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await pause();
    });
    expect(close).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("conservée");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Enregistrer" || b.textContent === "Annuler",
      ),
    ).toBe(false);
    await act(async () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Réessayer")?.click(),
    );
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await pause();
    });
    expect(close).toHaveBeenCalledWith(false);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
