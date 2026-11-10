# Feature Specification: Menu de création de propriété et icônes de types

**Feature**: `053-database-property-menu`
**Date**: 2026-11-05

## Problème

1. Le « + » de colonne ouvrait un dialogue unique nom + type, pas le sélecteur de
   type propre à Notion. Les contextes (table, panneau de réglages, page/volet)
   partagent encore des présentations différentes.
2. Les icônes de types mélangeaient des glyphes texte (`Aa`, `#`) et des icônes
   Lucide, avec des styles hétérogènes.

## Livré

- Étape 1 : sélecteur de type avec **recherche**, grille deux colonnes, icônes.
- Étape 2 : nom et configuration du type choisi, avec retour « Changer de type ».
- Icônes de types unifiées en Lucide : `Type`, `Hash`, `Fingerprint`, `Calendar`,
  `CircleDashed` (statut), `SquareChevronDown` (sélection), `List` (sélection
  multiple), `SquareCheck` (case), `Link`, `Mail`, `Phone`, `Clock`, `Paperclip`,
  `Sigma`.
- Le sélecteur est utilisé par le « + » de la table.

## Hors périmètre / suite

- Les contextes « propriété depuis une page/volet » et « depuis les réglages »
  gardent leur formulaire inline ; il faut réutiliser le même sélecteur avec un
  placement adapté.
- Notion distingue aussi les menus selon l’endroit (page existante, dossier,
  ajout direct) ; cette passe ne reproduit que le flux table.
