# Tasks: Recherche initiale du workspace

**Input**: Design documents from /specs/008-search/

**Prerequisites**: spec.md, plan.md, research.md, data-model.md,
contracts/search-api.openapi.yaml, contracts/search-ui.md, quickstart.md

**Tests**: Obligatoires. La constitution, la spec et le canevas exigent des
tests domaine, intégration, contrat, sécurité, Playwright, reprise et
performance.

**Organization**: Les tâches sont regroupées par user story. Chaque tranche
produit une valeur vérifiable avant de passer à la suivante.

## Format: [ID] [P?] [Story] Description

- **[P]**: fichier distinct et aucune dépendance inachevée
- **[USn]**: user story correspondante dans spec.md
- Chaque tâche cite le chemin exact et, lorsque utile, les exigences couvertes

## Phase 1: Setup

**Purpose**: Installer le moteur choisi et préparer les frontières de source
sans introduire de stockage supplémentaire.

- [X] T001 Ajouter MiniSearch 7.2.0 à packages/domain/package.json avec pnpm 10.33.3 et mettre à jour pnpm-lock.yaml
- [X] T002 [P] Créer les exports vides de la feature dans packages/domain/src/search/index.ts et packages/client-core/src/search/index.ts, puis les exposer depuis packages/domain/src/index.ts et packages/client-core/src/index.ts
- [X] T003 [P] Ajouter les nouveaux groupes de fichiers search aux propriétaires unit, integration, contract, E2E et performance dans ci/test-impact.json

---

## Phase 2: Foundational

**Purpose**: Construire le texte canonique recherchable, le moteur commun, les
contrats et la lecture de source qui bloquent toutes les stories.

**⚠️ CRITICAL**: Aucune user story ne commence avant ce checkpoint.

### Tests fondamentaux

- [X] T004 [P] Écrire les tests de normalisation Unicode, casse, accents, segmentation française et limites de requête dans packages/domain/tests/search-normalise.spec.ts (FR-004, FR-034)
- [X] T005 [P] Écrire les tests d'extraction du texte visible, récursion des blocs, code, légendes et exclusion des URLs/blocs inconnus dans packages/domain/tests/search-document-text.spec.ts (FR-003, FR-008, FR-023)
- [X] T006 [P] Écrire les tests de rang titre exact/préfixe/corps, filtre, ordre stable, upsert ancien et retrait idempotent dans packages/domain/tests/search-index.spec.ts (FR-002 à FR-010, FR-017)
- [X] T007 [P] Étendre le test OpenAPI pour charger et valider contracts/search-api.openapi.yaml dans tests/contract/openapi.spec.ts (FR-024, FR-028, FR-034)
- [X] T008 [P] Écrire les tests d'intégration de lecture des sources actives, descendants et chemins courants dans packages/database/tests/search-source.integration.spec.ts (FR-007, FR-010, FR-019 à FR-021)

### Implémentation fondamentale

- [X] T009 Définir SearchDocument, SearchQuery, SearchCandidate et SearchResult dans packages/domain/src/search/types.ts selon data-model.md
- [X] T010 Implémenter la normalisation et la segmentation sans journalisation dans packages/domain/src/search/normalise.ts pour satisfaire T004
- [X] T011 Implémenter l'extraction sûre du texte du modèle canonique dans packages/domain/src/search/document-text.ts pour satisfaire T005
- [X] T012 Implémenter l'encapsulation MiniSearch, le rang déterministe et les upserts versionnés dans packages/domain/src/search/search-index.ts pour satisfaire T006
- [X] T013 Définir SearchRequestSchema, SearchResponseSchema et les problèmes search sûrs dans packages/contracts/src/content-api.ts conformément à contracts/search-api.openapi.yaml
- [X] T014 Implémenter listSearchSources, activeDescendantIds et hydrateSearchPaths dans packages/database/src/repositories/search-source-repository.ts pour satisfaire T008
- [X] T015 Exporter le repository de recherche depuis packages/database/src/index.ts et compléter les exports domaine/client dans les index créés par T002

**Checkpoint**: Le même corpus en mémoire produit le même rang et les mêmes
identités dans Node et dans le navigateur ; aucun index n'est encore exposé.

---

## Phase 3: User Story 1 — Retrouver rapidement un contenu (Priority: P1) 🎯 MVP

**Goal**: Rechercher en ligne titres, contenus de pages et noms de fichiers,
voir un extrait sûr puis ouvrir l'identité canonique.

