# Tasks: Bases de données comme pages et vues

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md), [contracts](contracts/), [quickstart.md](quickstart.md)

**Tests**: La constitution exige tests de comportement, migrations et parcours Playwright pour chaque flux interactif modifié. Une tâche UI n'est achevée qu'après application de `ui-quality` et preuve réelle consignée dans `validation.md`.

## Phase 1 — Préparation

- [x] T001 Relever les dépendances du protocole 009/026/028 et les fixtures à remplacer dans `packages/contracts/src/content-api.ts`, `apps/api/src/sync/structured-payload.ts`, `apps/web/src/services/databases.ts` et `tests/e2e/linked-databases.spec.ts`.
- [x] T002 Documenter le refus de migration sur anciennes bases et la remise à zéro volontaire d'une installation de développement isolée, en détaillant aussi la perte de fichiers/sauvegardes, dans `docs/development.md` et `specs/029-database-pages-views/quickstart.md`.

## Phase 2 — Fondations bloquantes

- [x] T003 Établir `database` et `database_view` comme types canoniques et la matrice de contenance/création/déplacement dans `packages/domain/src/content/types.ts` et `packages/domain/src/content/hierarchy.ts`.
- [x] T004 [P] Couvrir contenance, placement direct et rejet de base enfant par tests dans `packages/domain/tests/database-hierarchy.spec.ts` ; la suite préexistante `hierarchy.property.spec.ts` couvre les cycles.
- [x] T005 Définir source, présentation et vue à identités distinctes avec invariants et validateurs dans `packages/domain/src/databases/types.ts`, `packages/domain/src/databases/schema.ts` et `packages/domain/src/databases/commands.ts`.
- [x] T006 Créer une migration numérotée gardée refusant les anciennes sources sans reset explicite et les tables/contraintes propriétaire-source-vues-valeurs dans `packages/database/migrations/0019_database_pages_views.sql` ; mettre en miroir `packages/database/src/schema/index.ts`.
- [x] T007 [P] Tester migration propre, garde ancienne source, identité propriétaire/source, types et placements dans `packages/database/tests/migrations.integration.spec.ts`, `packages/database/tests/database.integration.spec.ts` et `packages/database/tests/schema-parity.integration.spec.ts`.
- [ ] T008 Adapter les contrats des mutations, lectures, sync et export aux identités distinctes dans `packages/contracts/src/content-api.ts` et leurs tests dans `packages/contracts/tests/`.
- [ ] T009 Implémenter les repositories source/présentation et les mutations atomiques avec révision/idempotence dans `packages/database/src/repositories/database-repository.ts` et `packages/database/src/mutations/database-commands.ts`.
- [ ] T010 Mettre API, projection serveur et outbox locale au même protocole dans `apps/api/src/routes/databases.ts`, `apps/api/src/sync/structured-payload.ts`, `packages/client-core/src/outbox/apply-to-projection.ts` et `packages/client-core/src/local-store/schema.ts`.
- [ ] T011 [P] Tester aller-retour chiffré, hors ligne et conflit de révision de source/vue dans `packages/client-core/tests/` et `apps/api/tests/databases.integration.spec.ts`.

**Checkpoint fondations** : création et lecture d'une source + présentation séparées et placement hiérarchique atomique ; anciens objets bloqués avec message de migration.

## Phase 3 — US1 : base pleine page

**Objectif** : créer depuis `/` ou `+` un conteneur enfant avec source propre, lien éditorial et navigation immédiate.

**Test indépendant** : créer depuis page puis Notes, page et dossier ; recharger et vérifier identité, icône, placement et absence du bouton permanent.

