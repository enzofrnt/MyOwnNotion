# Tasks: Bases de données et tâches structurées

**Input**: Design documents from
`/specs/009-databases-structured-tasks/`

**Prerequisites**: spec.md, plan.md, research.md, data-model.md,
contracts/database-api.openapi.yaml, contracts/database-ui.md, quickstart.md

**Tests**: Obligatoires. La constitution, la spec et le canevas exigent tests
domaine, propriétés, migrations, intégration, contrats, sécurité, Playwright,
offline, conflits, restauration et performance.

**Organization**: Les tâches sont regroupées par user story. Les stories P1
sont livrées avant les vues visuelles P2 ; chaque phase produit un checkpoint
indépendamment vérifiable.

## Format: [ID] [P?] [Story] Description

- **[P]**: fichier distinct et aucune dépendance inachevée
- **[USn]**: user story correspondante dans spec.md
- Chaque tâche cite le chemin exact et les exigences principales

## Phase 1: Setup

**Purpose**: Installer les briques retenues et ouvrir les frontières de module
sans modifier encore le comportement.

- [X] T001 Ajouter `@tanstack/react-table@9.1.2` et `@tanstack/react-virtual@3.14.10` à apps/web/package.json, `decimal.js-light@2.5.1` à packages/domain/package.json avec pnpm 10.33.3, puis mettre à jour pnpm-lock.yaml
- [X] T002 [P] Créer packages/domain/src/databases/index.ts, packages/client-core/src/databases/index.ts et leurs exports depuis packages/domain/src/index.ts et packages/client-core/src/index.ts
- [X] T003 [P] Enregistrer le contrat 009 et rattacher les nouveaux préfixes databases aux parcours E2E transversaux existants dans ci/test-impact.json ; les tests dédiés et performance seront ajoutés à leur création puis vérifiés par T108

---

## Phase 2: Foundational

**Purpose**: Définir les valeurs, schémas, requêtes, fusions, contrats,
persistance protégée et projection locale qui bloquent toutes les stories.

**⚠️ CRITICAL**: Aucune user story ne commence avant ce checkpoint.

### Tests fondamentaux

- [X] T004 [P] Écrire les tests de décimaux, dates civiles, instants, valeurs absentes, options et relations dans packages/domain/tests/databases/values.spec.ts (FR-009 à FR-013, FR-050)
- [X] T005 [P] Écrire les tests de définition garantissant titre unique, propriétés/options stables, vues actives et rôles compatibles dans packages/domain/tests/databases/schema.spec.ts (FR-006 à FR-010, FR-016 à FR-018, FR-030)
- [X] T006 [P] Écrire les propriétés fast-check de filtres ALL/ANY, tris déterministes, groupes uniques et invariance à l'ordre d'entrée dans packages/domain/tests/databases/query.property.spec.ts (FR-019 à FR-021, SC-005, SC-006)
- [X] T007 [P] Écrire les tests de fusion à trois voies des définitions et valeurs, dont suppression contre édition et type contre valeur, dans packages/domain/tests/databases/merge.spec.ts (FR-037, FR-038, SC-007)
- [X] T008 [P] Étendre le validateur OpenAPI pour charger contracts/database-api.openapi.yaml et ses références dans tests/contract/openapi.spec.ts (FR-009, FR-019, FR-043)
- [X] T009 [P] Écrire les tests de migration montante, interruption/reprise, contraintes d'identité et rollback de 0007_databases.sql dans packages/database/tests/migrations.integration.spec.ts (FR-003 à FR-006, FR-039)

### Implémentation fondamentale

