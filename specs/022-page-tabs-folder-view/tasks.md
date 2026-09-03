# Tasks: Fil d’Ariane discret, onglets ouverts et vue de dossier

**Input**: Design documents from `/specs/022-page-tabs-folder-view/`

**Prerequisites**: plan.md, spec.md

**Tests**: demandés par FR-031 ; inclus par histoire.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

- [ ] T001 Étendre `WorkspacePresentationState` avec `openTabIds` (normalisation,
      défaut `[]`, dédoublonnage) et ajouter `openTab`, `closeTab`,
      `pruneTabs` dans `packages/client-core/src/navigation/presentation-state.ts`
- [ ] T002 [P] Tests de normalisation et des helpers d’onglets dans
      `packages/client-core/tests/presentation-state-tabs.spec.ts`
- [ ] T003 Ajouter la prop `tabs` à `PageHeader` et retirer le fil d’Ariane des
      modes compacts ainsi que le segment « MyOwnNotion »
      (`apps/web/src/features/workspace/page-header.tsx`) ; adapter les tests
      existants qui l’attendaient

## Phase 2: User Story 1 — Fil d’Ariane (P1)

- [ ] T010 [US1] Algorithme pur `selectVisibleCrumbs` dans
      `apps/web/src/features/workspace/breadcrumb-layout.ts`
- [ ] T011 [P] [US1] Tests de l’algorithme dans `apps/web/tests/breadcrumb-layout.spec.ts`
- [ ] T012 [US1] Composant `PathBreadcrumbs` (mesure, ResizeObserver, menu « … »)
      dans `apps/web/src/features/workspace/path-breadcrumbs.tsx`
- [ ] T013 [US1] Slot `breadcrumbs` dans `PageTitleEditor`, rendu au-dessus de
      l’emoji (`page-title-editor.tsx`)
- [ ] T014 [US1] Câbler `PathBreadcrumbs` pour page et dossier dans
      `hierarchy-explorer.tsx` ; styles dans `workspace.css`
- [ ] T015 [P] [US1] Test de rendu `apps/web/tests/path-breadcrumbs.spec.tsx`

## Phase 3: User Story 2 — Onglets (P2)

- [ ] T020 [US2] Composant `OpenTabsStrip` (tablist, fermeture, défilement,
      flèches, scrollIntoView) dans `apps/web/src/features/workspace/open-tabs-strip.tsx`
- [ ] T021 [US2] État `openTabIds` dans `hierarchy-explorer.tsx` : hydratation,
      ajout à l’ouverture (pages, dossiers et graphe), fermeture → voisin/`/notes`,
      purge des items indisponibles, persistance ; l’onglet graphe survit à la
      purge des identités d’éléments
- [ ] T022 [US2] Passer la bande à `PageHeader` ; styles (desktop + étroit)
- [ ] T023 [P] [US2] Test de rendu et clavier `apps/web/tests/open-tabs-strip.spec.tsx`

## Phase 4: User Story 3 — Vue de dossier (P3)

- [ ] T030 [US3] Composant `FolderChildrenList` (dnd-kit sortable, menu
      Monter/Descendre, état vide avec création) dans
      `apps/web/src/features/workspace/folder-children-list.tsx`
- [ ] T031 [US3] Brancher la liste dans le canevas dossier de
      `hierarchy-explorer.tsx` sur `handleTreeDrop` / `reorder` / `createItem`
- [ ] T032 [US3] Styles de la liste dans `workspace.css`
- [ ] T033 [P] [US3] Test de rendu `apps/web/tests/folder-children-list.spec.tsx`
- [X] T034 [US2] Clic simple d’un dossier dans l’arbre = déplier ou replier ;
      double-clic = ouvrir (onglet + destination) en le laissant déplié, dans
      `apps/web/src/features/navigation/tree-row-pointer.ts` et
      `hierarchy-explorer.tsx` per FR-019 ; tests dans
      `apps/web/tests/tree-row-pointer.spec.ts`

## Phase 5: Parcours et polish

- [ ] T040 Spec Playwright `tests/e2e/workspace-tabs-folder.spec.ts` : ouverture
      → onglets, fermeture, fil d’Ariane tronqué, liste de dossier et
      réordonnancement reflété dans l’arbre
- [ ] T041 Lint, format, typecheck, tests unitaires web + client-core
- [ ] T042 Mettre à jour `docs/product/product-canvas.md` (fait dans la spec) et
      vérifier `specs/022-page-tabs-folder-view/spec.md` ↔ implémentation

## Dependencies

- T001 → T021 ; T003 → T014, T022 ; T010 → T012 → T013 → T014 ; T020 → T021 → T022 ;
  T030 → T031 → T032. Les tests [P] suivent leur composant.