- [ ] T012 [US1] Implémenter `database.create` et la lecture de conteneur pleine page avec source/vues dans `packages/database/src/mutations/database-commands.ts` et `apps/api/src/routes/databases.ts`.
- [ ] T013 [US1] Projeter la création atomique hors ligne et la nouvelle navigation dans `packages/client-core/src/outbox/apply-to-projection.ts` et `apps/web/src/services/local-content.ts`.
- [ ] T014 [US1] Ajouter la commande pleine page à `apps/web/src/features/editor/editor-menus/slash-menu.tsx` et les choix Base de données aux `+` de `apps/web/src/features/navigation/navigation-inline-create.tsx` et `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`.
- [ ] T015 [US1] Montrer le type canonique dans arbre, onglet propre à chaque base ouverte, fil d'Ariane et lien d'enfant sans flèche dans `apps/web/src/ui/item-icon.tsx`, `apps/web/src/features/workspace/open-tabs-strip.tsx`, `apps/web/src/features/editor/page-link-inline-content.ts` et `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` ; supprimer le bouton permanent dans `apps/web/src/features/databases/page-databases.tsx`.
- [ ] T016 [US1] Tester mutation/API et parcours pleine page/`+` au clavier et à 320 px dans `apps/api/tests/databases.integration.spec.ts` et `tests/e2e/databases-pages-views.spec.ts`.
- [ ] T017 [US1] Appliquer `ui-quality` et documenter captures réelles clair/sombre, desktop/320 px, états vide/chargement/erreur/focus dans `specs/029-database-pages-views/validation.md`.

## Phase 4 — US2 : base intégrée

**Objectif** : insérer au curseur un seul bloc de vue qui crée son conteneur enfant, sans lien supplémentaire.

**Test indépendant** : insérer entre deux paragraphes, changer format, recharger/hors ligne ; vérifier ordre, enfant et scroll interne.

- [ ] T018 [US2] Ajouter le bloc canonique `databaseView` et sa validation/export dans `packages/domain/src/document/block.ts`, `packages/domain/src/export/canonical-export.ts` et leurs tests.
- [ ] T019 [US2] Ajouter le bloc à BlockNote, conversion et modèle d'opérations dans `apps/web/src/features/editor/` et `packages/page-state/src/`, avec référence stable `containerItemId/viewId`.
- [ ] T020 [US2] Implémenter la commande intégrée, la coordination brouillon/création et la reprise sans orphelin dans `apps/web/src/features/editor/editor-menus/slash-menu.tsx`, `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` et `apps/web/src/services/local-content.ts`.
- [ ] T021 [US2] Séparer rendu d'une vue intégrée des onglets pleine page et lui donner scroll interne aligné au texte dans `apps/web/src/features/databases/database-page.tsx`, `apps/web/src/features/databases/page-databases.tsx` et CSS propriétaire.
- [ ] T022 [US2] Tester création, ordre du bloc, échec/reprise, changement de format et responsive dans `apps/web/tests/slash-menu.spec.ts` et `tests/e2e/databases-pages-views.spec.ts`.
- [ ] T023 [US2] Appliquer `ui-quality` et consigner preuves visuelles bloc rempli/vide/erreur, clair/sombre, 320 px, clavier et scroll dans `specs/029-database-pages-views/validation.md`.

## Phase 5 — US3 : entrées enfants pages et dossiers

**Objectif** : créer, ouvrir, déplacer et restaurer des entrées directes ; conserver les valeurs en sortie/retour.

**Test indépendant** : créer page et dossier depuis Table/Kanban, saisir propriétés, déplacer hors/dans la base et retrouver les valeurs sans doublon.

- [ ] T024 [US3] Faire dépendre l'appartenance du placement direct, conserver valeurs `(sourceId,entryId)` dormantes et valider les déplacements dans `packages/database/src/mutations/database-commands.ts` et `packages/database/src/repositories/database-repository.ts`.
- [ ] T025 [US3] Permettre `page|folder` dans `database.entry.create`, valeur de groupe Kanban et contenance des descendants dans `packages/domain/src/databases/commands.ts`, `apps/api/src/routes/databases.ts` et `packages/client-core/src/outbox/apply-to-projection.ts`.
- [ ] T026 [US3] Afficher la branche des entrées du propriétaire même source masquée, le panneau de propriétés des pages **et dossiers**, et l'ouverture latérale/pleine page dans `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`, `apps/web/src/features/databases/database-page.tsx` et `apps/web/src/features/hierarchy/folder-children-list.tsx`.
- [ ] T027 [US3] Tester placement/restitution/corbeille/rejet de base directe dans `packages/database/tests/databases.integration.spec.ts` et `tests/e2e/databases-pages-views.spec.ts`.
- [ ] T028 [US3] Appliquer `ui-quality` et consigner preuves visuelles Table/Kanban, entrée dossier, 320 px, thèmes et état d'erreur dans `specs/029-database-pages-views/validation.md`.

