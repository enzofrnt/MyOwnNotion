# Tasks: URLs canoniques de l’application

**Input**: Design documents from `/specs/020-app-url-routing/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/routing.md`, `quickstart.md`

**Tests**: Les tests sont obligatoires et précèdent chaque implémentation conformément à FR-025 et à la Constitution III.

**Organization**: Les tâches sont regroupées par user story pour rendre chaque incrément vérifiable indépendamment.

## Format: `[ID] [P?] [Story] Description`

- **[P]** : fichiers distincts et aucune dépendance non terminée.
- **[Story]** : user story couverte par la tâche.

## Phase 1: Setup — dépendances et frontière de routage

**Purpose**: Installer le routeur exact et préparer la frontière sans modifier le comportement utilisateur.

- [X] T001 Ajouter `react-router-dom@7.18.2` et `workbox-routing@7.4.1` exactement avec Bun dans `apps/web/package.json` et `bun.lock`

---

## Phase 2: Foundational — chemins, validation et fournisseur navigateur

**Purpose**: Fournir les primitives partagées qui bloquent les trois user stories.

**⚠️ CRITICAL**: Aucune user story ne commence avant la validation de cette phase.

- [X] T002 [P] Écrire les tests en échec du contrat de construction/reconnaissance, UUID, canonicalisation et retour interne sûr dans `apps/web/tests/route-paths.spec.ts`
- [X] T003 Implémenter les chemins, le mapping des réglages et la validation de `returnTo` dans `apps/web/src/routing/paths.ts` et `apps/web/src/routing/return-destination.ts`
- [X] T004 Brancher `BrowserRouter` sans modifier l’isolation `/__ui-lab` dans `apps/web/src/routing/app-router.tsx` et `apps/web/src/main.tsx`

**Checkpoint**: Les chemins et retours sont testés, et l’application normale s’exécute sous un routeur navigateur.

---

## Phase 3: User Story 1 — Ouvrir et retrouver une note par son URL (Priority: P1) 🎯 MVP

**Goal**: Faire de `/notes/:itemId` l’unique sélection des pages, dossiers, bases et entrées, avec rechargement et historique.

**Independent Test**: Créer page et dossier, ouvrir chacun, recharger, parcourir précédent/suivant, renommer/déplacer/convertir et ouvrir une entrée de base ; l’identité URL et le contenu restent alignés.

### Tests for User Story 1

- [X] T005 [P] [US1] Écrire les tests en échec de sélection contrôlée, priorité de la route sur `lastVisitedItemId`, identité stable et états manquant/corbeille/hors ligne dans `apps/web/tests/hierarchy-explorer.spec.tsx`
- [X] T006 [P] [US1] Écrire les tests en échec du contexte de vue, de l’abandon de `?entry=` et de l’ouverture d’entrée canonique dans `apps/web/tests/database-views.spec.tsx` et `apps/web/tests/database-page-interaction.spec.tsx`
- [X] T007 [P] [US1] Écrire le journey en échec page/dossier/base/entrée couvrant URL, reload, précédent/suivant, renommage, déplacement et conversion dans `tests/e2e/routing.spec.ts`

### Implementation for User Story 1

- [X] T008 [US1] Rendre la sélection de `HierarchyExplorer` contrôlée par la route et unifier arbre, clavier, favoris, récents, recherche, fil d’Ariane, création et liens internes dans `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` et `apps/web/src/features/navigation/sidebar.tsx`
- [X] T009 [US1] Déclarer le layout protégé persistant et les routes `/notes` et `/notes/:itemId` sans remonter l’éditeur dans `apps/web/src/app.tsx` et `apps/web/src/routing/app-router.tsx`
- [X] T010 [US1] Remplacer les écritures History API d’entrée par la navigation canonique et les paramètres de vue du routeur dans `apps/web/src/features/databases/use-database-view.ts` et `apps/web/src/features/databases/database-page.tsx`
- [X] T011 [US1] Adapter les helpers et journeys existants à `/notes` et aux identités routées dans `tests/e2e/helpers.ts`, `tests/e2e/workspace-shell.spec.ts`, `tests/e2e/page-links.spec.ts` et `tests/e2e/hierarchy.spec.ts`

