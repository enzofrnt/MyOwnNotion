# Tasks: Chargement progressif

## Phase 1: Setup

- [x] T001 Lire constitution/canevas et auditer boot, serveur et navigation dans research.md.
- [x] T002 Spécifier, planifier et analyser spec.md/plan.md/tasks.md sans ambiguïté matérielle.

## Phase 2: Foundations

- [x] T003 Tester publications après commit et marqueur complet/partiel dans packages/client-core/tests/reconciliation.spec.ts.
- [x] T004 Ajouter callback après lot durable et couverture dans packages/client-core/src/reconciliation/reconcile.ts et local-store/schema.ts.

## Phase 3: US1 — Appareil neuf

- [x] T005 [US1] Tester racines prioritaires, reprise et garde outbox dans apps/web/tests/progressive-startup.spec.ts.
- [x] T006 [US1] Précharger racines et démarrer catchup background dans apps/web/src/services/local-content.ts.
- [x] T007 [US1] Appliquer ui-quality/lessons aux états partiels, routes et conservation du contexte dans apps/web/src/features/hierarchy/hierarchy-explorer.tsx.
- [x] T008 [US1] Vérifier appareil neuf ≥300 descendants et lot retardé dans tests/e2e/progressive-startup.spec.ts ; preuves visuelles dans validation.md.

## Phase 4: US2 — Appareil rempli

- [x] T009 [US2] Tester boot local, journal pending et erreurs dans apps/web/tests/progressive-startup.spec.ts.
- [x] T010 [US2] Vérifier page locale/réseau retardé et édition concurrente dans tests/e2e/progressive-startup.spec.ts ; ui-quality/lessons et preuves réelles validation.md.

## Phase 5: US3 — Travail dérivé

- [x] T011 [P] [US3] Tester et différer worker/index inutilisé dans apps/web/src/services/search.ts et apps/web/tests/search-service.spec.ts.
- [x] T012 [P] [US3] Fusionner les upserts par lots dans apps/web/src/features/hierarchy/navigation-item-signature.ts et hierarchy-explorer.tsx ; tests dédiés.
- [x] T013 [US3] Vérifier première recherche et navigation réelles dans tests/e2e/progressive-startup.spec.ts et validation.md avec ui-quality/lessons.

## Phase 6: Validation et convergence

- [x] T017 Protéger la lecture des bases déjà locales pendant une découverte inconnue/hors ligne (DatabaseViewSurface, DatabasePage, TableView, canvas natif) ; tests de cache legacy, fallback, total inconnu et preuve E2E selon ui-quality/lessons.
- [x] T014 Exécuter tests ciblés puis gate complet documenté dans docs/development.md ; consigner evidence dans validation.md.
- [x] T015 Déployer web 8082 seul et vérifier parcours réels/320 px/thèmes/clavier dans validation.md ; préserver API, DB et 8080.
- [x] T016 Converger code/spec/plan/tasks dans validation.md ; capitaliser seulement les leçons vérifiées.

## Dependencies and parallel execution

T003→T004→T005/T006→T007→T008/T009/T010 ; T011 indépendant après T002.
T012 suit T007 pour éviter les écritures simultanées dans hierarchy-explorer.
T013 suit T011/T012 ; validation finale après toutes les implémentations.
T017 complète FR003/US2.1 avant T014 : un ancien cache sans marqueur doit rester
lisible sans être présenté comme un catalogue complet.
MVP US1 puis US2 et travail dérivé borné ; aucun chantier serveur supplémentaire.

## Phase 7: Convergence

- [x] T018 Compléter les tests des frontières de reprise, intentions locales et projections opérationnelles exigées par FR005 et le gate de couverture (partial) ; conserver les plafonds existants, puis reprendre T014.
