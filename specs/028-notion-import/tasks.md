# Tasks: Notion API replacement

Historical file import T001–T022 is superseded by the owner's 2026-10-04 request.
Prior validation.md is historical; active tasks continue numbering.

## Phase 1 — Specification and isolation

- [x] T023 Revise spec.md, canvas and roadmap for API import.
- [x] T024 Research primary sources and write plan.md.
- [x] T025 Analyze coverage in analysis.md before implementation.
- [x] T026 Create isolated Compose project and record mounts/ports in validation-api.md.

## Phase 2 — US1 discovery and preview

- [x] T027 [US1] Implement versioned client, scheduler, retry, pagination and abort in apps/api/src/imports/notion/api-client.ts with network tests.
- [x] T028 [US1] Implement selected recursive collection in collect.ts, including properties, synced blocks, views and edit checks.
- [x] T029 [US1] Replace CLI with ephemeral secret, discovery and preview in cli.ts; test refusals/output in apps/api/tests/notion-api-cli.spec.ts.

## Phase 3 — US2 native conversion and application

- [x] T030 [US2] Convert native v3 rich text/blocks and explicit fallback in blocks.ts; test nested content and internal links.
- [x] T031 [US2] Convert containers, sources, properties, relations and views in properties.ts, views.ts, plan.ts; test membership/losses.
- [x] T032 [US2] Fetch bounded media without credentials/private-network access in media.ts; test redirects, limits and fallback.
- [x] T033 [US2] Adapt canonical multi-source apply in apply.ts; test readback, backup and encryption in apps/api/tests/notion-api.integration.spec.ts.

## Phase 4 — US3 durable resume

- [x] T034 [US3] Save/read protected snapshot and abort between operations in apply.ts/cli.ts; test restart, replay, local edits and backup failure.

## Phase 5 — Removal and convergence

- [x] T035 Remove retired parsers/tests/dependencies; update docs/notion-import.md, docs/development.md and specs/029-database-pages-views/tasks.md.
- [x] T036 Run gates and live collection/apply on isolated instance; record aggregates/limits in validation-api.md.
- [x] T037 Assess all requirements and append remaining work to tasks.md; record convergence in validation-api.md.

## Dependencies and traceability

- [x] T038 Fix source-specific protected reads and impact scoping in packages/database/src/repositories/database-repository.ts and packages/database/src/mutations/database-commands.ts, demonstrated by T033's regression (FR-004).

T023–T026 precede code; T027 → T028 → T029 delivers preview.
T030–T032 follow collection; T033 depends on conversion; T034 on apply.
T035–T037 finish. Independent network/conversion tests may run concurrently.
No agent delegation requested.
FR-001: T028/T029/T035; FR-002: T027/T028; FR-003: T030/T031;
FR-004: T031/T033; FR-005: T032/T033; FR-006: T033/T034;
FR-007: T034; FR-008: T027/T029/T032/T034; FR-009: T026/T036;
FR-010: T035/T036. SC-001: T027–T033/T036; SC-002: T034;
SC-003: T029/T032–T034; SC-004: T026/T036.

## Phase 6 — Owner test corrections

- [x] T039 [US2] Apply explicit exclusions in collect.ts/plan.ts: omit Personne/authorship and cover slots, retain originals only in the private snapshot; cover new and historical collections in tests (FR-004/005/006).
- [x] T040 [US2] Repair databaseView property initialization in packages/page-state/src/block-tree.ts and packages/domain/src/document/block-properties.ts; test activation/checkpoint/edit roundtrip and imported-page activation (FR-003, US2/AC6).
- [x] T041 [US2] Apply ui-quality and lessons: reproduce owner page; review error/loading/success, reopen/edit, light/dark and narrow viewport on port 8082; record private visual inspection in validation-api.md (US2/AC6).
- [x] T042 [US2] Back up and clean the existing isolated import with canonical mutations, preserving target IDs and later edits; remove technical archive, cover-only assets and imported Personne fields (FR-004/005/006/009).
- [x] T043 Update guide/canvas/artifacts, run affected gates and reassess convergence after the owner corrections (FR-010).

