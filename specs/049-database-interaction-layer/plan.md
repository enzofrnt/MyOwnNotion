# Plan: Couche d'interaction des bases

**Feature**: 049-database-interaction-layer
**Date**: 2026-11-04

## UI quality

- Skill `ui-quality` + `lessons.md` chargés ; guide `docs/design/ui-system.md`.
- Primitives : `PopoverRoot/Trigger/Content`, `DialogRoot/Content/Heading`,
  `Button`, `NativeSelect`, `AppIcon` ; tokens de `tokens.css`.
- Propriétaire CSS unique : `database.css` pour les popovers/dialogues de base.

## Approach

1. `DatabasePage` porte deux `PopoverRoot` compacts (filtre, tri) dans la barre
   d'outils ; `FilterEditor` et `SortGroupEditor` gagnent `defaultOpen` pour
   s'afficher dépliés dans un popover, fermés dans le panneau de réglages.
2. Les popovers réutilisent les éditeurs existants (mêmes mutations, mêmes
   tests) ; le panneau « Affichage » reste pour les vues intégrées et les
   réglages avancés.
3. Le « + » de table ouvre un `DialogRoot` compact contenant `PropertyEditor` ;
   le panneau de réglages garde son point d'entrée pour les autres vues.
4. États : vide, rempli, erreur, chargement ; largeur 360 px et 320 px.

## Risks

- Le popover reprend un éditeur avec un bouton Enregistrer : friction connue,
  à traiter dans une passe suivante (application immédiate).
- Le menu d'en-tête et les menus contextuels restent hors de cette première
  passe.
