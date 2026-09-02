# Implementation Plan: Fil d’Ariane discret, onglets ouverts et vue de dossier

**Branch**: `codex/022-page-tabs-folder-view` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/022-page-tabs-folder-view/spec.md`

## Summary

Trois surfaces du canevas changent, sans nouvelle donnée canonique :

1. Le fil d’Ariane quitte l’en-tête fixe (`PageHeader`) pour se placer en tête
   du canevas, juste au-dessus de l’emoji (`PageTitleEditor`), avec une
   troncature mesurée qui regroupe les ancêtres intermédiaires dans un « … »
   ouvrant un menu.
2. Une bande d’onglets par appareil et par fenêtre liste les pages et dossiers
   ouverts. Elle vit dans l’en-tête fixe, dérive son onglet actif de l’URL et
   persiste dans l’état de présentation IndexedDB existant
   (`navigation-state`), jamais synchronisé.
3. Le canevas d’un dossier liste ses enfants directs (liens) et permet de les
   réordonner ; le réordonnancement réutilise la mutation `placement.move`
   déjà émise par la barre latérale, donc l’ordre converge partout.

## Technical Context

**Language/Version**: TypeScript strict, React 19, Bun 1.4.0

**Primary Dependencies**: react-router-dom 7 (URL = source de vérité),
`@ariakit/react` (menus), `@dnd-kit/core` + `@dnd-kit/sortable` (déjà en
dépendance d’`apps/web`), Dexie (préférences device-local via
`@myownnotion/client-core`)

**Storage**: aucun changement de schéma serveur ni de migration. Un champ
`openTabIds: string[]` s’ajoute à `WorkspacePresentationState` (table `meta`,
clé `navigation-state`), normalisé au chargement comme les autres champs.

**Testing**: Vitest (`web`, `client-core`), rendu SSR `renderToStaticMarkup`
ou `createRoot` + `act` en jsdom ; Playwright pour les parcours (desktop +
viewport étroit).

**Target Platform**: Web responsive (Vite dev, image nginx), desktop Electron
hérite sans changement.

**Constraints**: aucune régression des tests `workspace-shell`,
`hierarchy-explorer`, `page-title-editor`, e2e `workspace-shell*` ; les
mutations passent par `runCommand` (outbox + refresh) ; pas de nouveau
`localStorage` pour l’état de présentation.

**Scale/Scope**: ~6 fichiers modifiés, 3 composants nouveaux, 1 helper
client-core, tests unitaires + 1 spec e2e.

## Constitution Check

- Mono-propriétaire, pas de nouvelle identité : conforme.
- Offline/sync : le réordonnancement est une mutation existante, optimiste,
  avec outbox ; les onglets sont device-local et documentés comme tels
  (canevas §12) : conforme.
- Modèle de contenu interne préservé ; aucun changement d’éditeur : conforme.
- TypeScript partout, tests ajoutés pour le comportement changé : conforme.
- Aucune exception à consigner.

## Project Structure

### Documentation (this feature)

```text
specs/022-page-tabs-folder-view/
├── spec.md
├── plan.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/client-core/src/navigation/presentation-state.ts   # + openTabIds, openTab/closeTab/pruneTabs
packages/client-core/tests/presentation-state*.spec.ts       # normalisation + helpers

apps/web/src/features/workspace/
├── page-header.tsx            # en-tête fixe : reçoit `tabs`, ne rend plus le fil d’Ariane des pages
├── page-title-editor.tsx      # slot `breadcrumbs` rendu au-dessus de l’emoji
├── path-breadcrumbs.tsx       # NOUVEAU : fil d’Ariane mesuré + « … » (menu)
├── breadcrumb-layout.ts       # NOUVEAU : algorithme pur de sélection des segments visibles
├── open-tabs-strip.tsx        # NOUVEAU : bande d’onglets défilante, rôles tablist/tab
├── folder-children-list.tsx   # NOUVEAU : liste réordonnable (dnd-kit sortable + menu Monter/Descendre)
└── workspace.css              # styles des trois surfaces + viewport étroit

apps/web/src/features/hierarchy/hierarchy-explorer.tsx
  # câblage : état openTabIds (hydratation/persistance), ajout à l’ouverture,
  # fermeture → voisin ou /notes, purge des éléments indisponibles,
  # canevas dossier → FolderChildrenList branché sur handleTreeDrop/reorder