- [X] T010 Définir DatabaseDefinition, DatabaseProperty, DatabaseView, TaskRoleMapping, EntryValues et leurs unions dans packages/domain/src/databases/types.ts selon data-model.md
- [X] T011 Implémenter validation/normalisation des décimaux, dates, instants, options, absence et relations dans packages/domain/src/databases/values.ts pour satisfaire T004
- [X] T012 Implémenter validation de définition, aperçu d'impact et règles de conversion/retrait dans packages/domain/src/databases/schema.ts pour satisfaire T005
- [X] T013 Implémenter opérateurs typés, ALL/ANY, groupes et ordre stable partagé dans packages/domain/src/databases/query.ts pour satisfaire T006
- [X] T014 Implémenter les fusions pures DatabaseDefinition et EntryValues par identités stables dans packages/domain/src/databases/merge.ts pour satisfaire T007
- [X] T015 Définir les schémas TypeBox de base, définition, entrée, requête et problèmes sûrs dans packages/contracts/src/content-api.ts conformément au contrat OpenAPI
- [X] T016 Ajouter `databases` et `database_entries` au schéma Drizzle et créer packages/database/migrations/0007_databases.sql avec toutes les FK, checks et index de data-model.md
- [X] T017 Ajouter les types protégés `database.definition` et `database.entry-values`, leurs codecs serveur et les formes locales scellées dans apps/api/src/security/protected-content.ts, packages/client-core/src/security/local-record-codec.ts et packages/client-core/src/local-store/schema.ts

**Checkpoint**: Les mêmes valeurs, définitions, requêtes et fusions produisent
un résultat identique dans Node et le navigateur ; les nouvelles lignes ne
contiennent aucun payload privé en clair.

---

## Phase 3: User Story 1 — Structurer une collection de pages (Priority: P1) 🎯 MVP

**Goal**: Créer une base page, ses propriétés et des entrées pages avec valeurs
typées et relations canoniques.

**Independent Test**: Créer « Projets », ajouter chaque type obligatoire, créer
trois entrées, modifier leurs valeurs et ouvrir leur document éditorial sans
changer ni dupliquer leur identité.

### Tests for User Story 1

- [ ] T018 [P] [US1] Écrire les tests de parsing/idempotence des commandes `database.create`, `database.definition.replace`, `database.entry.create` et `database.entry.values.replace` dans packages/domain/tests/databases/commands.spec.ts (FR-001 à FR-015)
- [ ] T019 [P] [US1] Écrire les tests d'intégration de création, appartenance unique, valeurs protégées, relations, conversion et transaction rollback dans packages/database/tests/database.integration.spec.ts (FR-001 à FR-015)
- [ ] T020 [P] [US1] Écrire les tests de contrat propriétaire pour créer/lire/remplacer définition et entrée, preview d'impact et erreurs sans contenu dans apps/api/tests/database.contract.spec.ts
- [ ] T021 [P] [US1] Écrire les tests Dexie d'application optimiste atomique, préparation crypto hors transaction et rejeu de création/valeurs dans packages/client-core/tests/database-local-mutation.spec.ts (FR-003, FR-009, FR-036)
- [ ] T022 [P] [US1] Écrire les tests React de création de base, éditeur de schéma, validation sans perte de saisie et panneau d'entrée dans apps/web/tests/database-editor.spec.tsx (FR-001, FR-007, FR-009, FR-014)
- [ ] T023 [US1] Écrire le parcours Playwright chronométré sous cinq minutes pour création de base, huit types, entrée-page, renommage, déplacement et relation stable dans tests/e2e/databases-schema.spec.ts (acceptance US1, SC-001)

### Implementation for User Story 1