**Independent Test**: Préparer une correspondance de titre, de corps et de nom
de fichier, rechercher avec casse/accents différents, vérifier le rang, l'état
vide et l'ouverture de chaque résultat.

### Tests for User Story 1

- [X] T016 [P] [US1] Écrire les tests de construction, recherche, génération et refus fail-closed du service serveur dans apps/api/tests/search-service.spec.ts (FR-001 à FR-009, FR-025, FR-028)
- [X] T017 [P] [US1] Écrire les tests de contrat propriétaire, validation, POST sans query-string, réponses et redaction dans apps/api/tests/search.contract.spec.ts (FR-023, FR-024, FR-029, FR-034)
- [X] T018 [P] [US1] Écrire les tests unitaires des états saisie, chargement, résultats, extrait texte et absence de résultat dans apps/web/tests/search-dialog.spec.ts (FR-008, FR-029, FR-030)
- [X] T019 [US1] Écrire le parcours Playwright titre/corps/fichier/rang/ouverture/état vide dans tests/e2e/search.spec.ts (acceptance US1)

### Implementation for User Story 1

- [X] T020 [US1] Implémenter les états cold/building/ready/degraded et l'échange atomique de génération dans apps/api/src/search/search-state.ts
- [X] T021 [US1] Implémenter la reconstruction depuis les contenus ouverts, la recherche, l'extrait sûr et l'hydratation courante dans apps/api/src/search/search-service.ts pour satisfaire T016
- [X] T022 [US1] Enregistrer POST /v1/search avec session propriétaire, validation, limites et erreurs sûres dans apps/api/src/routes/search.ts pour satisfaire T017
- [X] T023 [US1] Construire et injecter SearchService dans apps/api/src/context.ts et apps/api/src/app.ts sans bloquer les autres routes pendant building
- [X] T024 [US1] Ajouter ContentApi.search avec corps JSON et résultats typés dans apps/web/src/services/content-api.ts
- [X] T025 [US1] Implémenter la surface, les résultats et l'extrait rendu comme texte dans apps/web/src/features/search/search-dialog.tsx et apps/web/src/features/search/search-results.tsx pour satisfaire T018
- [X] T026 [US1] Ajouter l'entrée Recherche et l'ouverture/navigation de résultat dans apps/web/src/features/navigation/sidebar.tsx et apps/web/src/features/hierarchy/hierarchy-explorer.tsx
- [X] T027 [US1] Ajouter les styles loading, empty, error et résultat dans apps/web/src/styles.css sans dégrader les composants existants
- [X] T028 [US1] Exécuter les tests T016 à T019 et consigner le checkpoint MVP dans specs/008-search/validation.md

**Checkpoint**: La recherche complète en ligne est utilisable et testable
indépendamment ; la story suivante ajoute le local-first.

---

## Phase 4: User Story 2 — Rechercher hors ligne (Priority: P1)

**Goal**: Répondre immédiatement depuis les données locales, inclure les
mutations en attente, expliquer la couverture et fusionner sans doublon.

**Independent Test**: Charger partiellement le workspace, couper le réseau,
modifier localement, rechercher le nouveau texte, constater la limite d'un
corps déchargé, puis reconnecter sans perdre la version locale.

### Tests for User Story 2

- [X] T029 [P] [US2] Écrire les tests de lecture locale présent/offloaded/never-fetched et de corps déchiffré dans packages/client-core/tests/local-search-source.spec.ts (FR-011 à FR-014)
- [X] T030 [P] [US2] Écrire les tests de fusion par itemId, priorité pending/conflict, retrait local et erreur serveur dans packages/client-core/tests/search-merge.spec.ts (FR-015, FR-016, FR-018)
- [X] T031 [P] [US2] Écrire les tests de protocole worker, reconstruction, vidage et absence de persistance dans apps/web/tests/search-worker.spec.ts (FR-011, FR-022, FR-027)
- [X] T032 [US2] Écrire le parcours Playwright offline, changement local, contenu déchargé, reconnexion et déduplication dans tests/e2e/search-offline.spec.ts (acceptance US2)

### Implementation for User Story 2

