# Feature Specification: Couche d'interaction des bases

**Feature Branch**: `049-database-interaction-layer`

**Created**: 2026-11-04

**Status**: En cours

**Input**: Remplacer les grands panneaux de réglages par des surfaces d'interaction
soignées, proches de Notion : filtres et tris dédiés, création/édition de
propriétés, menus d'en-tête et menus contextuels avec des actions logiques.

## Product Direction

Canevas section 14 : chaque vue conserve filtres, tris, regroupements et
propriétés visibles ; le regroupement se règle dans les paramètres. La demande
du propriétaire précise la forme : interfaces dédiées et propres, pas le grand
panneau « Affichage ».

## User Scenarios

### US1 — Filtrer sans quitter la vue (P1)

Le propriétaire clique sur l'icône filtre ; un popover compact s'ouvre sous
l'icône, avec la liste des règles et l'ajout d'une règle. Il peut fermer par
Échap ou clic extérieur.

### US2 — Trier sans quitter la vue (P1)

Même chose pour le tri : popover compact, ajout/suppression de tris, fermeture
sans perdre la vue.

### US3 — Créer une propriété proprement (P1)

Le « + » d'en-tête ouvre un dialogue compact avec nom et type ; l'erreur reste
près des champs, la saisie est conservée en cas de refus, Échap/Annuler ferme.

## Requirements

- **FR-001** : filtres et tris ont chacun un popover dédié ancré à son icône.
- **FR-002** : le contenu du popover est ouvert directement, sans étape de
  dépliage.
- **FR-003** : la création de propriété est une surface compacte, pas le panneau
  « Affichage ».
- **FR-004** : les actions destructives restent confirmées ; aucune perte de
  brouillon sur erreur.
- **FR-005** : clavier : Échap ferme et rend le focus au déclencheur.
- **FR-006** : le rendu reste utilisable à 320 px.

## Out of Scope (passe suivante)

Menus contextuels de ligne/cellule/onglet, refonte complète du menu d'en-tête,
application immédiate des filtres sans bouton Enregistrer, recherche de propriété
dans les popovers.

## UI states

- Filtres : aucune règle (état actuel), règles présentes, erreur d'enregistrement.
- Tris : aucun tri, tris présents, erreur.
- Création : nom vide (validation), type choisi, erreur serveur, chargement.
