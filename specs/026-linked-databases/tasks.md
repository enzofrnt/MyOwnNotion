# Tasks: Bases réutilisables intégrées

## Phase 1 — Spécification et fondations

- [x] T001 Aligner le canevas et la 009 ; produire spec, plan et analyse de cohérence dans `specs/026-linked-databases/`.
- [x] T002 Ajouter les emplacements chiffrés et leur validation/fusion dans `packages/domain/src/databases/` et les contrats.
- [x] T003 Migrer le registre de sources/révisions et détacher le cycle de vie des hôtes dans `packages/database/migrations/0016_linked_databases.sql` et les repositories.

## Phase 2 — US1 et US2 : sources et configurations

- [x] T004 [US1] Adapter les mutations et lectures API à la source indépendante et à la création intégrée, avec snapshots protégés.
- [x] T005 [US1] Adapter projection et mutations locales chiffrées pour les sources et emplacements réutilisés hors ligne.
- [ ] T006 [US2] Intégrer les sources dans les pages ordinaires avec vues propres, édition d'entrée partagée, insertion/retrait et sélecteur conservant les sources sans emplacement ; appliquer `.agents/skills/ui-quality/SKILL.md`.
- [ ] T007 [US2] Vérifier par tests ciblés les vues indépendantes, l'édition partagée et le retour à une page normale.

## Phase 3 — US3 : conservation et convergence

- [x] T008 [US3] Couvrir export/restauration, protection des révisions de source, suppression et purge de tous les hôtes, et reprise hors ligne.
- [ ] T009 [US3] Ajouter et exécuter les scénarios migration/PostgreSQL/client et Playwright ; vérifier visuellement clair/sombre/étroit selon UI quality.
- [ ] T010 Mettre à jour documentation, validation et convergence ; consigner les gates exécutés et ceux restant au parent avant push.
