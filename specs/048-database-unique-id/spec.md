# Feature Specification: Identifiant

**Feature Branch**: `048-database-unique-id`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Ajouter le type Notion « Identifiant », entier stable attribué par
base, en lecture seule.

## Product Direction

Canevas sections 10 et 14. L'identifiant est une donnée technique stable de la
ligne, pas une valeur éditable.

## Décision

- Nouvelle colonne `database_entries.entry_number`, unique par base.
- Migration `0021` : les lignes existantes sont numérotées par ordre de
  création, puis un trigger attribue `max + 1` aux nouvelles lignes.
- Le numéro voyage dans la requête, le DTO d'entrée et la projection locale.
- Type `unique-id` à configuration vide ; aucune valeur stockée, aucune
  écriture acceptée.

## User Scenarios

### User Story 1 — Voir un identifiant stable (P1)

Le propriétaire ajoute « Identifiant » ; chaque ligne affiche son numéro, y
compris les lignes créées avant l'ajout de la propriété.

**Acceptance** :

1. Les lignes existantes reçoivent un numéro lors de la migration.
2. Une nouvelle ligne reçoit le numéro suivant.
3. Le numéro ne change pas quand on modifie la ligne.
4. Le clic n'ouvre aucun éditeur.

## Requirements

- **FR-001** : type `unique-id` à configuration vide.
- **FR-002** : numéro unique par base, stable.
- **FR-003** : attribution automatique à la création.
- **FR-004** : affichage table, autres vues et volet d'entrée.
- **FR-005** : import et restauration conservent le numéro.
- **FR-006** : aucune valeur dans les valeurs d'entrée.

## Out of Scope

Préfixe personnalisable, remise à zéro du compteur, réutilisation des numéros
supprimés.