- [X] T033 [US2] Implémenter LocalSearchSource sur les lignes ouvertes de LocalRepository dans packages/client-core/src/search/local-search-source.ts pour satisfaire T029
- [X] T034 [US2] Implémenter mergeSearchResults et les règles de couverture dans packages/client-core/src/search/merge-search-results.ts pour satisfaire T030
- [X] T035 [US2] Implémenter le moteur MiniSearch transitoire dans apps/web/src/features/search/search.worker.ts avec messages build/upsert/remove/query/clear pour satisfaire T031
- [X] T036 [US2] Implémenter le coordinateur local-first, la réponse locale immédiate et la fusion serveur dans apps/web/src/services/search.ts
- [X] T037 [US2] Brancher les commits projection/outbox et les notifications de synchronisation sur les upserts locaux dans apps/web/src/services/local-content.ts sans annoncer une recherche à jour avant le commit local (FR-013, FR-014, FR-017)
- [X] T038 [US2] Afficher coverage, localAvailability et conflict dans apps/web/src/features/search/search-dialog.tsx et apps/web/src/features/search/search-results.tsx
- [X] T039 [US2] Vider et terminer le worker lors d'un verrouillage, d'une perte de clé ou d'une déconnexion dans apps/web/src/services/search.ts et apps/web/src/services/local-key-storage.ts (FR-022, FR-028)
- [X] T040 [US2] Exécuter les tests T029 à T032 et ajouter les preuves local-first dans specs/008-search/validation.md

**Checkpoint**: La recherche reste utile et honnête sans réseau ; une
reconnexion enrichit plutôt qu'elle ne remplace le travail local.

---

## Phase 5: User Story 3 — Affiner et parcourir au clavier (Priority: P2)

**Goal**: Filtrer par type et branche, charger progressivement et utiliser tout
le parcours au clavier à 320 px et 200 % de zoom.

**Independent Test**: Créer des homonymes de types et branches différents,
appliquer les filtres, paginer, parcourir et ouvrir au clavier, puis recommencer
sur le viewport minimal.

### Tests for User Story 3

- [X] T041 [P] [US3] Étendre les contrats API avec filtres, branche, limite, curseur opaque et cursor-stale dans apps/api/tests/search.contract.spec.ts (FR-010, FR-033)
- [X] T042 [P] [US3] Écrire les tests de filtres, focus, annonces et sélection stable dans apps/web/tests/search-dialog.spec.ts (FR-010, FR-030 à FR-033)
- [X] T043 [US3] Étendre le parcours Playwright avec types, branche, pagination, clavier, 320 px et zoom dans tests/e2e/search.spec.ts (acceptance US3)
- [X] T044 [P] [US3] Ajouter l'audit axe-core de la surface de recherche dans tests/e2e/accessibility.spec.ts (FR-031, FR-032)

### Implementation for User Story 3

- [X] T045 [US3] Implémenter filtres de types, ensemble courant de descendants et curseur lié à la génération dans apps/api/src/search/search-service.ts et apps/api/src/routes/search.ts pour satisfaire T041
- [X] T046 [US3] Appliquer les mêmes filtres de types et branche dans packages/client-core/src/search/local-search-source.ts et apps/web/src/features/search/search.worker.ts
- [X] T047 [US3] Implémenter les filtres visibles et réinitialisables dans apps/web/src/features/search/search-filters.tsx et les brancher dans search-dialog.tsx
- [X] T048 [US3] Implémenter focus initial/retour, flèches, Entrée, Échap, annonces et sélection stable dans apps/web/src/features/search/search-dialog.tsx pour satisfaire T042
- [X] T049 [US3] Implémenter chargement progressif et reprise cursor-stale dans apps/web/src/services/search.ts et apps/web/src/features/search/search-results.tsx
- [X] T050 [US3] Finaliser les styles 320 px, zoom, reduced-motion et contraste dans apps/web/src/styles.css pour satisfaire T043 et T044
- [X] T051 [US3] Exécuter les tests T041 à T044 et ajouter les preuves accessibilité/responsive dans specs/008-search/validation.md

**Checkpoint**: La recherche complète et locale est filtrable, paginée et
utilisable sans souris sur tous les viewports V1.

---

## Phase 6: User Story 4 — Résultats frais et récupérables (Priority: P2)

**Goal**: Garantir l'idempotence, le cycle de vie, les reconstructions sûres,
la confidentialité, la restauration et les objectifs de volume.

**Independent Test**: Rejouer 10 000 mutations de cycle de vie, interrompre et
corrompre une reconstruction, restaurer une sauvegarde de référence puis
comparer exactement recherche et état canonique.

### Tests for User Story 4