## Phase 6 — US4 : vues multiples et liées

**Objectif** : onglets pleine page de sources/formats différents, un bloc intégré à vue unique et élément lié fléché sans source propre.

**Test indépendant** : deux sources A/B, plusieurs vues dans A, modifier source d'un onglet seulement, créer vue liée dans une page et constater les données partagées sans copie.

- [ ] T029 [US4] Adapter moteur de requête et services à `source + view`, filtres/tris/groupes propres et cinq formats dans `packages/domain/src/databases/query.ts`, `apps/web/src/services/databases.ts` et `apps/web/src/features/databases/use-database-view.ts`.
- [ ] T030 [US4] Implémenter ajout/retrait/réordre/changement de source de vues avec verrou une-vue, révision et source propre toujours retrouvable dans `packages/domain/src/databases/commands.ts`, `packages/database/src/mutations/database-commands.ts` et `apps/api/src/routes/databases.ts`.
- [ ] T031 [US4] Implémenter `database_view.create`, élément feuille, source externe et projection hors ligne dans `packages/database/src/mutations/database-commands.ts`, `packages/client-core/src/outbox/apply-to-projection.ts` et `apps/web/src/services/local-content.ts`.
- [ ] T032 [US4] Ajouter `/vue liée de base de données`, sélecteur de source, bloc unique, élément d'arbre fléché, onglet de workspace propre à l'élément lié ouvert et onglets de sources multiples dans `apps/web/src/features/editor/editor-menus/slash-menu.tsx`, `apps/web/src/features/databases/database-page.tsx`, `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` et `apps/web/src/ui/item-icon.tsx`.
- [ ] T033 [US4] Tester formats/filtres/sources et contrats de vue liée dans `packages/domain/tests/databases.spec.ts`, `apps/api/tests/databases.integration.spec.ts` et `tests/e2e/databases-pages-views.spec.ts`.
- [ ] T034 [US4] Appliquer `ui-quality` et consigner preuves visuelles onglets, sélecteur, icône fléchée, bloc unique, clavier, thèmes et 320 px dans `specs/029-database-pages-views/validation.md`.

## Phase 7 — US5 : source masquée et suppression

**Objectif** : conserver source et entrées après réorientation de toutes les vues ; corbeille/restauration avertissent/réparent les vues liées.

**Test indépendant** : A a deux vues de B, A reste récupérable ; corbeille de B affiche avertissement lecture seule chez A, restauration le retire.

- [ ] T035 [US5] Relier cycle de vie de la source à son propriétaire, sans effacer lors du changement de vue, dans `packages/database/src/mutations/database-commands.ts` et `packages/database/src/repositories/database-repository.ts`.
- [ ] T036 [US5] Publier états source active/corbeille/purgée/partielle via sync et cache local dans `apps/api/src/sync/structured-payload.ts`, `packages/client-core/src/local-store/schema.ts` et `apps/web/src/services/databases.ts`.
- [ ] T037 [US5] Ajouter avertissement avant corbeille, état de vue rompue en lecture seule, restauration et sélecteur de source possédée masquée dans `apps/web/src/features/databases/database-page.tsx` et `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`.
- [ ] T038 [US5] Tester corbeille/restauration/purge, valeurs conservées, absence d'édition et sync hors ligne dans `packages/database/tests/databases.integration.spec.ts`, `apps/api/tests/databases.integration.spec.ts` et `tests/e2e/databases-pages-views.spec.ts`.
- [ ] T039 [US5] Appliquer `ui-quality` et consigner preuves visuelles avertissement, confirmation, erreur, restauration, thèmes et 320 px dans `specs/029-database-pages-views/validation.md`.

## Phase 8 — Échanges durables et convergence

