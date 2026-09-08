# Tasks: Bases réutilisables intégrées

## Phase 1 — Spécification et fondations

- [x] T001 Aligner le canevas et la 009 ; produire spec, plan et analyse de cohérence dans `specs/026-linked-databases/`.
- [x] T002 Ajouter les emplacements chiffrés et leur validation/fusion dans `packages/domain/src/databases/` et les contrats.
- [x] T003 Migrer le registre de sources/révisions et détacher le cycle de vie des hôtes dans `packages/database/migrations/0016_linked_databases.sql` et les repositories.

## Phase 2 — US1 et US2 : sources et configurations

- [x] T004 [US1] Adapter les mutations et lectures API à la source indépendante et à la création intégrée, avec snapshots protégés.
- [x] T005 [US1] Adapter projection et mutations locales chiffrées pour les sources et emplacements réutilisés hors ligne.
- [x] T006 [US2] Intégrer les sources dans les pages ordinaires avec vues propres, édition d'entrée partagée, insertion/retrait et sélecteur conservant les sources sans emplacement ; appliquer `.agents/skills/ui-quality/SKILL.md`.
- [x] T007 [US2] Vérifier par tests ciblés les vues indépendantes, l'édition partagée et le retour à une page normale.

## Phase 3 — US3 : conservation et convergence

- [x] T008 [US3] Couvrir export/restauration, protection des révisions de source, suppression et purge de tous les hôtes, et reprise hors ligne.
- [x] T009 [US3] Ajouter et exécuter les scénarios migration/PostgreSQL/client et Playwright ; vérifier visuellement clair/sombre/étroit selon UI quality.
- [x] T010 Mettre à jour documentation, validation et convergence ; consigner les gates exécutés et ceux restant au parent avant push.

## Phase 4: Convergence

- [x] T011 Corriger la pagination visible des intégrations selon FR-004/FR-011 et SC-001/SC-005 (partial, HIGH) : parcourir les curseurs existants, afficher les entrées chargées et la couverture locale, conserver tri/filtre sur la projection complète et couvrir une source de plus de 1 000 entrées dans le navigateur.

- [x] T012 Réduire les lectures SQL répétées du chargement de projection (partial, HIGH, FR-004/FR-008) : lire noms/valeurs/relations par lots avec versions authentifiées, actualiser uniquement les entrées touchées quand le schéma reste identique, et mesurer une base PostgreSQL chiffrée réelle au lieu du seul benchmark en mémoire.

- [x] T013 Aligner le défaut de création d'entrée sur le modèle produit (missing, HIGH, FR-012) : placement optionnel uniquement pour `database.entry.create`, UI sans placement implicite, maintien des placements explicites/existants ; preuves API/local/offline/export/recherche et corpus 1 001 sans encombrement de la racine. Le profil navigateur a distingué 12,8 s dans la résolution de rôle Playwright globale du déchiffrement local de 15 ms ; borner le locator au panneau.

## Phase 5: Convergence

- [x] T014 Aligner le contrat OpenAPI 009 de création d'entrée avec FR-012 et corriger les attentes de migrations révélées par la couverture intégrée : conserver la mise à niveau format-v2 jusqu'à 0017, borner le contrat historique de fichiers à 0015, puis vérifier contrats, types et Biome (partial).

- [ ] T015 Renforcer les garanties FR-008 au point d'entrée partagé dans `packages/domain/src/databases/schema.ts` et les tests de commandes : refuser les types inconnus de propriétés/vues (y compris intégrées), conserver placements explicites et identités, tester valeurs/relations/documents/confirmations malformés via `parseMutationCommand`, et vérifier les commandes valides sans mutation de leur entrée. Reporter les régressions reproduites et la couverture intégrée sans modifier ses seuils.
