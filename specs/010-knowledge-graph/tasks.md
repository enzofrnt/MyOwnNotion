# Tasks: Graphe de connaissances privé

**Input**: Design documents from `/specs/010-knowledge-graph/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: La spec exige des preuves automatisées de comportement, propriété,
performance, responsive, clavier, offline, reprise et confidentialité. Les
tâches de test précèdent donc l'implémentation de chaque tranche.

**Organization**: Les tâches sont regroupées par user story afin que chaque
tranche reste vérifiable indépendamment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: réalisable en parallèle dans des fichiers distincts
- **[Story]**: user story couverte
- chaque tâche nomme ses fichiers cibles

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Créer la frontière de package et raccorder l'outillage existant.

- [x] T001 Créer le package Bun/TypeScript `@myownnotion/graph` dans `packages/graph/package.json`, `packages/graph/tsconfig.json` et `packages/graph/src/index.ts`
- [x] T002 [P] Ajouter les alias, dépendances workspace et projets de test nécessaires dans `apps/web/package.json`, `packages/client-core/package.json`, `tsconfig.json` et `vitest.config.ts`
- [x] T003 [P] Relier la frontière de graphe confirmée depuis `docs/architecture/README.md` vers `specs/010-knowledge-graph/plan.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fournir la source locale sûre et les contrats purs communs à
toutes les vues.

**⚠️ CRITICAL**: aucune user story ne commence avant cette phase.

- [x] T004 Écrire les tests de contrat des types, limites et diagnostics sûrs dans `packages/graph/tests/contracts.spec.ts`
- [x] T005 [P] Écrire les tests de lecture atomique de topologie, ouverture différée et curseur dans `packages/client-core/tests/knowledge-graph-source.spec.ts`
- [x] T006 Implémenter les types, validateurs et libellés de relations connus/inconnus dans `packages/graph/src/types.ts` et `packages/graph/src/relations.ts`
- [x] T007 Implémenter la normalisation idempotente des éléments, placements et relations dans `packages/graph/src/normalize.ts`
- [x] T008 Ajouter `readKnowledgeGraphTopology` et `hydrateKnowledgeGraphNodes` sans nouveau store dans `packages/client-core/src/local-store/local-repository.ts`
- [x] T009 Exposer la source et l'état de couverture via `LocalContentService` dans `apps/web/src/services/local-content.ts`

**Checkpoint**: la source locale et la normalisation pure sont testables sans
interface.

---

## Phase 3: User Story 1 — Comprendre les liens d'une page (Priority: P1) 🎯 MVP

**Goal**: Séparer backlinks et relations sortantes, agréger les occurrences et
ouvrir l'identité liée.

**Independent Test**: Trois pages et plusieurs liens vers une même cible
produisent les directions et multiplicités exactes, y compris corbeille,
renommage et suppression de la dernière occurrence.

### Tests for User Story 1

- [x] T010 [P] [US1] Écrire les tests d'agrégation, backlinks, relations réciproques, inconnues et indisponibles dans `packages/graph/tests/backlinks.spec.ts`
- [x] T011 [P] [US1] Écrire les tests React de l'inspecteur et de l'ouverture canonique dans `apps/web/tests/knowledge-graph-inspector.spec.tsx`
- [x] T012 [P] [US1] Ajouter le parcours Playwright backlinks et multiplicité dans `tests/e2e/knowledge-graph.spec.ts`

### Implementation for User Story 1

- [x] T013 [US1] Implémenter l'agrégation, les compteurs entrants/sortants et `backlinksFor` dans `packages/graph/src/project.ts`
- [x] T014 [US1] Créer la copie française et l'inspecteur séparant « Référencé par » et « Pointe vers » dans `apps/web/src/features/knowledge-graph/graph-copy.ts` et `apps/web/src/features/knowledge-graph/graph-inspector.tsx`
- [x] T015 [US1] Intégrer l'accès « Voir les relations » et l'ouverture canonique dans `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`

**Checkpoint**: les backlinks sont une tranche utilisable même sans graphe
global.

---

## Phase 4: User Story 2 — Explorer le voisinage d'un élément (Priority: P1)

**Goal**: Explorer un voisinage orienté de profondeur 1 à 3 en carte et en
liste équivalente.

**Independent Test**: Un réseau cyclique à trois niveaux répond exactement aux
changements de profondeur ; sélection, zoom, recentrage et ouverture
fonctionnent au clavier et en liste.

### Tests for User Story 2

