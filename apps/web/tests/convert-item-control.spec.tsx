// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ConvertItemControl,
  type ConvertOutcome,
} from "../src/features/navigation/convert-item.tsx";

const itemId = "018f2b7c-0000-7000-8000-000000000001";
const success = { ok: true, needsConfirmation: false };

async function mount(holdsContent?: boolean) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const convert = vi.fn<() => Promise<ConvertOutcome>>().mockResolvedValue(success);
  await act(async () =>
    root.render(
      <ConvertItemControl
        itemId={itemId}
        itemName="Task"
        kind="page"
        holdsContent={holdsContent}
        variant="switch"
        convert={convert}
      />,
    ),
  );
  const rail = host.querySelector<HTMLFieldSetElement>("fieldset");
  const folder = host.querySelector<HTMLButtonElement>('button[title="Transformer en dossier"]');
  if (!rail || !folder) throw new Error("Missing switch");
  // jsdom has no layout; Ariakit only returns focus to a visible target.
  vi.spyOn(folder, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 100, 28),
  ] as unknown as DOMRectList);
  const click = async (pointer = true) => {
    await act(async () => {
      folder.focus();
      folder.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: pointer ? 1 : 0 }));
    });
  };
  const dismissWithEscape = async () => {
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
  };
  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, root, rail, folder, convert, click, dismissWithEscape, cleanup };
}

it("asks immediately for known content without starting a conversion and returns quietly after pointer → Escape", async () => {
  const ui = await mount(true);
  try {
    await ui.click();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(ui.convert).not.toHaveBeenCalled();
    expect(ui.rail.dataset.pendingKind).toBeUndefined();
    await ui.dismissWithEscape();
    await vi.waitFor(() => expect(document.activeElement).toBe(ui.folder));
    expect(ui.rail.dataset.quietReturnFocus).toBe("true");
    expect(ui.rail.dataset.keyboardReturnFocus).toBeUndefined();
    expect(ui.folder.getAttribute("aria-pressed")).toBe("false");
    await act(async () =>
      ui.folder.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    );
    expect(ui.rail.dataset.quietReturnFocus).toBeUndefined();
    expect(ui.rail.dataset.keyboardReturnFocus).toBeUndefined();
    expect(ui.convert).not.toHaveBeenCalled();
  } finally {
    ui.cleanup();
  }
});

it("preserves ordinary keyboard focus when a keyboard-opened confirmation is cancelled", async () => {
  const ui = await mount(true);
  try {
    await ui.click(false);
    await ui.dismissWithEscape();
    await vi.waitFor(() => expect(document.activeElement).toBe(ui.folder));
    expect(ui.rail.dataset.quietReturnFocus).toBeUndefined();
    expect(ui.rail.dataset.keyboardReturnFocus).toBe("true");
    await act(async () =>
      ui.folder.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    expect(ui.rail.dataset.keyboardReturnFocus).toBeUndefined();
    expect(ui.convert).not.toHaveBeenCalled();
  } finally {
    ui.cleanup();
  }
});

it("responds while the write is pending, blocks duplicates, and rolls back a refused request without claiming a new kind", async () => {
  const ui = await mount(false);
  let resolve: ((outcome: ConvertOutcome) => void) | undefined;
  ui.convert.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  try {
    await ui.click();
    expect(ui.rail.getAttribute("aria-busy")).toBe("true");
    expect(ui.rail.dataset.pendingKind).toBe("folder");
    expect(ui.folder.getAttribute("aria-pressed")).toBe("false");
    expect(ui.folder.disabled).toBe(true);
    await act(async () => ui.folder.click());
    expect(ui.convert).toHaveBeenCalledTimes(1);
    await act(async () => resolve?.({ ok: false, needsConfirmation: false, message: "Retry" }));
    expect(ui.rail.dataset.pendingKind).toBeUndefined();
    expect(ui.rail.getAttribute("aria-busy")).toBeNull();
    expect(ui.folder.getAttribute("aria-pressed")).toBe("false");
    expect(ui.folder.disabled).toBe(false);
    expect(ui.host.textContent).toContain("Retry");
  } finally {
    ui.cleanup();
  }
});

it("still asks when stale content information is refused by the canonical command, then submits only the explicit confirmation", async () => {
  const ui = await mount(false);
  ui.convert.mockResolvedValueOnce({ ok: false, needsConfirmation: true });
  try {
    await ui.click();
    expect(ui.convert).toHaveBeenNthCalledWith(1, itemId, "folder", false);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(ui.rail.dataset.pendingKind).toBeUndefined();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="confirm-convert"]')?.click(),
    );
    expect(ui.convert).toHaveBeenNthCalledWith(2, itemId, "folder", true);
    expect(ui.convert).toHaveBeenCalledTimes(2);
  } finally {
    ui.cleanup();
  }
});

it("keeps the requested destination stable when the canonical projection updates before the command finishes", async () => {
  const ui = await mount(false);
  let resolve: ((outcome: ConvertOutcome) => void) | undefined;
  ui.convert.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  try {
    await ui.click();
    await act(async () =>
      ui.root.render(
        <ConvertItemControl
          itemId={itemId}
          itemName="Task"
          kind="folder"
          variant="switch"
          convert={ui.convert}
        />,
      ),
    );
    expect(ui.rail.dataset.pendingKind).toBe("folder");
    expect(ui.folder.getAttribute("aria-pressed")).toBe("true");
    await act(async () => resolve?.(success));
    expect(ui.rail.dataset.pendingKind).toBeUndefined();
    expect(ui.folder.getAttribute("aria-pressed")).toBe("true");
  } finally {
    ui.cleanup();
  }
});
