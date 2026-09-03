import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphCoverageNotice } from "../src/features/knowledge-graph/knowledge-graph-view.tsx";

describe("graph coverage", () => {
  it("separates offline connectivity from proven local completeness", () => {
    const complete = renderToStaticMarkup(
      createElement(GraphCoverageNotice, {
        coverage: { state: "complete", cursor: "42" },
        offline: true,
      }),
    );
    expect(complete).toContain("Vue complète sur cet appareil");
    expect(complete).toContain("Hors ligne");
  });

  it("never presents a partial projection as current", () => {
    const partial = renderToStaticMarkup(
      createElement(GraphCoverageNotice, {
        coverage: { state: "partial", reason: "initial-sync", cursor: null },
        offline: false,
        onSynchronize: () => undefined,
      }),
    );
    expect(partial).toContain("Vue partielle");
    expect(partial).toContain("Synchroniser");
    expect(partial).not.toContain("Vue complète");
  });
});
