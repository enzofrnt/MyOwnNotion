# Validation en cours

## Onglets du workspace — 28 septembre 2026

- Une base propriétaire et un élément de vue liée ouverts reçoivent chacun un onglet du workspace. Leurs identités et icônes restent distinctes ; les fichiers autonomes restent exclus.
- Le test ciblé `apps/web/tests/open-tabs-strip.spec.tsx` vérifie les deux onglets, l'indicateur de vue liée, l'état actif et l'activation d'une base. Les 13 tests de ce fichier passent.
- `bun run typecheck` passe sur tous les packages. Les tests unitaires ciblés des onglets, du déplacement de blocs et des icônes passent (25 tests). `git diff --check` passe.
- L'instance de développement liée au worktree répond sur `http://localhost:8080/` et ses quatre services sont sains.
- Revue visuelle encore à faire : l'outil de navigateur intégré rencontre le certificat de développement, et sa connexion Chrome a expiré. Aucune capture de cet état n'est donc validée ; les tâches UI correspondantes restent ouvertes.
- Les E2E restent différés conformément à la demande du propriétaire pendant cette phase de corrections et d'améliorations.
