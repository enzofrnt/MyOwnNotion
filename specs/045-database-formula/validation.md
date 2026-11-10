# Validation: Formule

**Feature**: 045-database-formula
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443`, base de démonstration :
[Total TTC calculé](evidence/formula-total-1440.png),
[formule dans le volet d'entrée](evidence/formula-entry-1440.png).

Valeurs observées : Montant 120 → Total TTC 144 ; 89,90 → 107,88 ; 45 → 54.

## Vérifications

```sh
bunx vitest run --project web apps/web/tests/formula.spec.ts        # 4 tests
bunx vitest run --project web apps/web/tests/database-editor.spec.tsx # 13 tests
bun run --filter @myownnotion/web typecheck                         # OK
bun run --filter @myownnotion/web build                             # OK
```

## Limites

- Pas de filtres/tris sur une formule.
- Pas de fonctions de date ni d'agrégation.
- Les formules Notion importées restent converties en texte : leur langage
  n'est pas compatible avec ce sous-ensemble.
