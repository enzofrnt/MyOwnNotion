# Tâches — Système CSS

## Phase 1 — Setup

- [x] T001 Enregistrer le travail Slopo en premier commit et créer spec.md avec périmètre canevas.
- [x] T002 Rechercher styles/contrats/skill en lecture seule et rédiger research.md, plan.md et contrats.

## Phase 2 — Fondations

- [x] T003 Figer l’inventaire CSS et les références avant changements dans specs/031-css-system/verification.md et assets.

## Phase 3 — US1 Propriétaires et langage commun

Critère indépendant : retrouver les propriétaires et primitives sans global monolithique.

- [x] T004 [US1] Extraire global.css vers ui/base.css, ui/compatibility.css et les feuilles des features avec leurs conditions et déclarations.
- [x] T005 [US1] Réunir les styles des bases dans features/databases/database.css ; garder le shell dans features/workspace/workspace.css.
- [x] T006 [US1] Réunir les règles de document sécurité dans features/settings/settings-security.css, supprimer les définitions concurrentes.
- [x] T007 [US1] Unifier les consommations de tokens dans les CSS et centraliser les couleurs locales dans ui/tokens.css sans quantifier les valeurs optiques.
- [x] T008 [US1] Appliquer ui-quality + lessons.md : revue de cascade/contrôles réels, preuves visuelles US1 dans verification.md.

## Phase 4 — US2 Préservation et primitives

Critère indépendant : comparaison avant/après sans régression inexpliquée.

- [x] T009 [US2] Isoler les contrôles natifs historiques dans ui/compatibility.css ; donner les états explicites aux primitives et préserver adaptations BlockNote.
- [x] T010 [US2] Définir l’alignement icône/libellé commun dans ui/primitives/primitives.css ; garder les layouts propres recherche/navigation.
- [x] T010a [US2] Appliquer les accents bleu/rouge clarifiés sans changer les options de propriétés ; préserver le scrollport Kanban révélé pendant revue.
- [x] T010b [US2] Appliquer FR-009 aux primitives : focus neutre sans halo, informations sobres, danger en contour et placeholders ; vérifier annonces et stabilité attente/contenu au lab.
- [x] T011 [US2] Appliquer ui-quality + lessons.md : captures thèmes/largeurs, texte long, scroll et clavier, comparer aux références dans assets et verification.md.

## Phase 5 — US3 Recettes pour prochains agents

Critère indépendant : suivre le guide pour composer une surface avec les composants réels.

- [x] T012 [US3] Rendre les overlays de ui/ui-lab.tsx interactifs sans casser la prop déterministe, avec tests comportementaux apps/web/tests/ui-lab.spec.tsx.
- [x] T013 [US3] Compléter ui/ui-lab.tsx avec compositions réelles page/base/navigation/réglages, texte long et états.
- [x] T013a [US3] Ajouter sous la palette conservée un exemple de choix de couleur à point central ; vérifier choix local, clavier, deux thèmes et 320 px selon la clarification du propriétaire.
- [x] T014 [US3] Rédiger docs/design/ui-system.md (propriétaires, API réelle, recettes, exceptions, revue) et relier skill ui-quality/AGENTS/development et contrat 017.
- [x] T015 [US3] Appliquer ui-quality + lessons.md : utiliser les recettes et overlays du lab, conserver preuves US3 dans verification.md.

## Phase 6 — Vérification et clôture

- [x] T016 Exécuter suites UI concernées, typage, Biome, build ; consigner résultats/limites dans verification.md.
- [x] T017 Vérifier spec/plan/tasks/code par convergence ; garder tout écart dans tasks.md.
- [x] T018 Créer le second commit dédié CSS après vérification, sans push ni E2E.

## Dépendances et stratégie

T003 avant extraction. T004–T007 séquentielles (cascade commune). T009–T011
après propriétaires. T012 avant T013/T015. Guide T014 après structure stabilisée.
Les recherches indépendantes ont été déléguées en lecture seule selon le skill
plan ; pas de délégation d’édition. Lecture/inventaire indépendants peuvent être
parallèles, mutations/tests visuels restent séquentiels.