- [ ] T040 Adapter export canonique, contrats, sauvegarde/restauration et fixtures au modèle 029 dans `packages/domain/src/export/canonical-export.ts`, `packages/contracts/src/content-api.ts`, `apps/api/src/routes/export.ts`, `apps/api/src/backup/database-restore-target.ts` et tests associés.
- [ ] T041 Adapter aperçu/import Notion 028 : propriétaires visibles, IDs déterministes distincts, membres directs, `.base` liés et reprise chiffrée dans `apps/api/src/imports/notion/{plan,apply,markdown}.ts` et `apps/api/tests/notion-import.integration.spec.ts`.
- [ ] T042 Exécuter un reset uniquement sur une installation de test isolée après inventaire du périmètre, puis vérifier export/restauration/sync/import selon `specs/029-database-pages-views/quickstart.md` et `specs/029-database-pages-views/validation.md`.
- [ ] T043 Exécuter tests ciblés, migrations, Playwright et gate local de `docs/development.md` ; réparer jusqu'au vert et consigner les preuves dans `specs/029-database-pages-views/validation.md`.
- [ ] T044 Faire l'analyse de convergence spec/plan/tâches/code, corriger tout écart fonctionnel ou UI matériel et cocher uniquement les tâches prouvées dans `specs/029-database-pages-views/tasks.md`.

## Phase 9 — Cycle de vie Source, Vue, Page (session 2026-09-30)

**Objectif** : une page de base possède zéro, une ou plusieurs sources. Chaque source a une page d'origine. La base intégrée reprend les vues de sa page enfant. Les suppressions suivent `spec.md`.

**Test indépendant** : créer une deuxième source sur une page qui en a déjà une ; afficher la première ailleurs ; retirer sa dernière vue d'origine en la conservant ; supprimer la page d'origine et lire le message sur la vue externe.

- [ ] T045 Permettre plusieurs sources pour une même page d'origine : clé de source distincte de la page, entrées rattachées à la source, page sans source autorisée, dans `packages/database/migrations/`, `packages/database/src/schema/index.ts`, `packages/domain/src/databases/` et `packages/client-core/src/local-store/schema.ts`.
- [ ] T046 Créer une page de base soit avec une nouvelle source, soit pour une source existante nommée « Vue de [source] », avec flèche tant qu'aucune source propre n'existe, dans `apps/web/src/features/navigation/` et `apps/web/src/ui/item-icon.tsx`.
- [ ] T047 Sous le choix de format d'une nouvelle vue, créer une source rattachée à la page de base courante, dans `apps/web/src/features/databases/database-container-page.tsx` et les mutations de source.
- [ ] T048 Afficher les vues de la page de base enfant dans le bloc intégré, dans `apps/web/src/features/editor/custom-blocks/database-view.tsx`.
- [ ] T049 Titre : une source affichée, le titre est celui de la source ; plusieurs sources, nom de la page puis nom de la source de la vue active.
- [ ] T050 Dernière vue d'une source sur sa page d'origine : choix « vue seule » ou « vue et source ». Une vue d'une source née ailleurs ne propose pas de supprimer la source. Confirmation de suppression de page avec le nombre de sources. Vues restantes : « Aucun résultat : la source de données demandée n'existe plus. »
- [ ] T051 Tester ces parcours dans `packages/domain/tests/databases/`, `packages/database/tests/` et `apps/web/tests/`. Appliquer `ui-quality` pour le choix de suppression, le titre et l'état source absente, et consigner la preuve dans `validation.md`.

Les tâches T030 et T035 à T039 décrivent le modèle à une source et le bloc à vue unique. La phase 9 les remplace pour ces points. Ne pas les cocher comme si elles réalisaient la session du 30 septembre.

## Dépendances et exécution

T001–T002 précèdent les fondations. T003–T011 précèdent les stories. Ordre de référence : US1 → US2 → US3 → US4 → US5, chaque story gardant son test indépendant. Les adaptations d'échange T040–T041 peuvent commencer une fois les contrats et modèles stabilisés, mais doivent être validées avec l'ensemble. Les tâches `[P]` portent sur des fichiers distincts et peuvent être étudiées en parallèle sans fusion de mutations dépendantes. Chaque tâche UI de T017/T023/T028/T034/T039 a son gate visuel propre.

**MVP vérifiable** : US1 après les fondations. La feature entière exige les cinq stories, T040–T044 et la phase 9, parce que la session du 30 septembre change la propriété des sources, la base intégrée et les suppressions.
