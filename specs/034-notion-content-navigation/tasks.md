# Tasks: Équations, sommaires et listes lisibles

## Phase 1: Setup

- [x] T001 Lire constitution/canevas et créer specs/034-notion-content-navigation/spec.md avec checklist.
- [x] T002 Rechercher représentation et défauts, produire specs/034-notion-content-navigation/plan.md et design ; analyser avant code.

## Phase 2: Foundations

- [x] T003 Ajouter tests et types equation/tableOfContents/mark equation dans packages/domain/src/document/ et packages/domain/tests/.
- [x] T004 Étendre persistance/transformations et tests dans packages/page-state/src/ et packages/page-state/tests/.

## Phase 3: US1 — Equations

- [x] T005 [US1] Ajouter KaTeX local et rendu/saisie dans apps/web/src/features/editor/custom-blocks/equation.tsx et math.tsx.
- [x] T006 [US1] Ajouter inline, conversion, adapter et slash dans apps/web/src/features/editor/ ; vérifier source/undo/reopen avec tests web.
- [x] T007 [US1] Appliquer ui-quality et conserver preuves valide/vide/invalide, clavier, thèmes/320 dans specs/034-notion-content-navigation/validation.md.

## Phase 4: US2 — Sommaires

- [x] T008 [US2] Partager collecte/navigation et tests dans apps/web/src/features/editor/page-headings.ts ; corriger page-outline.tsx et page-editor.tsx.
- [x] T009 [US2] Ajouter bloc, conversion/adapter/slash dans apps/web/src/features/editor/custom-blocks/table-of-contents.tsx et modules éditeur.
- [x] T010 [US2] Appliquer ui-quality et prouver navigation/page active/repère/toggle/vide dans specs/034-notion-content-navigation/validation.md.

## Phase 5: US3 — Listes

- [x] T011 [US3] Recomposer rangées et tests dans apps/web/src/features/databases/list-view.tsx et database.css.
- [x] T012 [US3] Appliquer ui-quality et preuves liste longue/vide/clavier, clair/sombre1440/320 dans specs/034-notion-content-navigation/validation.md.

## Phase 6: Import and delivery

- [x] T013 Relier conversion native034, parent block_id et exclusion explicite à028 dans apps/api/src/imports/notion/ et ses tests ; actualiser specs/028-notion-import/plan.md/tasks.md.
- [x] T014 Sauvegarder puis réparer canoniquement instance8082, sans remplacer éditions locales ; evidence dans specs/034-notion-content-navigation/validation.md.
- [x] T015 Types, format, tests pertinents et builds, preuve runtime isolé dans specs/034-notion-content-navigation/validation.md.
- [x] T016 Mettre à jour docs/notion-import.md et artefacts034/028 puis converger.

## Dependencies and incremental delivery

T001–T002 → T003–T004 → US1 → US2 → US3 → T013–T016.
Indépendamment vérifiables : équation durable ; sommaires navigables ; liste lisible.
Recherche phase0 déléguée ; implémentation séquentielle par propriétaire des fichiers.
Aucune nouvelle branche ni publication, conservation de la branche d'import actuelle.

## Maintenance — retour sur les couleurs de texte

- [x] T017 Respecter les couleurs explicites et leur soulignement dans le schéma
  BlockNote/editor.css ; appliquer ui-quality et documenter le rendu réel de la
  page signalée, puis livrer uniquement le Web isolé 8082. Suites suspendues à la
  demande du propriétaire.

## Maintenance — visibilité du sommaire selon l'espace disponible

- [ ] T018 Mesurer la largeur du scrollport workspace et masquer l'outline
  latéral quand une barre latérale large réduit l'espace, sans affecter le
  sommaire intégré ; appliquer ui-quality et documenter la capture réelle.
