# Validation: Dernière modification

**Feature**: 044-database-readonly-time
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443`, base de démonstration :
[les deux colonnes](evidence/created-and-last-edited-1440.png),
[volet d'entrée avec les deux dates](evidence/dates-entry-1440.png).

« Date de création » affiche « 4 nov. 2026, 17:24 » et « Dernière
modification » « 4 nov. 2026, 17:26 » ; le clic n'ouvre aucun champ ; le volet
d'entrée montre les mêmes valeurs.

## Vérifications

```sh
bunx vitest run --project web apps/web/tests/database-time.spec.ts   # 2 tests
bunx vitest run --project domain packages/domain/tests/databases/values.spec.ts # 28
bunx vitest run --project api-contract tests/notion-api.spec.ts      # 19
bun run --filter @myownnotion/web typecheck                          # OK
bun run --filter @myownnotion/api typecheck                          # OK
```

## Limites

- Le type ne participe pas aux filtres ni aux tris.
- L'horodatage vient de la révision ; une modification de corps ou de
  propriété crée une nouvelle révision, donc la date suit bien l'édition.
