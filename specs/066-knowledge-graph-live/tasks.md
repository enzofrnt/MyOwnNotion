# Tasks: Live knowledge graph

- [x] T001 Repro e2e `knowledge-graph-live.spec.ts` (graph open; rename, create, link, trash).
- [x] T002 Seeded force runtime (`previous` positions) in `packages/graph/src/layout.ts`.
- [x] T003 Canvas keeps layout and view on topology change (`graph-canvas.tsx`).
- [x] T004 Repro result: rename, create (after returning to the graph tab), link, trash and a
      rename from another tab all reach the open graph; no missing emitter found. The visible
      defect was the full re-layout + re-centre on every change (fixed by T002/T003).
- [x] T005 Unit test: seeded runtime keeps existing positions.
- [x] T006 Graph e2e (`knowledge-graph`, `knowledge-graph-live`): 4/4 chromium desktop and mobile (2026-11-17).
- [x] T007 Filters (US5): positions remembered across filter changes (`positionMemoryRef`), no refit; e2e "toggling a filter keeps the current layout".
