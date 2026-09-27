# Tasks: Fil d’Ariane discret, onglets ouverts et vue de dossier

**Input**: Design documents from `/specs/022-page-tabs-folder-view/`

**Prerequisites**: plan.md, spec.md

**Tests**: demandés par FR-031 ; inclus par histoire.

T001–T043 sont cochées d’après le code, les tests unitaires et le parcours
Playwright exécuté sur la matrice complète après la feature 014. T044 conserve
la livraison finale ouverte jusqu'aux preuves PR et `main` du candidat corrigé.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

- [X] T001 Étendre `WorkspacePresentationState` avec `openTabIds` (normalisation,
      défaut `[]`, dédoublonnage) et ajouter `openTab`, `closeTab`,
      `pruneTabs` dans `packages/client-core/src/navigation/presentation-state.ts`
- [X] T002 [P] Tests de normalisation et des helpers d’onglets dans
      `packages/client-core/tests/presentation-state-tabs.spec.ts`
- [X] T003 Ajouter la prop `tabs` à `PageHeader` et retirer le fil d’Ariane des
      modes compacts ainsi que le segment « MyOwnNotion »
      (`apps/web/src/features/workspace/page-header.tsx`) ; adapter les tests
      existants qui l’attendaient

## Phase 2: User Story 1 — Fil d’Ariane (P1)

- [X] T010 [US1] Algorithme pur `selectVisibleCrumbs` dans
      `apps/web/src/features/workspace/breadcrumb-layout.ts`
- [X] T011 [P] [US1] Tests de l’algorithme dans `apps/web/tests/breadcrumb-layout.spec.ts`
- [X] T012 [US1] Composant `PathBreadcrumbs` (mesure, ResizeObserver, menu « … »)
      dans `apps/web/src/features/workspace/path-breadcrumbs.tsx`
- [X] T013 [US1] Slot `breadcrumbs` dans `PageTitleEditor`, rendu au-dessus de
      l’emoji (`page-title-editor.tsx`)
- [X] T014 [US1] Câbler `PathBreadcrumbs` pour page et dossier dans
      `hierarchy-explorer.tsx` ; styles dans `workspace.css`
- [X] T015 [P] [US1] Test de rendu `apps/web/tests/path-breadcrumbs.spec.tsx`

## Phase 3: User Story 2 — Onglets (P2)

- [X] T020 [US2] Composant `OpenTabsStrip` (toolbar, destinations courantes,
      fermeture focusable par bouton, raccourci ou clic central avec retour au
      voisin, point d'entrée clavier si la destination active n'a pas d'onglet,
      retour au canevas après fermeture du dernier onglet, défilement, flèches
      limitées aux destinations, scrollIntoView)
      dans `apps/web/src/features/workspace/open-tabs-strip.tsx`
- [X] T021 [US2] État `openTabIds` dans `hierarchy-explorer.tsx` : hydratation,
      ajout à l’ouverture (pages, dossiers et graphe), fermeture → voisin/`/notes`,
      purge des items indisponibles, persistance ; l’onglet graphe survit à la
      purge des identités d’éléments
- [X] T022 [US2] Passer la bande à `PageHeader` ; styles (desktop + étroit)
- [X] T023 [P] [US2] Test de rendu et clavier `apps/web/tests/open-tabs-strip.spec.tsx`

## Phase 4: User Story 3 — Vue de dossier (P3)

- [X] T030 [US3] Composant `FolderChildrenList` (liens canoniques natifs,
      distinction page/dossier/fichier/base, dnd-kit sortable, menu
      Monter/Descendre et état vide) dans
      `apps/web/src/features/workspace/folder-children-list.tsx`
- [X] T031 [US3] Brancher la liste dans le canevas dossier de
      `hierarchy-explorer.tsx` sur `handleTreeDrop` / `reorder` / `createItem`
- [X] T032 [US3] Styles de la liste dans `workspace.css`
- [X] T033 [P] [US3] Test de rendu `apps/web/tests/folder-children-list.spec.tsx`
- [X] T034 [US2] Clic simple d’un dossier dans l’arbre = déplier ou replier ;
      double-clic = ouvrir (onglet + destination) en le laissant déplié, dans
      `apps/web/src/features/navigation/tree-row-pointer.ts` et
      `hierarchy-explorer.tsx` per FR-019 ; tests dans
      `apps/web/tests/tree-row-pointer.spec.ts`

## Phase 5: Parcours et polish

- [X] T040 Spec Playwright `tests/e2e/workspace-tabs-folder.spec.ts` : ouverture
      → onglets sans doublon, historique/rechargement, renommage/emoji/conversion,
      fermeture sémantique avec Entrée/Espace/⌘W/Ctrl+W et retour de focus, fil
      d’Ariane tronqué consultable au clavier, liste de dossier sans éditeur et
      source de base distincte, réordonnancement au clavier, au pointeur et par
      action tactile reflété dans l’arbre puis sur un second appareil, cibles
      tactiles de 44 px, audit axe des surfaces modifiées et absence de
      débordement à 390 et 320 px, avec ouverture réelle du menu d'une ligne
      profondément imbriquée dans le tiroir mobile par son raccourci contextuel ;
      exécution sur Chromium desktop/mobile, Firefox desktop et WebKit
      desktop/mobile, avec déclaration du parcours dans `ci/test-impact.json`
      et régression de son propriétaire CI
- [X] T041 Lint, format, typecheck, tests unitaires web + client-core
- [X] T042 Mettre à jour `docs/product/product-canvas.md` (fait dans la spec) et
      vérifier `specs/022-page-tabs-folder-view/spec.md` ↔ implémentation
- [X] T043 Appliquer le [skill UI partagé](../../.agents/skills/ui-quality/SKILL.md)
      aux boutons sémantiques, cibles compactes, espacements, arrondis imbriqués,
      focus, défilement horizontal contenu et viewports 320/390 px ; consigner
      les preuves de revue dans `validation.md`

## Phase 6: Livraison intégrée

- [ ] T044 Exécuter le gate complet sur le commit candidat propre, vérifier
      toute la CI de PR et la revue, fusionner normalement, puis vérifier toute
      la CI `main` et consigner les preuves adressables dans `validation.md`
      (FR-031, Constitution III/VII). PR #175 et son merge antérieur sont
      consignés, mais son run `main` a échoué sur A82. La matrice locale du
      correctif est verte ; sa propre PR puis son run `main` restent à produire.

## Dependencies

- T001 → T021 ; T003 → T014, T022 ; T010 → T012 → T013 → T014 ; T020 → T021 → T022 ;
  T030 → T031 → T032. Les tests [P] suivent leur composant.
