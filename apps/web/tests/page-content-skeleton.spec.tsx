import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageContentSkeleton } from "../src/features/workspace/page-content-skeleton.tsx";

describe("page content skeleton", () => {
  it("mirrors the page chrome so opening does not jump the canvas", () => {
    const markup = renderToStaticMarkup(
      createElement(PageContentSkeleton, { variant: "page", hasIcon: true }),
    );
    expect(markup).toContain("workspace-page-title__path");
    expect(markup).toContain("workspace-page-title__body");
    expect(markup).toContain("workspace-skeleton--emoji");
    expect(markup).toContain("workspace-skeleton--title");
    expect(markup).toContain("Ouverture de la page");
    expect(markup).not.toContain("workspace-skeleton--icon-hint");
  });

  it("does not reserve an add-icon slot when the page has no emoji", () => {
    const markup = renderToStaticMarkup(createElement(PageContentSkeleton, { variant: "page" }));
    expect(markup).toContain("workspace-skeleton--title");
    expect(markup).not.toContain("workspace-skeleton--emoji");
    expect(markup).not.toContain("workspace-skeleton--icon-hint");
  });

  it("keeps the in-editor placeholder to body lines only", () => {
    const markup = renderToStaticMarkup(
      createElement(PageContentSkeleton, { testId: "editor-loading-skeleton" }),
    );
    expect(markup).toContain("editor-loading-skeleton");
    expect(markup).not.toContain("workspace-page-title__path");
    expect(markup).not.toContain("workspace-skeleton--emoji");
    expect(markup.match(/workspace-skeleton--line/g)?.length).toBe(3);
  });
});
