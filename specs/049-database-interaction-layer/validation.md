# Validation: Couche d'interaction des bases

**Feature**: 049-database-interaction-layer
**Date**: 2026-11-04

## Preuves visuelles

Instance `https://localhost:8443`, page « Nouvelle base de données » :

- [popover Filtres](evidence/filter-popover-1440.png) ;
- [popover Trier](evidence/sort-popover-1440.png) ;
- [dialogue Nouvelle propriété](evidence/property-create-dialog-1440.png) ;
- [menu contextuel de ligne](evidence/row-context-menu-1440.png) ;
- [menu d'en-tête au clic droit](evidence/header-context-menu-1440.png) ;
- [menu d'en-tête restylé](evidence/header-menu-1440.png) ;
- [menu contextuel d'onglet de vue](evidence/view-tab-menu-1440.png) ;
- [menu contextuel de cellule](evidence/cell-context-menu-1440.png) ;
- [filtre appliqué sans bouton Enregistrer](evidence/live-filter-1440.png) ;
- [tri appliqué sans bouton Enregistrer](evidence/live-sort-1440.png) ;
- [sélecteur de type dans le menu d'en-tête](evidence/header-type-select-1440.png) ;
- [largeur 390 px](evidence/narrow-390-1440.png) ;
- [thème sombre, filtre à 390 px](evidence/dark-filter-390.png) ;
- [dialogue à 320 px](evidence/narrow-320-dialog.png).

## Vérifications

- typecheck web ;
- tests web des bases (à relancer après la passe) ;
- ouverture réelle des trois surfaces dans Chromium.

## Limites

- Les popovers appliquent désormais filtres et tris automatiquement, sans
  bouton Enregistrer ; le panneau de réglages conserve l'action explicite.
- Le clic droit ouvre le menu d'en-tête, le menu de ligne et le menu d'onglet
  de vue ; une cellule hérite du menu de ligne.
- Le menu d'en-tête est restylé (icône de type, nom sans libellé, séparateur).
- Le clic droit d'une cellule ouvre « Modifier », « Filtrer sur cette propriété »,
  « Copier la valeur ».
- Les tests unitaires ciblés des nouveaux menus restent à compléter ; les
  parcours réels sont vérifiés dans Chromium.