- [ ] T024 [US1] Ajouter les commandes structurées, leur parseur strict, leurs payloads et nouveaux SafeErrorCode dans packages/domain/src/databases/commands.ts, packages/domain/src/content/mutations.ts et packages/domain/src/content/types.ts pour satisfaire T018
- [ ] T025 [US1] Implémenter les lectures/écritures transactionnelles de DatabaseRecord, DatabaseEntryRecord, définition, valeurs et relations dans packages/database/src/repositories/database-repository.ts pour satisfaire T019
- [ ] T026 [US1] Exécuter les commandes structurées avec révisions, snapshots, changement unique et idempotence ; inclure l'état structuré dans toute révision ordinaire d'une page hôte/entrée et refuser leur conversion incompatible en dossier dans packages/database/src/mutations/database-commands.ts et packages/database/src/mutations/execute-command.ts
- [ ] T027 [US1] Sceller avant commit et ouvrir après lecture les définitions, valeurs et métadonnées de relations dans apps/api/src/security/protected-content.ts et apps/api/src/security/content-resolution.ts
- [ ] T028 [US1] Implémenter POST/GET/PUT, aperçu d'impact et réponses typées dans apps/api/src/routes/databases.ts, puis enregistrer les routes dans apps/api/src/app.ts pour satisfaire T020
- [ ] T029 [US1] Ajouter les méthodes base/entrée/définition/valeurs à apps/web/src/services/content-api.ts sans mettre de contenu privé dans les URLs
- [ ] T030 [US1] Ajouter les stores Dexie version 6, migration locale et opérations ouvertes/scellées dans packages/client-core/src/local-store/schema.ts et packages/client-core/src/databases/local-database-repository.ts
- [ ] T031 [US1] Appliquer les quatre commandes structurées dans la projection optimiste et l'outbox atomiques dans packages/client-core/src/outbox/apply-local-mutation.ts et packages/client-core/src/outbox/apply-to-projection.ts pour satisfaire T021
- [ ] T032 [US1] Exposer les lectures et mutations structurées dans apps/web/src/services/local-content.ts avec notifications de projection après commit local
- [ ] T033 [US1] Ajouter la création et l'ouverture de base à apps/web/src/features/navigation/sidebar.tsx et apps/web/src/features/hierarchy/hierarchy-explorer.tsx sans ajouter un nouvel ItemKind
- [ ] T034 [US1] Implémenter le shell de base, l'éditeur de propriétés/options, l'aperçu d'impact et la conservation des saisies dans apps/web/src/features/databases/database-page.tsx et apps/web/src/features/databases/property-editor.tsx pour satisfaire T022
- [ ] T035 [US1] Implémenter création/ouverture d'entrée, valeurs typées, relation picker et éditeur par blocs dans apps/web/src/features/databases/entry-panel.tsx et apps/web/src/features/databases/value-editor.tsx
- [ ] T036 [US1] Ajouter styles d'états, formulaire, panneau et erreurs de base dans apps/web/src/styles.css à 320 px et zoom 200 %
- [ ] T037 [US1] Exécuter T018 à T023 et consigner le checkpoint MVP, les identités et le stockage protégé dans specs/009-databases-structured-tasks/validation.md

**Checkpoint**: Une base et ses entrées-pages sont utilisables en ligne et
hors ligne localement ; aucune vue avancée n'est nécessaire pour prouver US1.

---

## Phase 4: User Story 2 — Retrouver une organisation enregistrée (Priority: P1)

**Goal**: Créer des vues table/liste enregistrées avec propriétés visibles,
filtres, tris et groupes identiques sur serveur et projection locale.

**Independent Test**: Enregistrer plusieurs vues table/liste, fermer puis
rouvrir l'application et comparer identités, ordre, groupes, colonnes et
propriétés masquées sur deux clients.

### Tests for User Story 2

- [ ] T038 [P] [US2] Écrire les tests de génération atomique, index de présence/égalité, upsert et invalidation dans apps/api/tests/database-query-service.spec.ts (FR-019 à FR-022, SC-002)
- [ ] T039 [P] [US2] Étendre les contrats API avec query, curseur lié, cursor-stale, pagination sans doublon et projection degraded dans apps/api/tests/database.contract.spec.ts
- [ ] T040 [P] [US2] Écrire les tests de requête locale complète et partielle, parité serveur et recalcul après commit dans packages/client-core/tests/database-query.spec.ts (FR-022, FR-034, FR-035)
- [ ] T041 [P] [US2] Écrire les tests React de barre de vues, filtre ALL/ANY, tri, groupe, colonnes visibles/redimensionnées et liste dans apps/web/tests/database-views.spec.tsx (FR-016 à FR-024)
- [ ] T042 [P] [US2] Écrire les tests de grid clavier, mode navigation/édition, focus virtualisé et annonces dans apps/web/tests/database-table-accessibility.spec.tsx (FR-023, FR-047 à FR-049)
- [ ] T043 [US2] Écrire le parcours Playwright table/liste, persistance, filtres, tris, groupes, retour de focus et deuxième navigateur dans tests/e2e/databases-views.spec.ts (acceptance US2)

### Implementation for User Story 2

