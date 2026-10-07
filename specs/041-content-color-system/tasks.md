# Tasks: Couleurs de contenu

## Phase 1: Setup

- [x] T001 Lire constitution/canevas/ui-quality/lessons et mesurer Notion dans research.md.
- [x] T002 Rédiger spec.md et plan.md ; distinguer mesures sombres et transformations.
- [x] T003 Aligner canevas et artefacts 038 ; analyser cohérence dans analysis.md avant code.

## Phase 2: US1 — Kanban

- [x] T004 [US1] Définir accents et dérivations communes par thème dans apps/web/src/ui/tokens.css.
- [x] T005 [US1] Appliquer rôles aux badges, colonnes, cartes, boutons et sélecteur dans apps/web/src/features/databases/database.css.
- [x] T006 [US1] Vérifier UI réelle avec ui-quality/lessons : repos/hover/focus/édition/neutre/vide, captures et styles dans validation.md.

## Phase 3: US2 — Système partagé

- [x] T007 [US2] Aligner aperçus dans apps/web/src/ui/ui-lab.tsx, ui-lab.css et features/databases/property-configuration.tsx ; documenter rôles dans docs/design/ui-system.md.
- [x] T008 [US2] Vérifier avec ui-quality/lessons neuf tons, consommateurs éditoriaux, clair/sombre et 320 px ; preuves dans validation.md.

## Phase 4: Validation

- [x] T009 Format/types/compilation ciblés et déploiement web 8082 seul ; préserver API/DB/8080 et consigner limites dans validation.md.
- [x] T010 Converger les artefacts et documenter vérifications différées ; capitaliser seulement une leçon vérifiée.

## Dependencies and parallel execution

T001→T002→T003→T004→T005 ; T007 suit le contrat T004 et peut précéder T005.
Revue réelle T006/T008 suit build/déploiement T009. T010 final. Une passe palette
utile, sans refonte de layout ni nouvelle interaction. E2E initialement différés,
puis repris pour la publication du 7 octobre (T011).

- [ ] T011 Reprise de publication FR002/003/006 : protéger les recettes color-mix contre leur réduction en accents pleins pendant le build ; vérifier les neuf tons et contrastes du rendu de production en clair/sombre/320 px sur les cinq profils avec ui-quality/lessons, puis le gate complet.
