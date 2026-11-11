# Feature Specification: Agrégation (rollup)

**Feature Branch**: `047-database-rollup`

**Created**: 2026-11-04

**Status**: Implémenté — agrégat « compter » (2026-11-04) — palier historique ; calculs, filtres et tris actuels : `specs/055-property-type-parity` (reprise du 2026-11-11)

**Input**: Ajouter le type Notion « Agrégation », en lecture seule, qui compte
les entrées ciblées par une relation.

## Product Direction

Canevas sections 10 et 14. L'agrégation est dérivée : aucune valeur stockée.
Cette première passe livre l'agrégat **compter**, le plus utilisé.

## Décision

- Type `rollup`, configuration `{ relationPropertyId, aggregate: "count" }`.
- La valeur est le nombre de cibles de la relation choisie, lu depuis les
  `relationTargets` de la ligne.
- Création depuis le panneau de propriété : choix de la relation à compter.
- Réglages d'une agrégation existante : même sélecteur.

## User Scenarios

### User Story 1 — Compter les entrées liées (P1)

Le propriétaire crée « Entrées liées », choisit la relation « Lié à » ; chaque
ligne affiche le nombre de pages liées, dans la table et le volet d'entrée.

**Acceptance** :

1. Créer une agrégation sans relation est refusé.
2. La valeur suit les relations de la ligne (vérifié : 1 cible → 1).
3. Le clic sur la cellule n'ouvre aucun éditeur.

## Requirements

- **FR-001** : type `rollup` avec relation valide et agrégat `count`.
- **FR-002** : aucune valeur stockée ; toute écriture est refusée.
- **FR-003** : compte des cibles de la relation, 0 si aucune.
- **FR-004** : affichage table, autres vues et volet d'entrée.
- **FR-005** : création et modification du choix de relation.

## Out of Scope

Somme, moyenne, min, max, affichage de valeurs cibles, filtres/tris sur
l'agrégat.
