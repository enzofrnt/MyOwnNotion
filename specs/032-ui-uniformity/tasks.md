# Tasks: Uniformité des surfaces Web

Sources : [spec.md](spec.md), [plan.md](plan.md),
[ui-quality](../../.agents/skills/ui-quality/SKILL.md) et
[lessons.md](../../.agents/skills/ui-quality/lessons.md).

## Phase 1 — Préparation

- [x] T001 Vérifier le commit 031 et créer la branche 032 ; conserver la trace dans specs/032-ui-uniformity/verification.md.
- [x] T002 Corriger la copie du module preinstall dans docker/dev.Dockerfile et les images partageant cette entrée.
- [x] T003 Inventorier sources et différences réelles de chaque famille dans specs/032-ui-uniformity/verification.md.

## Phase 2 — US1 : instance observable

Test indépendant : application/laboratoire disponibles et sources montées depuis ce checkout.

- [x] T004 [US1] Remplacer la stack locale sans effacer les anciens volumes ; documenter commandes dans specs/032-ui-uniformity/quickstart.md.
- [x] T005 [US1] Appliquer ui-quality + preuve visuelle de l’instance et du laboratoire ; enregistrer santé et mounts dans specs/032-ui-uniformity/verification.md.

## Phase 3 — US2 : contrôles et états communs

Test indépendant : fixtures de vrais composants, rôles et état conservés, mêmes repères visuels.

- [x] T006 [US2] Harmoniser les contrôles natifs historiques dans apps/web/src/ui/compatibility.css avec les primitives, préserver exclusions tiers/domaine.
- [x] T007 [US2] Retirer les overrides de variantes contradictoires dans apps/web/src/features/settings/settings-security.css et auth/auth.css.
- [x] T008 [US2] Harmoniser les champs/select/états des formulaires de settings, backup, files et search dans leurs composants/CSS propriétaires.
- [x] T009 [US2] Vérifier les variantes des bases, navigation, éditeur, graphe et overlays ; corriger les écarts observés dans leurs propriétaires existants.
- [x] T010 [US2] Étendre les exemples nécessaires avec les vrais composants et fixtures mémoire dans apps/web/src/ui/ui-lab*.
- [x] T011 [US2] Ajouter uniquement les tests comportementaux nécessaires aux interactions modifiées dans apps/web/tests/ ; exécuter les suites ciblées.
- [x] T012 [US2] Appliquer ui-quality + preuves visuelles des contrôles/états, clavier et texte long dans specs/032-ui-uniformity/assets/ et verification.md.

## Phase 4 — US3 : hiérarchie et composition

Test indépendant : familles revues, 320/1280 clair/sombre, exceptions documentées, aucun débordement document.

- [x] T013 [US3] Harmoniser les rangées et sections des réglages dans apps/web/src/features/settings/settings.css ; conserver densité secondaire et actions utiles.
- [x] T014 [US3] Ajuster les layouts restants observés dans apps/web/src/features/ et conserver leurs exceptions de domaine justifiées dans verification.md.
- [x] T015 [US3] Appliquer ui-quality + captures réelles des familles en 320/1280 clair/sombre ; zoom équivalent et mouvement réduit si touchés dans specs/032-ui-uniformity/assets/.
- [x] T016 [US3] Actualiser docs/design/ui-system.md avec les recettes et exceptions réellement vérifiées.

## Phase 5 — Convergence

- [x] T017 Exécuter types, lint ciblé, tests pertinents et build ; consigner résultats et limites sans E2E dans specs/032-ui-uniformity/verification.md.
- [x] T018 Confronter FR-001…008/SC-001…005 au code et aux preuves, résoudre tout écart matériel et mettre à jour specs/032-ui-uniformity/tasks.md.

## Dépendances et stratégie

T001/T002 → T004/T005. T003 précède toute correction visuelle ; T006…009 par
famille, puis T010/T011/T012 ; T013/T014 → T015/T016 → T017/T018.
Observations CSS et captures peuvent être collectées indépendamment ; éditions
et validations restent séquentielles. Pas de délégation nécessaire.
US1 est l’incrément initial livré au propriétaire ; US2/US3 poursuivis dans
la même passe autorisée. Aucune tâche visuelle cochée sans preuve réelle.
