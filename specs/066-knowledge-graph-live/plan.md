# Plan: Live knowledge graph

- Data: `useKnowledgeGraph` already re-derives on `LocalContentService.subscribeProjection`
  (upserts debounced 200 ms). Verify every mutation (rename, create, trash, link) emits it;
  fix the missing emitters.
- Layout: `createGraphForceRuntime(projection, previous?)` (`packages/graph/src/layout.ts`)
  seeds known nodes at their previous positions and new nodes beside a placed neighbour;
  `graph-canvas.tsx` passes the current layout, settles 20 ticks instead of 120 and fits the
  view only on first render.
- Tests: e2e `tests/e2e/knowledge-graph-live.spec.ts` (rename, create, link, trash with the
  graph open); unit test for the seeded runtime.
- UI skill: no new surface; motion respects `prefers-reduced-motion` (existing).