- [ ] T044 [US2] Implémenter StructuredProjectionGeneration, reconstruction isolée et index incrémentaux dans apps/api/src/databases/database-query-service.ts pour satisfaire T038
- [ ] T045 [US2] Construire et injecter la projection structurée dans apps/api/src/context.ts et apps/api/src/app.ts sans bloquer les autres routes pendant building
- [ ] T046 [US2] Appliquer les mutations à la projection uniquement après commit, invalider sur échec et reconstruire après démarrage/restauration dans apps/api/src/plugins/mutations.ts et apps/api/src/databases/database-query-service.ts
- [ ] T047 [US2] Implémenter POST /v1/databases/:databaseId/query, curseur opaque authentifié et états building/degraded dans apps/api/src/routes/databases.ts pour satisfaire T039
- [ ] T048 [US2] Implémenter le moteur local commun et la couverture dans packages/client-core/src/databases/local-database-query.ts pour satisfaire T040
- [ ] T049 [US2] Ajouter query server/local, fusion par entryId, reprise cursor-stale et conservation pending/conflict dans apps/web/src/services/databases.ts
- [ ] T050 [US2] Implémenter création, duplication, réordonnancement, retrait et sélection de vues via DatabaseDefinition dans apps/web/src/features/databases/database-toolbar.tsx
- [ ] T051 [US2] Implémenter l'éditeur lisible de filtres, tris et groupes dans apps/web/src/features/databases/filter-editor.tsx et apps/web/src/features/databases/sort-group-editor.tsx
- [ ] T052 [US2] Implémenter la table contrôlée en modes manuels avec TanStack Table/Virtual, colonnes, cellules typées et redimensionnement dans apps/web/src/features/databases/table-view.tsx pour satisfaire T041 et T042
- [ ] T053 [US2] Implémenter la liste compacte sémantique dans apps/web/src/features/databases/list-view.tsx
- [ ] T054 [US2] Restaurer contexte de vue, sélection et position après ouverture d'une entrée dans apps/web/src/features/databases/use-database-view.ts et apps/web/src/features/databases/entry-panel.tsx
- [ ] T055 [US2] Afficher complete/partial, X/Y, invalid-view, loading et stale-cursor dans apps/web/src/features/databases/database-page.tsx sans annoncer de total partiel comme exhaustif
- [ ] T056 [US2] Finaliser les styles table/list, conteneur de scroll interne, focus et commandes fixes dans apps/web/src/styles.css
- [ ] T057 [US2] Exécuter T038 à T043 et consigner parité, pagination, accessibilité et persistance dans specs/009-databases-structured-tasks/validation.md

**Checkpoint**: Table et liste enregistrées produisent le même résultat
déterministe côté serveur et local, y compris après rechargement.

---

## Phase 5: User Story 3 — Suivre des tâches structurées (Priority: P1)

**Goal**: Mapper statut, échéance et priorité sur des propriétés existantes et
suivre une tâche-page dans toutes les surfaces sans lier les checkboxes du
document.

**Independent Test**: Configurer une base de tâches, créer une tâche avec notes,
changer ses rôles depuis plusieurs surfaces et vérifier la recherche, les
relations et l'indépendance d'une checkbox éditoriale.

### Tests for User Story 3

- [ ] T058 [P] [US3] Étendre les tests de schéma avec activation/désactivation des rôles, types incompatibles et renommage de propriété mappée dans packages/domain/tests/databases/schema.spec.ts (FR-030 à FR-033)
- [ ] T059 [P] [US3] Écrire les tests d'indexation des textes, options de tâche, échéance, matched property et déduplication par entrée dans packages/domain/tests/search-index.spec.ts et packages/client-core/tests/local-search-source.spec.ts (FR-041, FR-042)
- [ ] T060 [P] [US3] Écrire les tests React de configuration des rôles et panneau tâche/page dans apps/web/tests/database-tasks.spec.tsx
- [ ] T061 [US3] Écrire le parcours Playwright tâche, notes, statut, échéance, priorité, relation, recherche et checkbox indépendante dans tests/e2e/databases-tasks.spec.ts (acceptance US3)

### Implementation for User Story 3