**Checkpoint**: Chaque contenu page-backed possède une URL stable et le navigateur restaure le bon contenu.

---

## Phase 4: User Story 2 — Naviguer entre les vraies pages de l’application (Priority: P1)

**Goal**: Donner une route directe à chaque réglage et conserver un retour exact vers le workspace.

**Independent Test**: Ouvrir chaque section depuis le workspace et directement, vérifier URL/titre/section, puis revenir par bouton et historique avec note, scroll et focus restaurés.

### Tests for User Story 2

- [X] T012 [P] [US2] Écrire les tests en échec des routes de réglages, du mapping `storage-sync`, de `/settings` et des détails paramétrés dans `apps/web/tests/app-routing.spec.tsx` et `apps/web/tests/workspace-content-boundary.spec.tsx`
- [X] T013 [P] [US2] Étendre en échec le journey de séparation réglages/workspace avec URLs directes, précédent/suivant, scroll et focus dans `tests/e2e/workspace-settings-boundary.spec.ts`

### Implementation for User Story 2

- [X] T014 [US2] Dériver la section active de la route, déclarer les destinations imbriquées et conserver le workspace monté mais masqué dans `apps/web/src/app.tsx` et `apps/web/src/routing/app-router.tsx`
- [X] T015 [US2] Rendre la navigation des réglages route-aware et adresser les détails par item explicite dans `apps/web/src/features/settings/settings-shell.tsx` et `apps/web/src/features/settings/workspace-management-settings.tsx`
- [X] T016 [US2] Restaurer chemin, ancre et focus via un contexte d’historique transitoire validé dans `apps/web/src/app.tsx` et `apps/web/src/routing/return-destination.ts`

**Checkpoint**: Toutes les pages opérationnelles sont directement adressables et le retour ne perd aucun contexte de travail.

---

## Phase 5: User Story 3 — Atteindre sûrement une destination protégée ou indisponible (Priority: P1)

**Goal**: Préserver les liens directs pendant setup/login/hors-ligne et rendre les erreurs sans fallback trompeur.

**Independent Test**: Ouvrir une note sans session puis se connecter ; répéter hors ligne, avec UUID invalide, item absent, corbeille, chemin inconnu et retour externe.

### Tests for User Story 3

- [X] T017 [P] [US3] Étendre en échec les tests du gate setup/login, de la reprise, du refus de retour externe et de l’état introuvable dans `apps/web/tests/app-routing.spec.tsx`
- [X] T018 [P] [US3] Écrire en échec les contrats de fallback direct nginx et shell de navigation hors ligne sans cache API dans `tests/contract/compose-security.spec.ts` et `tests/contract/web-offline-shell.spec.ts`
- [X] T019 [P] [US3] Étendre le journey en échec aux liens directs protégés, au reload hors ligne local/absent et aux routes invalides dans `tests/e2e/routing.spec.ts`

### Implementation for User Story 3

- [X] T020 [US3] Implémenter les redirections setup/login et la reprise par remplacement d’un `returnTo` interne validé dans `apps/web/src/app.tsx` et `apps/web/src/routing/return-destination.ts`
- [X] T021 [P] [US3] Créer la page introuvable et les états route manquant/corbeille/indisponible sans fallback `lastVisited` dans `apps/web/src/features/routing/not-found-page.tsx` et `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`
- [X] T022 [P] [US3] Servir l’`index.html` précaché pour les navigations same-origin hors ligne en excluant API, santé et assets dans `apps/web/src/service-worker.ts`
- [X] T023 [US3] Vérifier les routes profondes du serveur de développement et de l’image Web, puis ajuster uniquement si nécessaire `apps/web/vite.config.ts` et `docker/web-nginx.conf`

**Checkpoint**: Les destinations protégées et les erreurs restent sûres, directes et local-first.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Aligner l’inventaire de tests, la documentation de validation et le gate complet.

