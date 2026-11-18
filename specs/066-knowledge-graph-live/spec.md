# Feature Specification: Live knowledge graph

**Feature Branch**: `066-knowledge-graph-live` · **Created**: 2026-11-17 · **Status**: In progress

**Input**: Owner: "si le nom d'une page change, une page est créée, supprimée, et liens sont
ajoutés… le graphe n'évolue pas en live ; je veux qu'il évolue en live."

**Canvas**: knowledge graph is a secondary destination (feature 010); no boundary change.

## User stories

- **US1** — While the graph is open, renaming a page updates its label without a reload.
- **US2** — Creating a page adds its node; trashing a page removes it.
- **US3** — Adding or removing a link adds or removes the edge and the relation counts.
- **US4** — An update never re-centres the view or reshuffles nodes that did not change:
  existing nodes keep their place, a new node appears next to a linked neighbour.

- **US5** — Showing or hiding element kinds or relation types (filters) changes the graph in
  place: no new view, zoom and pan kept, nodes keep their place; a node hidden then shown
  again returns where it was (also after being dragged).

## Acceptance

- Each change is visible on the open graph within 2 s (local change), without navigation.
- Pan, zoom and selection are preserved across an update.
- Reduced motion: the update applies without animation.

## Non-goals

Changing the projection rules, filters or the inspector; server push transport.
