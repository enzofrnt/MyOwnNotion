# Tasks: Liens d'éléments et insertion de bases

## Phase 1: Setup

- [x] T001 Lire constitution/canevas/ui-quality/lessons, spécifier 035 et checklist avant code.
- [x] T002 Rechercher les parcours et import, créer plan/research/data-model/contracts/quickstart ; analyser avant code.

## Phase 2: US1 — Liens et présentation importée

- [x] T003 [US1] Tester les cibles page/dossier/database/database_view et leurs identités dans apps/web/tests/page-link-picker.spec.tsx et page-link-inline-content.spec.ts.
- [x] T004 [US1] Étendre sélecteur/types/copie/iconographie dans editor-links.ts, page-link-picker.tsx, formatting-toolbar.tsx, block-context-menu.tsx et ui/copy/fr.ts.
- [x] T005 [US1] Tester is_inline true/false/absent/base sans vue/exclusion dans apps/api/tests/notion-content.spec.ts et fixture API.
- [x] T006 [US1] Distinguer présentation native en apps/api/src/imports/notion/plan.ts et blocks.ts, sans altérer propriétaires/vues.
- [x] T007 [US1] Appliquer ui-quality et prouver lien/sélecteur clavier, état cible, thèmes/320 dans 035/validation.md.

## Phase 3: US2 — Créations imbriquées

- [x] T008 [US2] Adapter tests et libellés/alias/icônes des trois créations dans apps/web/tests/slash-menu.spec.ts et editor-menus/slash-menu.tsx.
- [x] T009 [US2] Appliquer ui-quality et preuve visuelle des commandes et liens d'enfant dans 035/validation.md.

## Phase 4: US3 — Intégration unifiée

- [x] T010 [US3] Tester ouverture sans mutation, deux choix, annulation, double confirmation, échec/reprise et source absente dans apps/web/tests/integrated-database-picker.spec.tsx.
- [x] T011 [US3] Réutiliser DatabaseCreateChoiceDialog avec variante intégrée et états dans database-create-choice.tsx ; remplacer linked-database-picker.tsx par integrated-database-picker.tsx.
- [x] T012 [US3] Relier une seule commande/dialogue au bloc/parent actif en slash-menu.tsx/page-editor.tsx ; vérifier la vue stockée lors du retry en hierarchy-explorer.tsx.
- [x] T013 [US3] Adapter tests/e2e/page-links.spec.ts, block-editor.spec.ts et databases-pages-views.spec.ts ; prouver choix/reload/offline et absence de copie.
- [x] T014 [US3] Appliquer ui-quality, inspecter captures synthétiques choix/vide/erreur/chargement en clair/sombre 1440/320 et focus ; conserver035/validation.md.

## Phase 5: Repair and delivery

- [x] T015 Vérifier sauvegarde puis réparer seulement les huit liens importés inchangés sur 8082 ; conserver base intégrée, IDs, sources/entrées et éditions ; preuve privée ignorée et comptes dans 035/validation.md.
- [x] T016 Types/format/lint, corpus import/Web concernés, builds et matrice navigateur sur bases/ports jetables explicites ; consigner035/validation.md.
- [x] T017 Actualiser canevas/roadmap/guides et artefacts 028/029/033/035 ; images et runtime isolés 8082, smoke réel, puis convergence.

## Dependencies and strategy

Setup → US1 → US2 → US3 → réparation → validation/convergence.
Chaque story a ses critères de spec et un parcours indépendant. Implémentation
séquentielle ; recherche déléguée uniquement. Les lectures et checks indépendants
peuvent être exécutés ensemble ; ne pas modifier les mêmes fichiers en parallèle.
Livraison locale sur la branche d'import existante, sans push/PR demandé.