- [X] T024 [P] Déclarer les nouveaux tests de routage dans l’analyse d’impact sélective dans `ci/test-impact.json`
- [X] T025 [P] Mettre à jour les instructions de navigation et validation développeur si les commandes ou chemins servis ont changé dans `docs/development.md` et `specs/020-app-url-routing/quickstart.md`
- [X] T026 Exécuter les tests ciblés de `specs/020-app-url-routing/quickstart.md` sous surveillance d’un sous-agent économique et consigner résultats/corrections dans `specs/020-app-url-routing/validation.md`
- [X] T027 Relire l’inventaire courant de `docs/development.md`, exécuter `bun run checks:local` sous surveillance d’un sous-agent économique et consigner le code de sortie et les artefacts dans `specs/020-app-url-routing/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: démarre immédiatement.
- **Phase 2**: dépend de T001 et bloque toutes les user stories.
- **US1**: dépend de la phase 2 et constitue le MVP.
- **US2**: dépend de la phase 2 ; T014–T016 intègrent le layout posé par T009.
- **US3**: dépend de la phase 2 ; T020 utilise le gate existant et les helpers de retour de T003.
- **Phase 6**: dépend des trois user stories.

### User Story Dependencies

- **US1**: indépendante après la fondation ; livre les URLs de contenu.
- **US2**: testable indépendamment avec les routes de réglages, mais réutilise le layout protégé de US1 pendant l’implémentation intégrée.
- **US3**: testable indépendamment par liens directs et erreurs ; réutilise la table de routes commune.

### Within Each User Story

- Les tâches de tests MUST être exécutées d’abord et échouer pour le comportement manquant.
- L’implémentation pure précède l’intégration dans les composants.
- Un checkpoint ciblé doit réussir avant de passer à la story suivante.
- Les tâches modifiant le même fichier sont séquentielles même si leurs stories pourraient être vérifiées séparément.

### Parallel Opportunities

- T002 peut être préparée en parallèle de l’examen de dépendance après T001.
- T005, T006 et T007 sont parallélisables.
- T012 et T013 sont parallélisables.
- T017, T018 et T019 sont parallélisables.
- T021 et T022 sont parallélisables après leurs tests.
- T024 et T025 sont parallélisables.

---

## Parallel Example: User Story 1

```text
Task T005: tests de sélection contrôlée dans apps/web/tests/hierarchy-explorer.spec.tsx
Task T006: tests de contexte de base dans apps/web/tests/database-views.spec.tsx
Task T007: journey navigateur dans tests/e2e/routing.spec.ts
```

---

## Implementation Strategy

### MVP First

1. Installer les dépendances exactes.
2. Écrire puis implémenter le contrat de chemins.
3. Écrire les tests US1.
4. Contrôler `HierarchyExplorer` par `/notes/:itemId` et brancher toutes les ouvertures.
5. Valider reload et précédent/suivant avant les réglages et le gate.

### Incremental Delivery

1. **US1** : contenus canoniques et historique.
2. **US2** : réglages canoniques et retour de contexte.
3. **US3** : auth, offline, introuvable et distribution directe.
4. Gate complet puis convergence.

## Notes

- Toutes les tâches respectent le format checkbox + ID + labels + chemins exacts.
- Aucun changement de schéma ou migration n’est prévu.
- Les sous-agents de surveillance ne valident jamais à la place du code de sortie réel.

## Phase 7: Convergence

- [X] T028 Ajouter un test d’intégration de reprise effective d’une destination protégée après connexion et setup par `returnTo` interne validé dans `apps/web/tests/app-routing.spec.tsx` per FR-013 / SC-005 (partial)
- [X] T029 Ajouter un seam de navigation refusée et prouver que le contenu courant reste monté avec une erreur observable dans `apps/web/src/app.tsx` et `apps/web/tests/app-routing.spec.tsx` per Edge Case History API (partial)
- [X] T030 Étendre le journey navigateur à précédent/suivant sur au moins cinq destinations successives dans `tests/e2e/routing.spec.ts` per SC-003 (partial)