- [ ] T062 [US3] Implémenter les règles TaskRoleMapping et la projection sémantique sans données dupliquées dans packages/domain/src/databases/schema.ts et packages/domain/src/databases/types.ts pour satisfaire T058
- [ ] T063 [US3] Ajouter la configuration explicite des rôles et leurs états invalides dans apps/web/src/features/databases/task-configuration.tsx et database-page.tsx
- [ ] T064 [US3] Présenter statut, échéance, priorité, propriétés ordinaires et document dans un même parcours dans apps/web/src/features/databases/entry-panel.tsx pour satisfaire T060
- [ ] T065 [US3] Étendre SearchDocument, extraction et résultat avec propertyId/matchedField structurés dans packages/domain/src/search/types.ts, packages/domain/src/search/document-text.ts et packages/domain/src/search/search-index.ts
- [ ] T066 [US3] Hydrater les valeurs structurées actives dans packages/database/src/repositories/search-source-repository.ts et packages/client-core/src/search/local-search-source.ts sans index persistant
- [ ] T067 [US3] Mettre à jour l'index serveur/local après commit de valeur/rôle et afficher la propriété correspondante dans apps/api/src/search/search-service.ts, apps/web/src/features/search/search.worker.ts et apps/web/src/features/search/search-results.tsx
- [ ] T068 [US3] Garantir qu'aucune mutation de bloc checkbox ne crée ou ne modifie une entrée structurée dans packages/domain/tests/databases/commands.spec.ts et apps/web/src/features/editor/editor-surface.tsx
- [ ] T069 [US3] Exécuter T058 à T061 et consigner les preuves tâche-page et recherche dans specs/009-databases-structured-tasks/validation.md

**Checkpoint**: Les tâches sont des pages structurées uniques, trouvables et
modifiables, sans synchronisation implicite avec les checkboxes éditoriales.

---

## Phase 6: User Story 5 — Continuer hors ligne et converger sans perte (Priority: P1)

**Goal**: Transporter définitions, appartenances, valeurs, relations et conflits
dans la projection locale, le flux, les snapshots et les sauvegardes, puis
fusionner uniquement les changements compatibles.

**Independent Test**: Précharger sur deux appareils, modifier hors ligne schéma,
valeurs et vues, redémarrer, reconnecter, résoudre les conflits et restaurer une
sauvegarde en retrouvant exactement l'état observable.

### Tests for User Story 5

- [ ] T070 [P] [US5] Écrire les tests de migration Dexie v6, scellement, épinglage, déchargement et couverture après redémarrage dans packages/client-core/tests/database-local-store.spec.ts (FR-034 à FR-036)
- [ ] T071 [P] [US5] Écrire les tests de crash entre préparation/transaction, rejeu idempotent et absence d'état partiel dans packages/client-core/tests/database-local-mutation.spec.ts (FR-036, SC-005)
- [ ] T072 [P] [US5] Écrire les tests de fusion/rebase automatique et capture durable de conflit structuré dans packages/client-core/tests/database-reconciliation.spec.ts (FR-037 à FR-040)
- [ ] T073 [P] [US5] Écrire les tests contrat/intégration du change feed et snapshot avec digest couvrant définitions, entrées, valeurs et relations dans apps/api/tests/sync.contract.spec.ts et packages/database/tests/change-feed.integration.spec.ts (FR-039)
- [ ] T074 [P] [US5] Étendre les tests export, sauvegarde, validation et restauration de référence avec le modèle 009 dans apps/api/tests/export.contract.spec.ts et packages/database/tests/reference-backups.integration.spec.ts (FR-044, SC-008)
- [ ] T075 [US5] Écrire le parcours Playwright deux appareils/offline/redémarrage/fusion/conflit/résolution/couverture partielle et collecter le délai de propagation distante dans tests/e2e/databases-offline-sync.spec.ts (acceptance US5, SC-004)

### Implementation for User Story 5

