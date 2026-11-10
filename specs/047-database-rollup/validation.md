# Validation: Agrégation (compter)

**Feature**: 047-database-rollup
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443` :
[agrégation à 1 après avoir lié « Facture septembre »](evidence/rollup-count-1-1440.png).

## Vérifications

```sh
bunx vitest run --project web apps/web/tests/database-rollup.spec.ts  # 2 tests
bunx vitest run --project domain packages/domain/tests/databases/values.spec.ts
bun run --filter @myownnotion/web typecheck
bun run --filter @myownnotion/web build
```

## Limites

- Seul l'agrégat « compter » est livré ; somme/moyenne/min/max restent à faire.
- La démonstration est vérifiée avec une relation posée : « Entrées liées » = 1.
- Le menu de relation expose des `menuitemcheckbox` (sélection multiple), pas des
  `menuitem` simples ; ce détail a faussé un premier essai automatisé.
- Pas de filtres ni de tris sur l'agrégat.
