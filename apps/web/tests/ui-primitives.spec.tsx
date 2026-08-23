import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppIcon } from "../src/ui/icons.tsx";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeading,
  DialogRoot,
  DialogTrigger,
  Field,
  LiveRegion,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Status,
} from "../src/ui/primitives/index.ts";

describe("shared UI primitive contracts", () => {
  it("keeps a busy action named, disabled and exposed as busy", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { busy: true, variant: "primary" }, "Créer la page"),
    );
    expect(markup).toContain("Créer la page");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('data-variant="primary"');
  });

  it("associates field help and errors without discarding the entered value", () => {
    const markup = renderToStaticMarkup(
      createElement(Field, {
        id: "page-title",
        label: "Titre",
        description: "Visible dans la navigation",
        error: "Le titre est obligatoire",
        value: "Brouillon",
        readOnly: true,
      }),
    );
    expect(markup).toContain('<label class="ui-field__label" for="page-title">');
    expect(markup).toContain('aria-describedby="page-title-description page-title-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('value="Brouillon"');
    expect(markup).toContain('role="alert"');
  });

  it("exposes menu roles and disabled items through Ariakit", () => {
    const markup = renderToStaticMarkup(
      <MenuRoot defaultOpen>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent alwaysVisible portal={false}>
          <MenuItem>Renommer</MenuItem>
          <MenuItem disabled>Déplacer</MenuItem>
        </MenuContent>
      </MenuRoot>,
    );
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('role="menu"');
    expect(markup.match(/role="menuitem"/g)).toHaveLength(2);
    expect(markup).toContain('aria-disabled="true"');
  });

  it("gives modal content an accessible heading, description and focus boundary", () => {
    const markup = renderToStaticMarkup(
      <DialogRoot defaultOpen>
        <DialogTrigger>Ouvrir</DialogTrigger>
        <DialogContent alwaysVisible portal={false}>
          <DialogHeading>Supprimer la page ?</DialogHeading>
          <DialogDescription>La page restera récupérable dans la corbeille.</DialogDescription>
        </DialogContent>
      </DialogRoot>,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Supprimer la page ?");
    expect(markup).toContain("récupérable dans la corbeille");
  });

  it("announces asynchronous and urgent states without relying on color", () => {
    const loading = renderToStaticMarkup(
      createElement(Status, { kind: "loading" }, "Ouverture du document"),
    );
    const conflict = renderToStaticMarkup(
      createElement(Status, { kind: "conflict" }, "Deux intentions sont conservées"),
    );
    const live = renderToStaticMarkup(
      createElement(LiveRegion, { politeness: "assertive" }, "Connexion perdue"),
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Chargement…");
    expect(conflict).toContain('role="alert"');
    expect(conflict).toContain("Une décision est nécessaire");
    expect(live).toContain('aria-live="assertive"');
    expect(live).toContain("ui-visually-hidden");
  });

  it("keeps decorative icons hidden and names standalone icons", () => {
    const decorative = renderToStaticMarkup(createElement(AppIcon, { name: "search" }));
    const standalone = renderToStaticMarkup(
      createElement(AppIcon, { name: "search", label: true }),
    );
    expect(decorative).toContain('aria-hidden="true"');
    expect(standalone).toContain('role="img"');
    expect(standalone).toContain('aria-label="Rechercher"');
  });

  it("defines one visible focus treatment for every interactive primitive", () => {
    const css = readFileSync(
      new URL("../src/ui/primitives/primitives.css", import.meta.url),
      "utf8",
    );
    for (const selector of [
      ".ui-button:focus-visible",
      ".ui-field__control:focus-visible",
      ".ui-menu__item:focus-visible",
      ".ui-dialog:focus-visible",
      ".ui-drawer:focus-visible",
    ]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain("--ui-color-focus");
    expect(css).toContain("--ui-focus-ring");
  });

  it("keeps destructive action text legible throughout its hover transition", () => {
    const css = readFileSync(
      new URL("../src/ui/primitives/primitives.css", import.meta.url),
      "utf8",
    );
    const normal = css.match(/\.ui-button\[data-variant="danger"\] \{[^}]+\}/u)?.[0];
    const hover = css.match(
      /\.ui-button\[data-variant="danger"\]:hover:not\(:disabled\) \{[^}]+\}/u,
    )?.[0];

    // Animating both foreground and background between different contrast
    // pairs creates an unreadable midpoint even when both endpoints pass.
    expect(normal).toContain("color: var(--ui-color-text-inverse)");
    expect(normal).toContain("background: var(--ui-color-danger)");
    expect(hover).toContain("color: var(--ui-color-text-inverse)");
    expect(hover).toContain("background: var(--ui-color-danger-hover)");
  });
});
