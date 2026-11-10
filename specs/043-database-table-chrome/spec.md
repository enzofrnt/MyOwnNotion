# Feature Specification: Chrome de table proche de Notion

**Feature Branch**: `043-database-table-chrome`

**Created**: 2026-11-04

**Status**: Implémenté (2026-11-04)

**Input**: Rendre la table de base de données plus proche de Notion : filtres et
tris visibles sans ouvrir un panneau, ajout de ligne en bas, un seul titre de
page, et suppression de la duplication page/source.

## Product Direction

Concrétise le canevas, sections 14 et 33 : la table doit rester lisible, les
réglages actifs doivent être visibles, et la création d'une entrée doit rester
accessible sans quitter le tableau. La référence Notion mesurée est consignée
dans [notion-database-reference.md](../../docs/design/notion-database-reference.md).

## User Scenarios

### User Story 1 — Voir les filtres et tris actifs (P1)

Une vue filtrée ou triée affiche ses règles sous la barre d'onglets, chacune
retirable d'un clic, sans ouvrir le panneau de réglages.

**Acceptance** : appliquer un tri sur « Lien » affiche « Lien · croissant » ;
cliquer sur la croix retire le tri et recharge la vue.

### User Story 2 — Ajouter une ligne en bas du tableau (P1)

La dernière rangée du tableau propose « + Nouvelle page » et « + Nouveau
dossier », comme Notion, au lieu de boutons au-dessus de la grille.

**Acceptance** : cliquer sur « Nouvelle page » crée une entrée et ouvre son
titre pour la nommer.

### User Story 3 — Un seul titre (P1)

Une base pleine page n'affiche pas deux fois le même titre (titre de page et
titre de source). Une base intégrée continue d'afficher le titre de sa source.

**Acceptance** : base pleine page avec une source → un seul champ de titre ;
base intégrée → titre de source visible.

## Out of Scope

Recherche dans la vue : passe suivante. Le bouton primaire « Nouveau » et les
icônes filtre/tri/réglages sont livrés.

## Success Criteria

- Les chips reflètent l'état réel de la vue et le retirent.
- La création d'entrée reste accessible au clavier et au pointeur.
- Les tests web des bases passent.
- Aucun changement de domaine, de contrat ou de migration.
