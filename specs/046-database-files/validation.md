# Validation: Fichiers et médias

**Feature**: 046-database-files
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443` :
[grille avec « 1 fichier »](evidence/files-count-1440.png),
[volet d'entrée avec le fichier lié](evidence/files-entry-1440.png).

Parcours vérifié : ajout de `facture-septembre.txt`, affichage du nom, retrait,
ré-ajout, persistance après rechargement.

## Vérifications

```sh
bunx vitest run --project web apps/web/tests/database-files.spec.ts   # 2 tests
bunx vitest run --project domain packages/domain/tests/databases/values.spec.ts # 31
bun run --filter @myownnotion/web typecheck                          # OK
bun run --filter @myownnotion/web build                              # OK
```

## Limites

- Édition uniquement dans le volet d'entrée, pas dans la cellule.
- Pas d'aperçu ni de vignette dans la grille.
- L'import Notion ne mappe pas encore ses fichiers vers cette propriété.
- Des fichiers de test orphelins peuvent rester dans la barre latérale après
  des essais interrompus ; ils ne sont pas référencés par la propriété.
