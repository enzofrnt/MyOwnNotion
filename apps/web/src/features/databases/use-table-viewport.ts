import { type RefObject, useLayoutEffect, useState } from "react";

interface TableViewport {
  readonly element: HTMLElement | null;
  readonly scrollMargin: number;
  readonly headerHeight: number;
  readonly pageFlow: boolean;
}

/** Table rows live in either a bounded table or the workspace's page flow. */
export function measureTableViewport(
  surface: HTMLElement | null,
  contentSelector = "tbody",
): TableViewport {
  // Retained editor tabs must not observe or move the visible page's viewport.
  if (surface === null || surface.getClientRects().length === 0) {
    return { element: null, scrollMargin: 0, headerHeight: 0, pageFlow: false };
  }
  const pageFlow =
    surface.closest(
      ".database-container-page, .editor-database-view-block, .workspace-page-canvas, .page-databases",
    ) !== null;
  const element =
    (pageFlow ? surface.closest<HTMLElement>("[data-editor-scrollport], .workspace-main") : null) ??
    surface;
  const body = surface.querySelector(contentSelector);
  return {
    element,
    pageFlow: element !== surface,
    headerHeight:
      body === null
        ? 0
        : body.getBoundingClientRect().top -
          surface.getBoundingClientRect().top +
          surface.scrollTop,
    scrollMargin:
      body === null
        ? 0
        : body.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          element.clientTop +
          element.scrollTop,
  };
}

export function useTableViewport(
  surface: RefObject<HTMLElement | null>,
  contentSelector = "tbody",
): TableViewport {
  const [viewport, setViewport] = useState<TableViewport>({
    element: null,
    scrollMargin: 0,
    headerHeight: 0,
    pageFlow: false,
  });
  // Changes to title, properties or row contents can move the tbody origin.
  useLayoutEffect(() => {
    const measured = measureTableViewport(surface.current, contentSelector);
    setViewport((current) =>
      current.element === measured.element &&
      current.scrollMargin === measured.scrollMargin &&
      current.headerHeight === measured.headerHeight
        ? current
        : measured,
    );
  });
  useLayoutEffect(() => {
    const element = surface.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const measured = measureTableViewport(element, contentSelector);
      setViewport((current) =>
        current.element === measured.element &&
        current.scrollMargin === measured.scrollMargin &&
        current.headerHeight === measured.headerHeight
          ? current
          : measured,
      );
    });
    observer.observe(element);
    const workspace = element.closest("[data-editor-scrollport], .workspace-main");
    if (workspace !== null) observer.observe(workspace);
    return () => observer.disconnect();
  }, [surface, contentSelector]);
  return viewport;
}
