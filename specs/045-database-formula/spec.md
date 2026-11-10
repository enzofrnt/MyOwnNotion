# Feature Specification: Propriété Formule

**Feature Branch**: `045-database-formula`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Ajouter le type Notion « Formule », en lecture seule, calculé à
partir des autres propriétés de la ligne.

## Product Direction

Canevas sections 10 et 14. La formule est une propriété dérivée : aucune valeur
n'est stockée, le calcul se fait à la lecture dans le client.

## Décision

Un petit langage sûr et sans effet de bord :

- `prop("Nom")` lit une propriété de la ligne ;
- nombres, chaînes, booléens, `null` ;
- `+ - * / %`, comparaisons `== != < <= > >=`, `&& || !`, parenthèses ;
- fonctions `if`, `round`, `abs`, `concat`, `length`, `lower`, `upper`, `number`,
  `text`.

Une expression inconnue ou invalide renvoie `—` ; elle n'écrit jamais et ne
declenche aucun accès réseau.

## User Scenarios

### User Story 1 — Calculer une colonne (P1)

Le propriétaire crée « Total TTC » avec `prop("Montant") * 1.2` ; chaque ligne
affiche le résultat, dans la table, les autres vues et le volet d'entrée.

**Acceptance** :

1. Créer une formule via le panneau de propriété ; une expression vide est
   refusée.
2. Modifier `Montant` met à jour `Total TTC` sans écrire de valeur.
3. Une formule invalide affiche `—`.
4. Le clic sur la cellule n'ouvre aucun éditeur.

## Requirements

- **FR-001** : type `formula` avec `config.expression` non vide (≤ 2000).
- **FR-002** : aucune valeur stockée ; toute écriture est refusée.
- **FR-003** : évaluation côté client, sans réseau.
- **FR-004** : `prop("…")` résout titre, texte, nombre, date, case, sélection,
  relation (nombre de cibles), dates système.
- **FR-005** : une formule invalide ou une propriété inconnue donne `—`.
- **FR-006** : affichage dans table, kanban, galerie, liste et volet d'entrée.

## Out of Scope

Filtres et tris sur une formule, fonctions de date, agrégations de relations.
