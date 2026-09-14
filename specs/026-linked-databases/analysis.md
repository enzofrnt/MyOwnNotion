# Analyse de cohérence avant implémentation

2026-09-05 : couverture FR-001–010 par T002–T009 et SC-001–004 par T007–T009. Les trois stories sont P1 car la réutilisation sans indépendance des vues ou sans protection contre la suppression n'est pas livrable.

Le report explicite des bases liées de 009 est remplacé par 026. Le registre de sources possède sa révision propre ; conserver les ancres de journal est uniquement une compatibilité interne. Les risques bloquants à tester sont les cascades de hiérarchie, le nettoyage d'historique, les filtres locaux incomplets et les métadonnées privées en clair. Aucune clarification produit supplémentaire n'est nécessaire ; aucune incohérence critique restante avant implémentation.

Clarification de convergence avant T013 : le défaut de placement racine contredisait le modèle des vues réutilisables du canevas §14. FR-012 et T013 imposent la création sans placement implicite, sans filtre UI arbitraire ni suppression des placements historiques. Pas de migration supplémentaire ni changement des autorisations de branche.


## Convergence finale

FR-001–012 et SC-001–005 disposent de preuves ciblées couvrant les tâches
d'implémentation et de convergence jusqu'à T017, T019, T021 et T022. À ce
checkpoint historique, T018 et T020 restaient ouverts ; leur clôture et la
livraison intégrée sont consignées plus bas. Les limites de purge planifiée et
de démarrage hors réseau non préparé restent explicites dans
[validation.md](validation.md).


## T015 post-implementation consistency review

The correction enforces FR-008's existing finite property/view vocabularies and
adds no property or view kind. The same validator handles legacy source views
and embedded views. Public command refusal tests protect explicit placements,
identities, typed values, conflict parents and impact confirmation. Task mapping
and impact tests verify existing recovery semantics; the bulk relationship
fixture checks the performance path against individual scoped reads. All 23
feature task IDs are unique. Aggregate focused coverage passes on d1f2911d;
the historical T018/T020 and final-gate status is superseded by the integrated
delivery closure below.

## Integrated convergence reopened — 2026-09-08

The complete Chromium run invalidates the earlier functional-convergence
checkpoint: the new editable host/entry types bypassed the old page-creation
journal predicate, and a pending checkbox write reverted its visible state.
T016 and T017 address those runtime gaps under FR-002/003/004/008/010. The
convergence fixes address the reproduced host-creation, delayed-column and
released-property defects. Focused browser evidence covers T016, T017 and T019;
the exact integrated gate and required PR verification later close T018/T020.
The specs keep their current product behavior; no cascade or implicit placement
is reintroduced.

## T023 convergence result — 2026-09-13

Commit `ca2174cd83fa328f8df808d2ccce5a66061c8999` adds the missing PostgreSQL
integration matrix for host, parent and placement validation. Follow-up commit
`4da2c2f9aece80b109ec15551b78af1cae4b76eb` adds the direct item, placement and
revision absence assertions for a missing containment parent. Together they
prove that invalid or unavailable hosts and parents are rejected without a
partial database mutation, while explicit placements, source-root
normalization and entries without placement remain valid. This closes the
atomicity evidence task. The historical UI/corbeille and final browser-gate
tasks T018/T020 are closed by the integrated delivery evidence below.

## Clôture de cohérence de livraison — 2026-09-13

The exact integrated SHA `52dfdc926164f392cf812ead302bddb9662ac356` has a
passing complete `bun run checks:local` gate. PR #175 for that SHA passed in
run `34747879571` and merged normally as
`4d9d3b0cf2fdfd8d83319c688177d972e8a45b3f`. T018 and T020 therefore have
commit-addressable local/PR evidence. Main run `34748994269` is not green;
final `main` verification remains open, so the analysis does not infer a
successful main gate.
