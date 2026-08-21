import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UiLab } from "../src/ui/ui-lab.tsx";

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
