import { readFileSync } from "node:fs";
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sidebarModeForWidth } from "../src/features/navigation/responsive-sidebar.tsx";
import { PageHeader } from "../src/features/workspace/page-header.tsx";
import { activeItemState } from "../src/features/workspace/use-active-item.ts";
import { WorkspaceShell } from "../src/features/workspace/workspace-shell.tsx";
import { WorkspaceState } from "../src/features/workspace/workspace-state.tsx";

function item(
  name: string,
  parentItemId: string | null = null,
  kind: ProjectedItem["kind"] = "page",
): ProjectedItem {
  const id = generateUuidV7();
  return {
    id,
    kind,
    name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    pageDocument: null,
    file: null,
    placements: [
      {
        id: generateUuidV7(),
        itemId: id,
        kind: "hierarchy",
        parentItemId,
        positionKey: "V",
      },
    ],
  } as ProjectedItem;
}

describe("workspace shell", () => {
  it("keeps navigation, header and readable main content as distinct landmarks", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        navigation={<nav aria-label="Navigation principale">Pages</nav>}
        header={<PageHeader title="Feuille de route" />}
        mobileNavigationOpen={false}
        sidebarOpen
        sidebarWidth={280}
        onMobileNavigationOpenChange={() => undefined}
        onSidebarOpenChange={() => undefined}
        onSidebarWidthChange={() => undefined}
      >
        <article>Contenu éditorial</article>
      </WorkspaceShell>,
    );

    expect(markup).toContain('data-testid="workspace-shell"');
    expect(markup).toContain("<aside");
    expect(markup).toContain('aria-label="Navigation de l’espace de travail"');
    expect(markup).toContain("<header");
    expect(markup).toContain('<main id="workspace-main"');
    expect(markup).toContain('class="workspace-reading-column"');
    expect(markup).toContain("Aller au contenu");
    expect(markup).toContain('data-testid="close-sidebar"');
    expect(markup).toContain('aria-label="Masquer la barre latérale"');
    expect(markup).toContain('aria-label="Afficher la barre latérale"');
    expect(markup).not.toContain('id="workspace-navigation" hidden=""');
  });

  it("keeps the desktop sidebar mounted but inert while it animates closed", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceShell
        navigation={<nav aria-label="Navigation principale">Pages</nav>}
        header={<PageHeader title="Feuille de route" />}
        mobileNavigationOpen={false}
        sidebarOpen={false}
        sidebarWidth={280}
        onMobileNavigationOpenChange={() => undefined}
        onSidebarOpenChange={() => undefined}
        onSidebarWidthChange={() => undefined}
      >
        <article>Contenu éditorial</article>
      </WorkspaceShell>,
    );

    expect(markup).toContain('data-sidebar-open="false"');
    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
    expect(markup).not.toContain('id="workspace-navigation" hidden=""');
  });

  it("keeps page identity and synchronization out while exposing its compact contextual action", () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        title="Projet Atlas"
        kind="page"
        breadcrumbs={[
          { id: "projects", label: "Projets", onOpen: () => undefined },
          { id: "atlas", label: "Projet Atlas" },
        ]}
        status="Synchronisé"
        actions={<button type="button">Plus d’actions</button>}
      />,
    );
    expect(markup).toContain('aria-label="Fil d’Ariane"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('data-testid="active-item-title"');
    expect(markup).toContain('data-testid="page-context-actions"');
    expect(markup).not.toContain("Synchronisé");
    expect(markup).toContain("Plus d’actions");
    expect(markup).not.toContain("workspace-page-header__identity");
  });

  it("keeps folder identity out of the chrome like a page", () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        title="Archives"
        kind="folder"
        breadcrumbs={[{ id: "archives", label: "Archives" }]}
      />,
    );
    expect(markup).toContain('data-compact="true"');
    expect(markup).toContain('aria-label="Fil d’Ariane"');
    expect(markup).not.toContain("workspace-page-header__identity");
    expect(markup).not.toContain('data-testid="active-item-heading"');
  });

  it("keeps loading geometry explicit instead of returning a blank page", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceState, { kind: "loading" }));
    expect(markup).toContain('data-testid="workspace-shell-skeleton"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/workspace-skeleton/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain("Chargement de l’espace de travail");
  });

  it.each([
    ["empty", "Votre espace est prêt"],
    ["offline", "Contenu indisponible hors ligne"],
    ["error", "L’espace n’a pas pu être chargé"],
  ] as const)("renders an explicit %s workspace state", (kind, title) => {
    const markup = renderToStaticMarkup(
      <WorkspaceState kind={kind} diagnostics={<code>diagnostic secondaire</code>} />,
    );

    expect(markup).toContain(`data-testid="workspace-state-${kind}"`);
    expect(markup).toContain(title);
    expect(markup).toContain("Détails techniques");
    expect(markup).toContain("diagnostic secondaire");
  });

  it("derives the current title and path from stable identities after rename and move", () => {
    const root = item("Projets", null, "folder");
    const archive = item("Archives", null, "folder");
    const page = item("Atlas", root.id);
    const renamedAndMoved = {
      ...page,
      name: "Atlas 2027",
      placements: page.placements.map((placement) => ({
        ...placement,
        parentItemId: archive.id,
      })),
    };

    const active = activeItemState([root, archive, renamedAndMoved], page.id);
    expect(active.item?.id).toBe(page.id);
    expect(active.item?.name).toBe("Atlas 2027");
    expect(active.path.map((entry) => entry.name)).toEqual(["Archives", "Atlas 2027"]);
  });

  it("lets a short page fill the main pane without inventing extra scroll", () => {
    const css = readFileSync(
      new URL("../src/features/workspace/workspace.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(/\.workspace-main\[data-content-mode="page"\]\s*\{[^}]*padding:\s*0/u);
    expect(css).toMatch(/\.workspace-page-canvas\s*\{[^}]*flex:\s*1 0 auto/u);
    expect(css).not.toMatch(/\.workspace-page-canvas\s*\{[^}]*100dvh/u);
  });

  it("uses the documented desktop, tablet and mobile breakpoints", () => {
    expect(sidebarModeForWidth(1280)).toBe("desktop");
    expect(sidebarModeForWidth(900)).toBe("tablet");
    expect(sidebarModeForWidth(320)).toBe("mobile");
  });
});
