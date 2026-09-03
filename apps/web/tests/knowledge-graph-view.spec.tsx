// @vitest-environment jsdom
import { generateUuidV7 } from "@myownnotion/domain";
import type { GraphProjection } from "@myownnotion/graph";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphCanvas } from "../src/features/knowledge-graph/graph-canvas.tsx";
import { GraphInspector } from "../src/features/knowledge-graph/graph-inspector.tsx";

const id = generateUuidV7();
const projection: GraphProjection = {
  nodes: [
    {
      id,
      canonicalKind: "page",
      kind: "page",
      lifecycle: "active",
      name: "Page centrale",
      icon: "🧭",
      mediaType: null,
      parentIds: [],
      structured: {},
      incomingRelationCount: 1,
      outgoingRelationCount: 2,
      incomingOccurrenceCount: 1,
      outgoingOccurrenceCount: 2,
      depth: 0,
    },
  ],
  edges: [],
  focusId: id,
  coverage: { state: "complete", cursor: "42" },
  diagnostics: { invalidEdges: 0, invalidNodes: 0, missingEndpoints: 0, unknownRelationTypes: 0 },
  summary: {
    candidateNodeCount: 1,
    visibleNodeCount: 1,
    candidateRelationCount: 0,
    visibleRelationCount: 0,
    occurrenceCount: 0,
    componentCount: 1,
    isolatedNodeCount: 1,
  },
  truncation: { truncated: false, omittedNodes: 0, omittedEdges: 0 },
};