## Phase 7 — Contenu et hiérarchie demandés par le propriétaire

- [x] T044 [US2] Convertir équations/inline et sommaires avec la dépendance034 dans blocks.ts ; tester source et annotations dans notion-content.spec.ts.
- [x] T045 [US2] Résoudre les parents block_id à partir des forêts de pages, préserver les appartenances de source ; tester en plan.ts/notion-content.spec.ts.
- [x] T046 [US1] Ajouter l'exclusion répétable explicite de base au plan et à cli.ts, avec test de fermeture sur sources/membres et refus d'ID absent.
- [x] T047 [US2] Sauvegarder puis appliquer la réparation canonique de41blocs,2parents et People sur8082, après contrôle des éditions ; preuves dans034/validation.md.
- [x] T048 Actualiser les guides et converger les artefacts028/034 après les contrôles de contenu/navigation/listes (FR-003/004/006/009/010).


## Ajustement des liens et commandes — 035

Le retour du propriétaire du 4 octobre est défini dans
[035/spec.md](../035-item-links-database-insertion/spec.md), avec approche et
suivi dans ses plan.md/tasks.md. Il remplace les libellés précédents par les
créations « Page/Dossier/Base de données imbriqué(e) », élargit « Lien vers un
autre élément » aux bases, et fusionne les commandes d'affichage intégré et lié
dans un dialogue de choix. Le concept de vue liée et la propriété des sources
restent inchangés. L'import respecte is_inline et corrige les références
historiques inchangées ; la validation locale propre à035 ne revalide pas les
anciennes phases de cette feature.

## Phase 8 — Maintenance de la vue Matière

- [x] T049 [US2] Couvrir les regroupements incompatibles et compatibles, avec évaluation native et conservation des données, dans apps/api/tests/notion-content.spec.ts (FR-004/010).
- [x] T050 [US2] Borner la conversion aux capacités réelles du moteur et produire un repli explicite dans apps/api/src/imports/notion/views.ts ; sauvegarder et réparer uniquement les vues importées inchangées sur 8082 (FR-004/006/007/009).
- [x] T051 [US2] Appliquer ui-quality/lessons et vérifier erreur avant/rendu réel après, clair/sombre, 320px, rechargement et autres vues conservées ; garder les captures privées ignorées et consigner validation-matiere.md.
- [x] T052 Actualiser limites et artefacts ; contrôles ciblés types/static/tests API, build et runtime isolé ; revue de cohérence sans étendre le regroupement natif (FR-010).

## Extension 036 — 2026-10-04

[036](../036-multi-select-boards/spec.md) ajoute le regroupement Kanban par sélection multiple, sans repli table pour ce cas. Les anciennes preuves Matière restent historiques ; la restauration ciblée et la validation native sont suivies dans 036.

## Audit comparatif demandé le 2026-10-05

- [x] T053 Recollecter Notion par API avec un nouvel identifiant, conserver les
  exclusions People/personnes/couvertures, sauvegarder puis retirer l'ancien
  groupe d'import de 8082 par mutation canonique et appliquer l'import neuf.
- [x] T054 Appliquer ui-quality et ses leçons à la revue directe : naviguer dans
  Notion et MyOwnNotion, comparer hiérarchie, contenus riches, médias, liens et
  vues de bases ; garder une preuve privée et distinguer écarts observés et
  limites de couverture. Pas de relance des suites automatisées.
- [x] T055 Documenter la couverture et les écarts concrets dans
  audit-2026-10-05.md, les signaler au propriétaire et laisser l'instance 8082
  disponible. Cet audit n'autorise aucune modification des données Notion.

Preuves : [audit du 5 octobre](audit-2026-10-05.md). Import neuf complet,
revue des neuf bases et des pages sélectionnées dans les deux applications.
La fidélité 1:1 est explicitement non atteinte ; les écarts sont consignés,
sans être déclarés corrigés et sans relancer de suites automatisées.