- [ ] T076 [US5] Étendre ItemDto, ChangeEnvelopeDto et CanonicalSnapshotDto avec définitions/entrées/relations structurées dans packages/contracts/src/content-api.ts en conservant la compatibilité de lecture
- [ ] T077 [US5] Hydrater les payloads structurés et relations dans apps/api/src/routes/changes.ts et apps/api/src/routes/snapshots.ts, puis inclure les quatre ensembles triés dans le digest pour satisfaire T073
- [ ] T078 [US5] Appliquer snapshot/change atomiquement dans LocalRepository, y compris relations, databases et databaseEntries, sans effacer outbox/conflicts dans packages/client-core/src/local-store/local-repository.ts et packages/client-core/src/reconciliation/reconcile.ts
- [ ] T079 [US5] Implémenter l'épinglage de base, la disponibilité de ses valeurs et les règles de déchargement dans apps/web/src/services/storage-manager.ts et packages/client-core/src/databases/local-database-repository.ts pour satisfaire T070
- [ ] T080 [US5] Brancher la fusion à trois voies structurée, le rebase et les limites d'une fusion par pass dans packages/client-core/src/reconciliation/reconcile.ts pour satisfaire T072
- [ ] T081 [US5] Étendre ConflictRecord, lecture de snapshots et commandes de résolution à deux parents pour définition/valeurs dans packages/client-core/src/local-store/schema.ts, packages/client-core/src/reconciliation/resolve-conflict.ts et packages/domain/src/databases/commands.ts
- [ ] T082 [US5] Implémenter la comparaison et résolution UI ancêtre/local/distant pour schéma, vue et valeur dans apps/web/src/features/sync/conflict-resolution.tsx et apps/web/src/features/databases/database-conflict-resolution.tsx
- [ ] T083 [US5] Ajouter tables, enveloppes, relations et révisions 009 à l'export versionné dans apps/api/src/routes/export.ts et apps/api/src/backup/restore-service.ts
- [ ] T084 [US5] Ajouter les nouvelles tables à la vidange/restauration transactionnelle, aux comptes et aux digests dans apps/api/src/backup/database-restore-target.ts et apps/api/src/backup/backup-service.ts pour satisfaire T074
- [ ] T085 [US5] Étendre la version de protocole et le mode lecture seule pour clients incompatibles dans packages/domain/src/sync/protocol-version.ts et apps/api/src/plugins/protocol.ts (FR-040)
- [ ] T086 [US5] Auditer/redacter valeurs, filtres, libellés et erreurs structurées dans apps/api/src/plugins/logging.ts, apps/api/src/routes/databases.ts et packages/domain/src/content/types.ts (FR-043, SC-009)
- [ ] T087 [US5] Exécuter T070 à T075 et consigner reprise, convergence, conflits, sauvegarde et confidentialité dans specs/009-databases-structured-tasks/validation.md

**Checkpoint**: Les bases restent utilisables localement, survivent au crash,
rattrapent un autre appareil et restaurent toutes leurs identités sans perte.

---

## Phase 7: User Story 4 — Changer de perspective sans dupliquer les données (Priority: P2)

**Goal**: Ajouter Kanban, galerie et calendrier sur la même projection et les
mêmes commandes, avec équivalents clavier et rendu responsive.

**Independent Test**: Afficher la même base dans les trois vues, déplacer une
carte et une date au pointeur puis au clavier, ouvrir une carte galerie et
vérifier une identité/valeur unique dans toutes les vues.

### Tests for User Story 4

- [ ] T088 [P] [US4] Écrire les tests React de colonnes/groupes et mouvement Kanban par propriété statut/sélection dans apps/web/tests/database-board.spec.tsx (FR-025, FR-048)
- [ ] T089 [P] [US4] Écrire les tests React de galerie, propriétés choisies et fallback d'aperçu sûr dans apps/web/tests/database-gallery.spec.tsx (FR-026)
- [ ] T090 [P] [US4] Écrire les tests React de calendrier date/instant, zone non planifiée et changement de fuseau dans apps/web/tests/database-calendar.spec.tsx (FR-027, FR-050)
- [ ] T091 [P] [US4] Ajouter les audits axe des cinq vues et alternatives au drag-and-drop dans tests/e2e/accessibility.spec.ts (FR-047 à FR-049, SC-010)
- [ ] T092 [US4] Écrire le parcours Playwright Kanban/galerie/calendrier, pointeur, clavier, identité unique, 320 px et zoom 200 % dans tests/e2e/databases-visual-views.spec.ts (acceptance US4)
- [ ] T093 [P] [US4] Écrire dans tests/performance/databases.perf.spec.ts le benchmark p95 des cinq vues et 100 premières entrées sur 100 000 entrées sous une seconde, des commits locaux sous 300 ms, de la propagation sur deux appareils sous deux secondes, ainsi que 10 000 créations/éditions/replays/corbeilles/restaurations sans doublon ni perte (SC-002 à SC-006)

