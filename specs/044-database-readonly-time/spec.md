# Feature Specification: Date de création et dernière modification (lecture seule)

**Feature Branch**: `044-database-readonly-time`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Ajouter les types Notion « Date de création » et « Dernière
modification », en lecture seule, sans nouvelle valeur stockée : la création
vient de l'entrée locale, la dernière modification de sa révision courante.

## Product Direction

Canevas sections 10 et 14. Notion expose « Date de création » et « Dernière
modification » comme propriétés système. Les deux sont livrées.

## Décision

La création et la dernière modification sont transportées avec l'entrée
locale (`createdAt`, `updatedAt`). La révision courante reste un UUIDv7 et sert
de repli pour la dernière modification. Aucune valeur n'est écrite sur ces
types.

## User Scenarios

### User Story 1 — Voir les deux dates (P1)

Le propriétaire ajoute « Date de création » et « Dernière modification » à une
source ; chaque ligne affiche les deux dates, dans la table, les autres vues et
le volet d'entrée.

**Acceptance** :

1. Ajouter le type depuis le panneau de propriété.
2. Les lignes existantes affichent deux dates localisées, pas « — ».
3. Cliquer sur la cellule n'ouvre aucun éditeur.
4. Le volet d'entrée affiche la même date en lecture seule.

## Requirements

- **FR-001** : types `created-time` et `last-edited-time` à configuration vide.
- **FR-002** : aucune valeur stockée ; toute écriture est refusée.
- **FR-003** : la création vient de `createdAt`, la modification de `updatedAt`
  ou, à défaut, de l'UUIDv7 de `revisionId`.
- **FR-004** : affichage localisé `fr-FR` (date + heure).
- **FR-005** : import Notion `created_time` / `last_edited_time` conserve le
  type, sans valeur.
- **FR-006** : le clic et le clavier n'ouvrent pas d'éditeur.

## Out of Scope

Filtres et tris sur ces types, fuseau horaire par valeur.