- [x] T016 [P] [US2] Écrire les tests BFS borné, cycles, profondeurs et disposition déterministe dans `packages/graph/tests/neighborhood.spec.ts`
- [x] T017 [P] [US2] Écrire les tests React de parité carte/liste, sélection et clavier dans `apps/web/tests/knowledge-graph-view.spec.tsx`
- [x] T018 [P] [US2] Étendre le parcours Playwright au graphe local, au clavier et à 320 px dans `tests/e2e/knowledge-graph.spec.ts`

### Implementation for User Story 2

- [x] T019 [US2] Implémenter les périmètres voisinage et sélection, le BFS bidirectionnel et le bornage dans `packages/graph/src/project.ts`
- [x] T020 [US2] Implémenter la disposition stable par composantes et anneaux dans `packages/graph/src/layout.ts`
- [x] T021 [P] [US2] Créer la carte SVG avec zoom, recentrage, sélection et direction textuelle dans `apps/web/src/features/knowledge-graph/graph-canvas.tsx`
- [x] T022 [P] [US2] Créer la représentation liste équivalente dans `apps/web/src/features/knowledge-graph/graph-list.tsx`
- [x] T023 [US2] Ajouter `/graph/:itemId`, son routage protégé et l'orchestration du graphe local dans `apps/web/src/routing/paths.ts`, `apps/web/src/app.tsx` et `apps/web/src/features/knowledge-graph/knowledge-graph-view.tsx`

**Checkpoint**: le graphe local est navigable indépendamment de la vue globale.

---

## Phase 5: User Story 3 — Explorer et filtrer le workspace (Priority: P1)

**Goal**: Offrir la destination globale, les périmètres workspace/branche et
des filtres combinables avec totaux et limites honnêtes.

**Independent Test**: Un jeu hétérogène est restreint exactement par périmètre,
types, relation, pièce jointe, format, lifecycle et isolés ; une action remet
la vue à zéro.

### Tests for User Story 3

- [x] T024 [P] [US3] Écrire les fixtures déterministes de périmètres, filtres, isolés, intersections et réinitialisation dans `packages/graph/tests/filters.spec.ts`
- [x] T025 [P] [US3] Écrire les tests de routes et contrôles globaux dans `apps/web/tests/knowledge-graph-global.spec.tsx`, `apps/web/tests/app-routing.spec.tsx` et `apps/web/tests/route-paths.spec.ts`
- [x] T026 [P] [US3] Ajouter la fixture 100 000/100 000 et les budgets de projection dans `tests/performance/knowledge-graph.perf.spec.ts`

### Implementation for User Story 3

- [x] T027 [US3] Implémenter les périmètres workspace/branche, les filtres combinables, isolés, résumés et troncature dans `packages/graph/src/project.ts`
- [x] T028 [US3] Créer les contrôles de périmètre, profondeur, types, formats, isolés et reset dans `apps/web/src/features/knowledge-graph/graph-controls.tsx`
- [x] T029 [US3] Ajouter `/graph`, le bouton principal de navigation et l'intégration globale dans `apps/web/src/routing/paths.ts`, `apps/web/src/app.tsx`, `apps/web/src/features/navigation/sidebar.tsx` et `apps/web/src/features/knowledge-graph/knowledge-graph-view.tsx`
- [x] T030 [US3] Traiter la projection par lots et hydrater seulement les nœuds visibles dans `apps/web/src/features/knowledge-graph/use-knowledge-graph.ts`

**Checkpoint**: la destination globale est utile et bornée sur un grand
workspace.

---

## Phase 6: User Story 4 — Garder un graphe fiable hors ligne et après reprise (Priority: P1)

**Goal**: Conserver exactitude et transparence de couverture hors ligne, après
redémarrage, resynchronisation et reconstruction.

**Independent Test**: Ajouts/retraits offline, redémarrage et permutation du
même ensemble de changements produisent une seule projection équivalente ; un
curseur absent ou une erreur restent annoncés comme partiels.

### Tests for User Story 4

- [x] T031 [P] [US4] Écrire les propriétés d'idempotence, permutation et convergence dans `packages/graph/tests/projection.property.spec.ts`
- [x] T032 [P] [US4] Écrire les tests d'état complet/partiel, dernière vue sûre et reconstruction dans `apps/web/tests/knowledge-graph-resilience.spec.tsx`
- [x] T033 [P] [US4] Étendre Playwright au mode offline, rechargement et reprise dans `tests/e2e/knowledge-graph.spec.ts`

### Implementation for User Story 4

