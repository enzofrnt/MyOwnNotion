# Tasks: Kanban par sélection multiple

## Foundations

- [x] T001 Analyser domaines/query/contracts et configuration Board ; finaliser recherches et analyse cohérente avec canevas/028/029.
- [x] T002 Ajouter tests rouges de memberships multi-select, pagination/labels et axe masqué dans domain/contracts/client-core.

## US1 — Lire/configurer

- [x] T003 Implémenter regroupement natif et projection partagée, sans duplication de rows.
- [x] T004 Tester puis implémenter rendu Board et configuration/création d'axe multi-select cohérent ; reprise axe indisponible.
- [x] T005 Appliquer ui-quality + lessons et preuves visuelles US1 (vide, axe masqué/invalide, clair/sombre, 320 px/desktop).

## US2 — Déplacer

- [x] T006 Tests rouges puis mouvements origin-aware, destination déjà présente, missing, retired, annulation et refus.
- [x] T007 Implémenter contrôles souris/clavier/tactile et annonce visible, prévention doubles envois.
- [x] T008 Appliquer ui-quality + preuves navigateur US2 sur cinq profils ; persistance/reload/offline et conservation des autres tags.

## US3 — Importer/restaurer

- [x] T009 Tester puis importer Kanbans multi-select natifs avec filtres/tris/visibilité conservés ; mettre à jour limites 028 et 029.
- [x] T010 Builds/déploiement strictement isolés ; backup vérifié, restauration gardée des deux vues avec copies cohérentes, idempotence.
- [x] T011 Appliquer ui-quality + preuve privée US3 : Matière native sur 8082, onglet Calendrier et autres réglages conservés, autre instance intacte.

## Completion

- [x] T012 Validation types/static/format/tests/builds pertinents, analyse et convergence sans écart ; documenter evidence et limites exactes.

Dependencies : T001→T002→T003→T004/T006→T007 ; preuves après code ; T009→T010→T011 ; T012 après toutes les preuves. Aucun travail de code parallèle.

## US4 — Finition visuelle demandée sur capture Notion

- [x] T013 Analyser la maintenance FR009/010 avec le canevas, ui-quality, lessons et guide ; inventorier les propriétaires CSS et préciser les états avant édition.
- [x] T014 Alléger colonnes/en-têtes/cartes ; menus de déplacement et popover de regroupement, identité existante, focus, pending/refus ; adapter les tests de comportement.
- [x] T015 Preuves UI US4 selon ui-quality + lessons : clair/sombre desktop/320 px, menus ouverts/Échap, toucher/clavier, colonnes vides/repli et maintien des appartenances multiples sur cinq profils.
- [x] T016 Vérifications ciblées, build Web, déploiement 8082 seul ; preuve privée Matière et autre instance intacte ; documenter puis converger.

Dependencies : T013→T014→T015→T016.

## Maintenance couleurs — retour du 2026-10-06

- [x] T017 Calibrer les tokens de surface par thème et appliquer une hiérarchie
  de teinte franche pour cartes, plus discrète pour colonnes ; conserver des
  contours fins et réduire très légèrement le padding vertical des cartes.
- [ ] T018 Revoir le rendu réel en clair/sombre, y compris cartes longues,
  hover/focus, options colorées et Sans valeur ; documenter la preuve avant
  convergence.