### Implementation for User Story 4

- [ ] T094 [US4] Implémenter le Kanban, colonnes manquantes et déplacement via la même commande de valeur dans apps/web/src/features/databases/board-view.tsx pour satisfaire T088
- [ ] T095 [US4] Implémenter la galerie et le choix d'aperçu déjà autorisé/disponible dans apps/web/src/features/databases/gallery-view.tsx pour satisfaire T089
- [ ] T096 [US4] Implémenter calendrier date/instant, navigation et espace non planifié dans apps/web/src/features/databases/calendar-view.tsx pour satisfaire T090
- [ ] T097 [US4] Ajouter aux cartes Kanban et calendrier les actions clavier équivalentes et annonces de cible dans apps/web/src/features/databases/board-view.tsx et apps/web/src/features/databases/calendar-view.tsx
- [ ] T098 [US4] Virtualiser lignes/cartes longues sans perdre aria-rowcount, positions ni focus dans apps/web/src/features/databases/table-view.tsx, board-view.tsx et gallery-view.tsx
- [ ] T099 [US4] Finaliser responsive 320 px, zoom 200 %, reduced-motion, scrolling local et panneaux plein écran des cinq vues dans apps/web/src/styles.css
- [ ] T100 [US4] Optimiser projection, index, top-K, lots et overscan jusqu'à réussite de T093 dans packages/domain/src/databases/query.ts, apps/api/src/databases/database-query-service.ts et apps/web/src/features/databases/
- [ ] T101 [US4] Exécuter T088 à T093 et consigner vues, accessibilité, responsive et performance dans specs/009-databases-structured-tasks/validation.md

**Checkpoint**: Les cinq vues montrent et modifient les mêmes pages canoniques,
sans geste de pointeur obligatoire ni perte de contexte.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Fermer cycle de vie, sécurité, documentation, navigateurs et gates
avant publication.

- [ ] T102 [P] Écrire les tests de mise à la corbeille/restauration atomique d'une base et de ses entrées, rollback et réaction au tombstone purged dans packages/database/tests/database-lifecycle.integration.spec.ts et packages/client-core/tests/database-query.spec.ts (FR-045, FR-046)
- [ ] T103 Implémenter aperçu, révisions multiples et transaction de corbeille/restauration de base dans packages/database/src/mutations/database-commands.ts, apps/api/src/routes/items.ts et packages/client-core/src/outbox/apply-to-projection.ts pour satisfaire T102
- [ ] T104 [P] Étendre les tests sécurité avec sentinelles PostgreSQL, IndexedDB, URL, logs, erreurs, export et sauvegarde dans apps/api/tests/database-security.spec.ts et tests/e2e/databases-security.spec.ts (FR-043, SC-009)
- [ ] T105 [P] Mettre à jour docs/architecture/databases.md avec modèle page-capacité, chiffrement, projection, conflits, exploitation, limites et reconstruction
- [ ] T106 [P] Mettre à jour docs/development.md avec commandes ciblées, migration 0007 et benchmark 009 sans dupliquer quickstart.md
- [ ] T107 [P] Mettre à jour docs/product/roadmap.md pour relier 009 à ses artefacts et refléter son état de livraison sans modifier les frontières 010 à 015
- [ ] T108 Vérifier que chaque nouveau test/consommateur possède un propriétaire minimal dans ci/test-impact.json et tests/contract/test-impact.spec.ts
- [ ] T109 Exécuter tous les scénarios de specs/009-databases-structured-tasks/quickstart.md et consigner les résultats utiles dans specs/009-databases-structured-tasks/validation.md
- [ ] T110 Exécuter format, lint, typecheck, unit, property, integration, migration, contract, security, performance et la matrice Playwright ciblée, corriger chaque échec et consigner le résultat dans specs/009-databases-structured-tasks/validation.md
- [ ] T111 Exécuter pnpm checks:local sur le commit final exact conformément à docs/development.md et enregistrer le résultat dans specs/009-databases-structured-tasks/validation.md
- [ ] T112 Lancer speckit-converge, ajouter toute tâche manquante à specs/009-databases-structured-tasks/tasks.md, l'implémenter et ne laisser aucune case ouverte avant le push

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 n'a pas de dépendance.
- Phase 2 dépend de Phase 1 et bloque toutes les stories.
- US1 dépend de Phase 2 et constitue le MVP.
- US2 dépend des définitions/entrées US1.
- US3 dépend de US1 et de la projection/recherche de US2 pour sa preuve complète.
- US5 dépend de US1 et US2 ; ses tests de fusion peuvent avancer après Phase 2.
- US4 dépend de la projection et des commandes US2, puis bénéficie de US3 pour
  les vues de tâches, mais ne possède aucune donnée canonique propre.