- [X] T052 [P] [US4] Écrire les propriétés d'idempotence, révision ancienne, ordre stable et absence de doublon dans packages/domain/tests/search.property.spec.ts (FR-017, FR-021, SC-005)
- [X] T053 [P] [US4] Écrire les tests de fault injection build interrompu, enveloppe illisible, upsert échoué et échange atomique dans apps/api/tests/search-rebuild.spec.ts (FR-025, FR-027, FR-028)
- [X] T054 [P] [US4] Étendre l'intégration database pour rename/move/convert/trash/restore/purge et chemins hydratés dans packages/database/tests/search-source.integration.spec.ts (FR-019 à FR-021)
- [X] T055 [P] [US4] Écrire les tests de sécurité prouvant zéro requête/extrait dans URL, logs, diagnostics, PostgreSQL et IndexedDB dans apps/api/tests/search-security.spec.ts et apps/web/tests/search-worker.spec.ts (FR-022 à FR-024)
- [X] T056 [US4] Étendre Playwright avec renommage, déplacement, conversion, corbeille, restauration et état rebuilding dans tests/e2e/search.spec.ts ; conserver la preuve d'un tombstone canonique purged dans T054, l'orchestration de purge restant hors 008 (acceptance US4)
- [X] T057 [P] [US4] Écrire le benchmark p50/p95 des 20 premiers résultats sur 100 000 pages/1 000 000 blocs, de la recherche et de l'upsert sur 10 000 items locaux, de la propagation serveur vers un second appareil et de 10 000 replays dans tests/performance/search.perf.spec.ts (SC-001 à SC-005)

### Implementation for User Story 4

- [X] T058 [US4] Déclencher upsert/remove serveur uniquement après commit et invalider sur échec dans apps/api/src/plugins/mutations.ts et apps/api/src/search/search-service.ts pour satisfaire T052 et T053
- [X] T059 [US4] Gérer conversion, trash, restore, purge et conflit sans entrée fantôme dans packages/domain/src/search/search-index.ts et apps/api/src/search/search-service.ts pour satisfaire T054
- [X] T060 [US4] Exposer un état search redacted dans apps/api/src/routes/health.ts et refuser les pages serveur pendant building/degraded dans apps/api/src/routes/search.ts
- [X] T061 [US4] Ajouter la reconstruction après restauration de référence dans packages/database/tests/reference-backups.integration.spec.ts une fois la feature 007 fusionnée (FR-026, SC-006)
- [X] T062 [US4] Documenter exploitation, reconstruction, mémoire, diagnostics et confidentialité dans docs/architecture/search.md
- [X] T063 [US4] Optimiser extraction, lots, worker et limites jusqu'à réussite du benchmark T057 sans persister l'index dans packages/domain/src/search/search-index.ts, apps/api/src/search/search-service.ts et apps/web/src/features/search/search.worker.ts
- [X] T064 [US4] Exécuter les tests T052 à T057 et compléter les preuves cycle de vie, sécurité, reprise et performance dans specs/008-search/validation.md

**Checkpoint**: Toutes les stories et tous les scénarios critiques sont
fonctionnels, sûrs et mesurés.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Converger les artefacts, la documentation, les navigateurs et les
gates avant publication.

- [X] T065 [P] Vérifier que chaque nouveau test et consommateur possède un propriétaire minimal dans ci/test-impact.json et tests/contract/test-impact.spec.ts
- [X] T066 [P] Mettre à jour docs/development.md avec les commandes ciblées et le jeu de performance de recherche sans dupliquer quickstart.md
- [X] T067 Exécuter tous les scénarios de specs/008-search/quickstart.md et consigner leurs sorties utiles dans specs/008-search/validation.md
- [X] T068 Exécuter format, lint, typecheck, unit, integration, contract, performance et la matrice Playwright ciblée, corriger chaque échec et consigner le résultat dans specs/008-search/validation.md
- [X] T069 Exécuter pnpm checks:local sur le commit final exact conformément à docs/development.md et enregistrer le résultat dans specs/008-search/validation.md
- [X] T070 Lancer speckit-converge, ajouter toute tâche manquante à specs/008-search/tasks.md, l'implémenter et ne laisser aucune case ouverte avant le push

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 n'a pas de dépendance.
- Phase 2 dépend de Phase 1 et bloque toutes les stories.
- US1 dépend de Phase 2 et constitue le MVP en ligne.
- US2 dépend du moteur commun de Phase 2 et peut commencer en parallèle d'US1
  après stabilisation des types ; son intégration UI finale dépend de T025.
- US3 dépend des surfaces US1/US2, mais ses tests de filtre et accessibilité
  peuvent être écrits en parallèle.
