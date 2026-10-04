// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiLab } from "../src/ui/ui-lab.tsx";

function required<T>(element: T | null | undefined): T {
  if (element === null || element === undefined)
    throw new Error("Expected reference control is missing");
  return element;
}

describe("deterministic UI lab", () => {
  it("renders the same inventory for the same clock", () => {
    const props = { now: new Date("2026-08-20T12:34:00.000Z") } as const;
    const first = renderToStaticMarkup(createElement(UiLab, props));
    const second = renderToStaticMarkup(createElement(UiLab, props));
    expect(first).toBe(second);
    expect(first).toContain("Laboratoire MyOwnNotion");
    expect(first).toContain("20 août 2026 à 12:34");
    expect(first).toContain("1 234 567,89");
    expect(first).toContain("⌘ K");
  });

  it("contains every shared asynchronous state and content color", () => {
    const markup = renderToStaticMarkup(createElement(UiLab));
    expect(markup.match(/data-state=/g)).toHaveLength(10);
    expect(markup.match(/data-content-color=/g)).toHaveLength(9);
    for (const label of [
      "Chargement…",
      "Aucun contenu",
      "Indisponible sur cet appareil",
      "Hors ligne",
      "Une erreur est survenue",
      "Terminé",
      "Une décision est nécessaire",
      "Enregistré sur cet appareil",
      "Synchronisation…",
      "Information",
    ]) {
      expect(markup).toContain(label);
    }
  });

  it("can pin one overlay open for stable keyboard and visual checks", () => {
    const menu = renderToStaticMarkup(createElement(UiLab, { overlay: "menu" }));
    expect(menu).toContain('role="menu"');
    expect(menu).toContain("Placer dans la corbeille");

    const dialog = renderToStaticMarkup(createElement(UiLab, { overlay: "dialog" }));
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain("Aucun contenu ne sera effacé immédiatement");
  });
});

describe("interactive UI reference", () => {
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

  it.each([
    ["Plus d’actions", ".ui-menu"],
    ["Informations", ".ui-popover"],
    ["Confirmation", ".ui-dialog"],
    ["Navigation mobile", ".ui-drawer"],
  ])("opens %s by default and closes with Escape", async (triggerSelector, contentSelector) => {
    await act(async () => root.render(<UiLab />));
    const trigger = required(
      Array.from(container.querySelectorAll("button")).find(
        (button) =>
          button.textContent === triggerSelector ||
          button.getAttribute("aria-label") === triggerSelector,
      ),
    );
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
    const content = required(container.querySelector<HTMLElement>(contentSelector));
    expect(content.hidden).toBe(false);
    await act(async () => {
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("keeps the explicit none mode controlled for stable captures", async () => {
    await act(async () => root.render(<UiLab overlay="none" />));
    const trigger = required(container.querySelector<HTMLButtonElement>(".ui-dialog__trigger"));
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("can empty and restore the real table without requests or owner storage", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLab />));
    const table = () => container.querySelector('[role="grid"]');
    expect(table()?.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
    const action = required(
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Vider"),
    );
    await act(async () => action.click());
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
    expect(container.textContent).toContain("Aucun projet");
    await act(async () => action.click());
    expect(table()?.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it("selects a content color locally while preserving the original palette", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLab />));
    expect(container.querySelectorAll("[data-content-color]")).toHaveLength(9);
    const choices = required(
      container.querySelector('fieldset[aria-label="Choisir une couleur de contenu"]'),
    );
    const red = required(choices.querySelector<HTMLButtonElement>('[aria-label="Rouge"]'));
    await act(async () => red.click());
    expect(red.getAttribute("aria-pressed")).toBe("true");
    expect(choices.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(container.querySelector(".ui-lab__color-selection")?.textContent).toContain("Rouge");
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it("previews loading and restores the existing table without losing entries", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLab />));
    const entries = container.querySelectorAll('[role="gridcell"]').length;
    const action = required(
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Chargement"),
    );
    await act(async () => action.click());
    expect(action.getAttribute("aria-pressed")).toBe("true");
    const waiting = required(
      container.querySelector('[role="status"][aria-busy="true"].ui-async-state'),
    );
    expect(waiting.textContent).toContain("Préparation des projets de recherche");
    expect(waiting.querySelector('[aria-hidden="true"].ui-skeleton')).not.toBeNull();
    await act(async () => action.click());
    expect(action.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(entries);
    expect(container.textContent).toContain("Préparer la prochaine version");
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });

  it("previews the shared destructive confirmation on local examples only", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<UiLab />));
    const trigger = required(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "Supprimer l’exemple",
      ),
    );
    await act(async () => trigger.click());
    const dialog = () => required(document.querySelector('[role="alertdialog"]'));
    const button = (text: string) =>
      required(Array.from(dialog().querySelectorAll("button")).find((b) => b.textContent === text));
    await vi.waitFor(() => expect(dialog().textContent).toContain("Supprimer cet exemple ?"));
    await act(async () => button("Annuler").click());
    expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
    await act(async () => trigger.click());
    await act(async () => button("Supprimer l’exemple").click());
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
    expect(container.textContent).toContain("Aucun projet");
    expect(request).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
});
