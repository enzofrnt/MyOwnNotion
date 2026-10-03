# Tasks: Revue complète et composants communs

Sources : [spec](spec.md), [plan](plan.md),
[ui-quality](../../.agents/skills/ui-quality/SKILL.md),
[lessons](../../.agents/skills/ui-quality/lessons.md).

## Phase 1 — Préparation

- [x] T001 Conserver référence initiale, données et instance dans specs/033-app-ui-review/verification.md.
- [x] T002 Inventorier familles/composants actifs/états et exceptions dans specs/033-app-ui-review/verification.md.

## Phase 2 — US1 : revue complète

Test indépendant : chaque surface active ou conditionnelle a une preuve et un résultat.

- [x] T003 [US1] Ajouter compositions réelles mémoire des états conditionnels dans apps/web/src/ui/ui-lab*.
- [x] T004 [US1] Appliquer ui-quality + revue/corrections des conflits, réconciliation et historique dans apps/web/src/features/{sync,reconciliation,history}/ et specs/033-app-ui-review/assets/.
- [x] T005 [US1] Appliquer ui-quality + revue/corrections des fichiers, aperçus et états de transfert dans apps/web/src/features/files/ et specs/033-app-ui-review/assets/.
- [x] T006 [US1] Appliquer ui-quality + revue/corrections des formats de base, propriétés, filtres et overlays dans apps/web/src/features/databases/ et specs/033-app-ui-review/assets/.
- [x] T007 [US1] Appliquer ui-quality + revue des autres familles, éditeur/menus/liens, navigation, recherche/graphe, auth/récupération/réglages/desktop dans apps/web/src/features/ et specs/033-app-ui-review/assets/.

## Phase 3 — US2 : bibliothèque commune

Test indépendant : mêmes rôles partagés, actions/focus conservés et exemples utilisables.

- [x] T008 [US2] Consolider les besoins répétés dans apps/web/src/ui/primitives/ ; remplacer usages concernés dans apps/web/src/features/ sans toucher modèles métier.
- [x] T009 [US2] Vérifier les comportements modifiés dans apps/web/tests/ avec tests pertinents, sans E2E ni tests miroirs CSS.
- [x] T010 [US2] Appliquer ui-quality + preuves des composants communs aux deux thèmes/largeurs, clavier/tactile/mouvement réduit dans specs/033-app-ui-review/verification.md.

## Phase 4 — US3 : livraison observable

Test indépendant : instance HMR, guide actuel et preuves consultables, données conservées.

- [x] T011 [US3] Actualiser docs/design/ui-system.md et exemples apps/web/src/ui/ui-lab* avec contrats/recettes/exception réels.
- [x] T012 [US3] Vérifier instance et captures finales dans specs/033-app-ui-review/verification.md.

## Phase 5 — Convergence

- [x] T013 Exécuter types/lint/tests/build pertinents et enregistrer limites dans specs/033-app-ui-review/verification.md.
- [x] T014 Converger FR-001…008/SC-001…005 et maintenir specs/033-app-ui-review/tasks.md, sans présenter non-vu comme vérifié.

## Dépendances et stratégie

T001→T002→T003 puis T004…007 par famille. Besoins communs observés→T008→T009/T010.
T011/T012→T013/T014. Lire/rassembler les fichiers indépendants par lots ; edits
séquentiels. Incrément utile initial : états rares rendus proprement dans le lab.
La passe complète ne s’arrête pas à cet incrément. Pas de délégation nécessaire.