- [x] T034 [US4] Brancher les événements de projection et le curseur durable sur le recalcul sans doublon dans `apps/web/src/features/knowledge-graph/use-knowledge-graph.ts` et `apps/web/src/services/local-content.ts`
- [x] T035 [US4] Implémenter les états complet, partiel, reconstruction, obsolète et erreur avec conservation de la dernière vue sûre dans `apps/web/src/features/knowledge-graph/knowledge-graph-view.tsx`
- [x] T036 [US4] Persister uniquement les préférences non sensibles et leur reset dans `apps/web/src/features/knowledge-graph/graph-preferences.ts`

**Checkpoint**: le graphe respecte le contrat local-first et de reprise.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Convergence visuelle, sécurité, documentation et gate complet.

- [x] T037 [P] Ajouter les styles responsive, focus visible, zoom 200 % et réduction des animations dans `apps/web/src/styles.css`
- [x] T038 [P] Ajouter les contrôles de confidentialité des diagnostics et préférences dans `apps/web/tests/knowledge-graph-privacy.spec.tsx` et `packages/graph/tests/contracts.spec.ts`

---

## Phase 8: User Story 5 — Redéploiement propre et workspace de démonstration (Priority: P1)

**Goal**: Fournir un environnement local jetable, riche et répétable sans
laisser un cache navigateur ou un ancien jeu de données fausser la validation.

**Independent Test**: Depuis une stack locale déjà utilisée, exécuter la
commande de démonstration, effacer les données du site selon la procédure,
se connecter avec le mot de passe factice puis vérifier automatiquement et
manuellement tous les cas du manifeste.

### Tests for User Story 5

- [x] T039 [P] [US5] Écrire le contrat du manifeste, des gardes local-only, des 240 éléments/480 relations et des catégories obligatoires dans `tests/contract/knowledge-graph-demo.spec.ts`

### Implementation for User Story 5

- [x] T040 [US5] Créer le générateur reproductible du corpus et son manifeste sûr dans `scripts/dev/knowledge-graph-demo-fixture.ts`
- [x] T041 [US5] Implémenter le seed avec propriétaire/mot de passe factices, mutations canoniques, chiffrement et vérification finale dans `scripts/dev/seed-knowledge-graph-demo.ts`
- [x] T042 [US5] Ajouter la commande destructive explicite `dev:stack:demo`, le montage du script et les refus de cible non locale dans `scripts/dev/stack.ts`, `package.json` et `compose.dev.yaml`
- [x] T043 [US5] Documenter le reset serveur + navigateur, les identifiants factices, la reprise après interruption et le protocole de test du graphe dans `docs/testing/knowledge-graph-demo.md`, `README.md` et `specs/010-knowledge-graph/quickstart.md`

**Checkpoint**: un validateur repart d'un ancien déploiement vers un corpus
contrôlé et une session neuve en moins de cinq minutes.

---

## Phase 9: Convergence & Full Gate

