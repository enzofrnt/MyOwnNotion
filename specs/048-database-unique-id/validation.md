# Validation: Identifiant

**Feature**: 048-database-unique-id
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443` :
[colonne « Identifiant » numérotée](evidence/unique-id-1440.png).

Valeurs observées : lignes existantes numérotées 1 à 4 par ordre de création,
puis « 2 » pour « Client Dupont ».

## Vérifications

```sh
bunx vitest run --project web apps/web/tests/database-unique-id.spec.ts
bunx vitest run --project domain packages/domain/tests/databases/values.spec.ts
bun run --filter @myownnotion/web typecheck
bun run --filter @myownnotion/web build
```

La migration `0021_database_entry_numbers` a été appliquée sur l'instance de
test (colonne, index unique partiel, trigger et rétro-remplissage vérifiés).

## Limites

- Les projections locales existantes doivent être resynchronisées pour recevoir
  `entryNumber` ; un navigateur neuf le reçoit dès le snapshot.
- Les numéros ne sont pas réutilisés après suppression d'une ligne.
- Le numéro est par base, pas par source.