apps/web/tests/
├── breadcrumb-layout.spec.ts
├── path-breadcrumbs.spec.tsx
├── open-tabs-strip.spec.tsx
└── folder-children-list.spec.tsx

tests/e2e/workspace-tabs-folder.spec.ts   # onglets, fil d’Ariane, liste de dossier
```

**Structure Decision**: on reste dans `features/workspace` (surfaces du
canevas) et `features/hierarchy` (orchestration des mutations). Aucune
nouvelle feature-directory côté web : les trois lots sont des évolutions du
shell existant.

## Design Notes

### Fil d’Ariane

- `activePath` (déjà calculé par `useActiveItem`) alimente
  `PathBreadcrumbs`. Le composant rend une liste de mesure invisible
  (`aria-hidden`, `visibility:hidden`, hors flux) contenant tous les segments,
  observe la largeur disponible (`ResizeObserver`) et appelle
  `selectVisibleCrumbs(widths, ellipsisWidth, available)` pour décider quels
  index restent visibles. Priorité : courant, parent, premier ancêtre, puis
  les autres du plus proche au plus lointain (FR-004).
- Les segments masqués sont regroupés dans un `MenuTrigger` « … » ; chaque
  `MenuItem` ouvre l’ancêtre via `onOpen`.
- Le segment courant est un `span aria-current="page"`.
- `PageHeader` en mode compact ne rend plus le `nav` de fil d’Ariane ; le
  libellé « MyOwnNotion » disparaît des deux modes (FR-002). Les tests qui
  attendaient ce libellé sont mis à jour.

### Onglets

- `openTabIds` est hydraté avec le reste de `navigation-state`, persisté dans
  le même `updateWorkspacePresentationState`, et purgé des ids qui ne sont
  pas des items actifs de kind `page`/`folder` une fois la projection chargée.
- Ajout : effet sur `selectedItem` (page ou dossier actif) → `openTab`.
  Précédent/suivant passe par le même effet, donc un onglet fermé est rouvert
  (FR-012). Un dossier dans l’arbre s’ouvre seulement quand un second clic
  arrive encore dans `FOLDER_SINGLE_CLICK_DELAY_MS` (`handleFolderRowPointerClick`) ;
  le clic simple planifie un `toggleBranch` après ce délai. Le `dblclick` natif
  est ignoré sur les dossiers : la fenêtre OS (~500 ms) est plus longue que le
  délai, donc un clic pour déplier, une pause, puis un clic pour replier ne
  doit pas ouvrir le dossier (FR-019).
- Fermeture : `closeTab(id)` ; si `id === selectedId`, `selectItemById(voisin
  ?? null)` (suivant, sinon précédent, sinon `/notes`).
- Élément mis à la corbeille : disparaît des items actifs → purgé ; si c’était
  l’onglet actif, la même règle de voisin s’applique.
- Rendu : `OpenTabsStrip` (`role="tablist"`, `role="tab"` +
  `aria-selected`, bouton de fermeture séparé), flèches gauche/droite pour
  déplacer le focus, défilement horizontal CSS, `scrollIntoView` de l’onglet
  actif, molette verticale traduite en défilement horizontal.
- La bande est passée à `PageHeader` via la prop `tabs` et rendue dans la
  rangée compacte, avant les actions contextuelles.

### Vue de dossier

- Enfants directs = `tree` (déjà construit) → nœud du dossier → `children`
  (déjà triés par `positionKey`).
- `FolderChildrenList` utilise `DndContext` + `SortableContext` (stratégie
  verticale, capteurs pointeur + clavier). `onDragEnd` produit
  `{ itemId, targetId, edge }` ; l’explorateur le traduit en intent `place` et
  appelle `handleTreeDrop`, exactement comme la barre latérale. Le menu de
  ligne « Monter / Descendre » appelle `reorder(node, ±1)` existant.
- État vide : `WorkspaceState kind="empty"` avec actions « Nouvelle page » /
  « Nouveau dossier » branchées sur `createItem(kind, folderId)`.
- Aucun `EditorView` n’est monté pour un dossier (déjà le cas).

## Complexity Tracking

Aucune violation.