- [x] T044 Harmoniser les artefacts 010 avec l'implémentation et consigner les écarts résolus dans `specs/010-knowledge-graph/spec.md`, `specs/010-knowledge-graph/plan.md` et `specs/010-knowledge-graph/tasks.md`
- [x] T045 Exécuter les preuves de `specs/010-knowledge-graph/quickstart.md` puis le gate de code courant de `docs/development.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup**: démarre immédiatement.
- **Foundational**: dépend de Setup et bloque toutes les stories.
- **US1**: dépend de Foundational ; fournit l'agrégation réutilisée ensuite.
- **US2**: dépend de Foundational et de l'agrégation US1.
- **US3**: dépend de Foundational ; réutilise les composants de US2 pour la
  destination globale.
- **US4**: dépend de la projection et de l'orchestration livrées par US1–US3.
- **Polish**: dépend des quatre stories produit.
- **US5**: dépend du graphe global et de ses filtres afin que son corpus puisse
  prouver leurs cas ; reste strictement hors production.
- **Convergence & Full Gate**: dépend de Polish et US5.

### User Story Completion Order

```text
Setup → Foundation → US1 backlinks → US2 local → US3 global → US4 reprise → Polish → US5 démonstration → Convergence
```

US1 reste démontrable seule. Les algorithmes de filtre US3 peuvent avancer en
parallèle de l'interface US2 après Foundation, mais l'intégration globale attend
les composants carte/liste.

### Within Each User Story

- écrire et observer l'échec des tests avant l'implémentation ;
- implémenter les règles pures avant les adaptateurs ;
- intégrer l'interface après la source locale ;
- valider le checkpoint avant la story suivante.

## Parallel Opportunities

- T002 et T003 après T001 ;
- T004 et T005 ;
- pour chaque story, tests package, React et Playwright dans des fichiers
  distincts ;
- T021 et T022 après T020 ;
- T024, T025 et T026 ;
- T031, T032 et T033 ;
- T037 et T038 après les stories ;
- T039 peut précéder T040 à T043.

## Parallel Example: User Story 2

```text
T016 — propriétés de voisinage dans packages/graph/tests/neighborhood.spec.ts
T017 — contrat React dans apps/web/tests/knowledge-graph-view.spec.tsx
T018 — parcours navigateur dans tests/e2e/knowledge-graph.spec.ts
```

Après T019 et T020 :

```text
T021 — carte SVG
T022 — vue liste
```

## Implementation Strategy

### MVP First

1. Setup et Foundation.
2. US1 complète.
3. Valider backlinks, directions, multiplicités, corbeille et navigation.
4. US2 local, puis US3 global, puis US4 reprise.

### Incremental Delivery

1. Projection locale pure et sûre.
2. Backlinks immédiatement utiles.
3. Voisinage local carte/liste.
4. Vue globale filtrable et bornée.
5. Preuves offline, convergence, performance et confidentialité.
6. Workspace de démonstration local et procédure de redéploiement propre.

## Notes

- Les cases sont cochées seulement après réussite des preuves concernées.
- Aucun endpoint, store ou index persistant n'est ajouté sans retour au plan.
- Les logs n'acceptent jamais titre, UUID complet, filtre ou détail de
  relation.
- La feature 021 garde la refonte générale des logs serveur hors de cette MR.
- Le mot de passe de démonstration est public par définition et la commande de
  seed refuse toute cible autre que la stack locale jetable documentée.

## Phase 10: Convergence

- [x] T046 Ajouter un parcours d'ajout puis retrait de lien hors ligne, redémarrage de l'application et reprise locale, complété par 100 cycles de reconstruction sans perte ni doublon, dans `tests/e2e/knowledge-graph.spec.ts` et les fixtures locales concernées, per FR-024 et SC-006
- [x] T047 Comparer automatiquement le graphe reconstruit avant sauvegarde et après restauration sur 100 variantes d'identités, directions, types, disponibilités et multiplicités dans les tests de restauration et `packages/graph`, per FR-031 et SC-008
- [x] T048 Compléter le modèle clavier de la carte avec voisin visuel, `Échap`, `+`, `-`, `0`, retour de focus, puis automatiser tous les parcours essentiels à 320 px et 200 % de zoom dans `graph-canvas.tsx`, les tests Web et Playwright, per FR-034, SC-009, SC-010 et contract: graph UI
- [x] T049 Étendre les propriétés de convergence à 1 000 scénarios mixtes d'ajout, retrait, renommage, déplacement, conversion et restauration répartis entre deux appareils dans `packages/graph/tests/projection.property.spec.ts`, per FR-026 et SC-007
- [x] T050 Mesurer un voisinage de 500 nœuds sous une seconde et la première vue 100 000/100 000 sans blocage du thread principal supérieur à 100 ms dans les tests de performance package et Web Worker, per SC-003 et SC-004
- [x] T051 Rendre la liste strictement équivalente sur lifecycle et disponibilité, et nommer les emplacements lisibles dans l'inspecteur, avec tests React, dans `graph-list.tsx`, `graph-inspector.tsx` et `knowledge-graph-view.tsx`, per FR-019 et FR-020
- [x] T052 Étendre le contrôle final du seed pour prouver propriétaire/mot de passe/session uniques, composantes, cycles, inter-branches, attachement réel et valeurs statut/date/priorité, puis refuser tout manifeste incomplet dans `seed-knowledge-graph-demo.ts`, per FR-039, FR-041 et SC-017
- [x] T053 Couvrir dix cycles complets reset + génération et 100 variantes de cibles distantes, ambiguës ou non jetables dans les contrats et tests d'intégration de la démonstration, per SC-015 et SC-016
- [x] T054 Distinguer explicitement chargement initial, reconstruction, vue obsolète, indisponibilité et erreur avec une reprise sûre adaptée dans l'état de projection et l'interface, per FR-023 et FR-036
- [x] T055 Stabiliser l'identité de navigation du graphe entre les rendus parent afin qu'une actualisation de projection n'annule pas continuellement le Web Worker, avec test de non-régression React et parcours Chromium, per FR-023, SC-003 et SC-004
- [x] T056 Donner la priorité à une branche hors ligne durable lors de la réouverture, avant toute lecture du checkpoint distant, afin que sa conversion sérialisée conserve les deux éditions concurrentes, avec test unitaire de routage et parcours Firefox, per FR-024 et SC-006
- [x] T057 N'accuser réception d'une préférence locale de navigation qu'après son écriture IndexedDB afin qu'un retour immédiat au workspace ne restaure pas l'ancienne valeur, avec test React et parcours Chromium mobile, per SC-010
