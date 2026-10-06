# Validation guide

Préparer Bun 1.4.2 et l'instance isolée `myownnotion-notion-api`, ports 8082/8445/55433. Ne pas utiliser le wrapper E2E qui configure la base par défaut du propriétaire. Aucun build Web concurrent à une matrice E2E.

1. Tester géométrie viewport/en-têtes et valeurs initiales, attente/refus/reprise.
2. Types Web/root et Biome ciblé ; corpus Web et tests de service concernés.
3. Matrice isolée : `MYOWNNOTION_E2E_API_PORT_BASE=3901 MYOWNNOTION_E2E_WEB_PORT_BASE=6073 DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/myownnotion bun scripts/e2e/run-local-matrix.ts tests/e2e/database-page-flow.spec.ts tests/e2e/database-multi-select-board.spec.ts tests/e2e/databases-visual-views.spec.ts`.
4. Contrôler densité, scrolling sur 1 000 entrées, derniers éléments/fin inline, création page/dossier/missing et rechargement/hors ligne, headers cliquables. Captures synthétiques clair/sombre 1440/320 ; preuves réelles privées.
5. Rebuild Web isolé et redéploiement Web seul sur 8082. Comparer IDs/starttimes de l'instance UI avant/après puis convergence Spec Kit.