describe("graph representations", () => {
  it("exposes identity and counts on the canvas", () => {
    const props = { projection, selectedId: id, onSelect: () => undefined };
    const canvas = renderToStaticMarkup(createElement(GraphCanvas, props));
    expect(canvas).toContain(`data-graph-node="${id}"`);
    expect(canvas).toContain("Page centrale");
    expect(canvas).toContain("knowledge-graph-canvas__halo");
    expect(canvas).not.toContain("knowledge-graph-arrow");
    expect(canvas).not.toContain("🧭");
    expect(canvas).toContain("1 entrantes");
    expect(canvas).toContain("2 sortantes");
  });

  it("keeps lifecycle, unavailable relations and readable locations in the inspector", () => {
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const baseNode = projection.nodes[0];
    if (baseNode === undefined) throw new Error("The graph fixture requires its central node.");
    const nodes: GraphProjection["nodes"] = [
      {
        ...baseNode,
        id: parentId,
        name: "Dossier lisible",
        kind: "folder",
        canonicalKind: "folder",
        outgoingRelationCount: 1,
      },
      {
        ...baseNode,
        id: childId,
        name: "Page à la corbeille",
        lifecycle: "trashed",
        parentIds: [parentId],
        incomingRelationCount: 1,
        outgoingRelationCount: 0,
      },
    ];
    const edges: GraphProjection["edges"] = [
      {
        key: `${parentId}/${childId}`,
        sourceId: parentId,
        targetId: childId,
        relationType: "hierarchy:contains",
        occurrenceIds: ["placement"],
        multiplicity: 1,
        origins: ["hierarchy"],
        availability: "target-trashed",
      },
    ];
    const inspectedNode = nodes[1];
    if (inspectedNode === undefined) throw new Error("The graph fixture requires its child node.");
    const inspector = renderToStaticMarkup(
      createElement(GraphInspector, {
        node: inspectedNode,
        nodes,
        edges,
        onOpen: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(inspector).toContain("Dans la corbeille");
    expect(inspector).toContain("Indisponible");
    expect(inspector).toContain("Emplacement : Dossier lisible");
  });
});

describe("graph pointer navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("drags, zooms around the pointer, highlights neighbors and opens on double click", async () => {
    const linkedId = generateUuidV7();
    const unrelatedId = generateUuidV7();
    const base = projection.nodes[0];
    if (base === undefined) throw new Error("The graph fixture requires its central node.");
    const interactiveProjection: GraphProjection = {
      ...projection,
      nodes: [
        { ...base, incomingRelationCount: 3, incomingOccurrenceCount: 3 },
        {
          ...base,
          id: linkedId,
          name: "Voisine",
          incomingRelationCount: 1,
          outgoingRelationCount: 1,
        },
        {
          ...base,
          id: unrelatedId,
          name: "Hors voisinage",
          incomingRelationCount: 0,
          outgoingRelationCount: 0,
        },
      ],
      edges: [
        {
          key: `${id}/${linkedId}`,
          sourceId: id,
          targetId: linkedId,
          relationType: "page:link",
          occurrenceIds: ["link"],
          multiplicity: 1,
          origins: ["relationship"],
          availability: "active",
        },
      ],
      summary: {
        ...projection.summary,
        candidateNodeCount: 3,
        visibleNodeCount: 3,
        candidateRelationCount: 1,
        visibleRelationCount: 1,
        occurrenceCount: 1,
        componentCount: 2,
        isolatedNodeCount: 1,
      },
    };
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <GraphCanvas
          projection={interactiveProjection}
          selectedId={null}
          onSelect={onSelect}
          onOpen={onOpen}
        />,
      );
    });

    const svg = container.querySelector<SVGSVGElement>(".knowledge-graph-canvas > svg");
    const central = container.querySelector<SVGGElement>(`[data-graph-node="${id}"]`);
    const unrelated = container.querySelector<SVGGElement>(`[data-graph-node="${unrelatedId}"]`);
    if (svg === null || central === null || unrelated === null) {
      throw new Error("The interactive graph did not render its targets.");
    }
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 520,
      width: 800,
      height: 520,
      toJSON: () => ({}),
    });

    const initialViewBox = svg.getAttribute("viewBox");
    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 600,
          clientY: 130,
          deltaY: -100,
        }),
      );
    });
    expect(container.querySelector('[aria-label="Niveau de zoom"]')?.textContent).not.toBe("100 %");
    expect(svg.getAttribute("viewBox")).not.toBe(initialViewBox);

    const zoomedViewBox = svg.getAttribute("viewBox");
    await act(async () => {
      svg.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 600,
          clientY: 130,
          deltaX: 80,
          deltaY: 4,
        }),
      );
    });
    expect(svg.getAttribute("viewBox")).toBe(zoomedViewBox);
    await act(async () => {
      svg.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 400,
          clientY: 260,
          pointerId: 1,
        }),
      );
      svg.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 460,
          clientY: 300,
          pointerId: 1,
        }),
      );
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
    });
    expect(svg.getAttribute("viewBox")).not.toBe(zoomedViewBox);

    await act(async () => {
      central.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(unrelated.getAttribute("data-emphasis")).toBe("dimmed");

    await act(async () => {
      central.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      central.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith(id);
    expect(onOpen).toHaveBeenCalledWith(id);

    const initialTransform = central.getAttribute("transform");
    await act(async () => {
      central.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 400,
          clientY: 260,
          pointerId: 2,
        }),
      );
      svg.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 520,
          clientY: 260,
          pointerId: 2,
        }),
      );
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2 }));
    });
    expect(central.getAttribute("transform")).not.toBe(initialTransform);
    expect(container.querySelector('[aria-label="Dézoomer"]')).toBeNull();
    expect(container.querySelector(".knowledge-graph-canvas__toolbar")).toBeNull();
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "Ajuster"),
    ).toBe(false);

    const zoomedOutViewBox = svg.getAttribute("viewBox");
    await act(async () => {
      central.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    });
    await act(async () => {
      central.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    });
    await act(async () => {
      central.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    });
    await act(async () => {
      central.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Niveau de zoom"]')?.textContent).not.toBe("100 %");
    expect(svg.getAttribute("viewBox")).not.toBe(zoomedOutViewBox);
    const zoomLabel = container.querySelector('[aria-label="Niveau de zoom"]')?.textContent ?? "";
    expect(Number.parseInt(zoomLabel, 10)).toBeLessThan(50);
  });
});