- Phase 8 dépend des cinq stories.

### User Story Dependency Graph

~~~text
Setup -> Foundation -> US1 schema/entries (MVP)
                            |
                            +-> US2 table/list/query
                                  |
                                  +-> US3 structured tasks
                                  +-> US5 offline/sync/recovery
                                  +-> US4 board/gallery/calendar
US1 + US2 + US3 + US5 + US4 -> lifecycle/polish -> full local gate -> push/PR
~~~

### Parallel Opportunities

- T002 et T003 peuvent avancer pendant T001.
- T004 à T009 écrivent des suites différentes et peuvent être préparées en
  parallèle.
- Les groupes de tests T018 à T023, T038 à T043, T058 à T061, T070 à T075 et
  T088 à T093 sont parallélisables avant leurs implémentations respectives.
- US3 et une partie de US5 peuvent avancer en parallèle une fois US2 stable.
- T104 à T107 sont parallélisables après stabilisation des contrats.

## Parallel Examples

### User Story 1

~~~text
T018 commandes domaine
T019 intégration PostgreSQL
T020 contrat API
T021 projection locale
T022 composants React
T023 parcours Playwright
~~~

### User Story 2

~~~text
T038 projection serveur
T039 contrat query/cursor
T040 requête locale
T041 vues React
T042 grid accessible
T043 parcours multi-client
~~~

### User Story 3

~~~text
T058 règles de rôles
T059 extension recherche
T060 panneau de tâche
T061 parcours Playwright
~~~

### User Story 5

~~~text
T070 stockage local
T071 reprise après crash
T072 fusion/conflits
T073 flux/snapshot
T074 sauvegarde/restauration
T075 parcours deux appareils
~~~

### User Story 4

~~~text
T088 Kanban
T089 galerie
T090 calendrier
T091 accessibilité
T092 parcours visuel
T093 performance
~~~

## Implementation Strategy

### MVP First

1. Phase 1 — Setup.
2. Phase 2 — valeurs, définition, persistance et protection.
3. Phase 3 — US1 uniquement.
4. Valider la création d'une vraie base et d'entrées-pages avant d'ajouter les
   projections.

### Incremental Delivery

1. US1 livre schéma et entrées.
2. US2 rend table/liste enregistrables et déterministes.
3. US3 active les tâches sur ce même modèle.
4. US5 ferme les garanties local-first, conflits et reprise avant les vues P2.
5. US4 ajoute Kanban, galerie et calendrier sans nouvelle donnée canonique.
6. Phase 8 ferme cycle de vie, sécurité, documentation et gates.

### Independent Completion Criteria

- **US1**: une base avec huit types et plusieurs entrées reste faite de pages
  canoniques ouvrables et de valeurs validées.
- **US2**: table/liste, ALL/ANY, tris et groupes sont persistés et identiques sur
  deux clients.
- **US3**: statut, échéance et priorité modifient la même page-tâche, tandis
  qu'une checkbox de document reste indépendante.
- **US5**: une modification offline survit au crash, converge ou produit un
  conflit conservant toutes les versions, puis une sauvegarde restaure l'état.
- **US4**: Kanban, galerie et calendrier modifient les mêmes entrées au pointeur
  et au clavier, à 320 px et zoom 200 %.

## Task Format Validation

Les 112 tâches suivent le format checklist obligatoire : case, identifiant
séquentiel, marqueur `[P]` uniquement si parallélisable, label `[USn]` dans
les phases de story et chemin de fichier explicite.