- US4 dépend des comportements complets US1 à US3.
- T061 et l'intégration finale dépendent de la fusion de la feature 007.
- Phase 7 dépend des quatre stories.

### User Story Dependency Graph

~~~text
Setup -> Foundation -> US1 online MVP
                    \-> US2 local-first
US1 + US2 -> US3 filters/keyboard
US1 + US2 + US3 -> US4 lifecycle/recovery/performance
US4 -> Polish -> full local gate -> push/PR
~~~

### Parallel Opportunities

- T002 et T003 peuvent avancer pendant T001.
- T004 à T008 écrivent des suites différentes et peuvent être préparées en
  parallèle.
- T016 à T019, T029 à T032, T041 à T044 et T052 à T057 sont parallélisables
  par groupe avant leurs implémentations respectives.
- Documentation T062, cartographie T065 et documentation de développement T066
  peuvent avancer après stabilisation des contrats.

## Parallel Examples

### User Story 1

~~~text
T016 service serveur
T017 contrat HTTP et sécurité
T018 composant Web
T019 parcours Playwright
~~~

### User Story 2

~~~text
T029 source locale
T030 fusion local/serveur
T031 worker transitoire
T032 parcours offline
~~~

### User Story 3

~~~text
T041 filtres/cursor API
T042 clavier/focus UI
T044 accessibilité
~~~

### User Story 4

~~~text
T052 propriétés d'index
T053 fault injection rebuild
T054 cycle de vie database
T055 non-persistance et redaction
T057 performance de référence
~~~

## Implementation Strategy

### MVP First

1. Phase 1 : dépendance et frontières.
2. Phase 2 : moteur commun et contrats.
3. Phase 3 : recherche serveur et interface en ligne.
4. Valider le MVP indépendamment avant d'ajouter le worker local.

### Incremental Delivery

1. US1 livre la recherche complète en ligne.
2. US2 ajoute la promesse local-first sans modifier le contrat canonique.
3. US3 ajoute filtres, pagination et accessibilité.
4. US4 ferme les risques de cohérence, sécurité, restauration et volume.
5. La convergence puis le gate complet précèdent tout push.

## Notes

- Les tests d'une story sont écrits avant son implémentation et doivent échouer
  pour la raison attendue.
- Aucun task ne doit sérialiser MiniSearch, les lexèmes, les requêtes ou les
  extraits.
- Les cases ne sont cochées qu'après réussite des critères et tests concernés.
- Les commits restent petits et groupés par checkpoint logique.

## Phase 8: Convergence

- [X] T071 Faire indexer et rechercher une requête composée uniquement de symboles visibles, avec tests domaine et navigateur, per FR-002 et US1/AC4 (partial)
- [X] T072 Remplacer la limite HTML fondée sur les unités UTF-16 par un comptage de 512 caractères Unicode et un refus explicite au-delà, avec tests interface et contrat, per FR-034 (contradicts)
- [X] T073 Conserver le marqueur de conflit lorsqu'une correspondance existe seulement dans la version serveur concurrente et couvrir les termes propres aux deux versions per FR-018 et l'edge case conflit (partial)
- [X] T074 Unifier le filtre de branche local avec les descendants hiérarchiques serveur, y compris les fichiers à placements multiples et l'exclusion des simples attachments, per FR-010 et T046 (contradicts)
- [X] T075 Découper la reconstruction serveur en lots qui rendent la main à l'event loop et prouver qu'une route sans rapport reste réactive pendant un gros build per plan: non-blocking rebuild et T023 (contradicts)
- [X] T076 Documenter l'état search optionnel de `/health` dans le contrat OpenAPI canonique et tester sa parité avec le schéma runtime per T060 et FR-023 (missing)
- [X] T077 Renforcer la restauration de référence pour comparer identité, révision, type, chemin et champ recherché avec l'état canonique attendu per SC-006 et T061 (partial)
- [X] T078 Ajouter un parcours sur deux appareils prouvant qu'une mutation acceptée devient recherchable sur le second avec identité unique et mesure de propagation per SC-004 (partial)
- [X] T079 Déclarer le benchmark search comme consommateur explicite des sources de recherche dans la sélection CI et verrouiller cette relation par contrat per T003 et T065 (partial)
- [X] T080 Aligner les artefacts 008 sur la frontière de cycle de vie approuvée : recherche d'un tombstone purgé prouvée ici, orchestration de purge avec confirmation, références, synchronisation et sauvegardes réservée à une feature dédiée, per US4/AC3, FR-020 et product canvas §33 (contradicts)
