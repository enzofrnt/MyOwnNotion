# Validation: Menu de bloc

**Feature**: 051-editor-block-menu
**Date**: 2026-11-05

## Preuves visuelles

Page `01a1a75d-dbce-7000-9019-4fda8505ab74`, instance Docker :
- [menu de bloc, clic sur la poignée](evidence/block-menu-1440.png) ;
- [sous-menu Transformer en](evidence/block-transform-submenu-1440.png) ;
- [recherche « titre »](evidence/block-menu-search-1440.png) ;
- [clic droit enrichi](evidence/block-context-menu-1440.png) ;
- [menu à 390 px, thème sombre](evidence/block-menu-390-dark.png).

## Comparaison Notion

Notion : recherche d'action, type de bloc, sous-menus Transformer en / Couleur,
Dupliquer, Déplacer, Supprimer avec raccourcis, Commenter, Suggérer, IA/Skills,
pied date/auteur/mots.
Livré : recherche, type, sous-menus Transformer en / Couleur, Dupliquer,
Déplacer, Supprimer avec raccourcis, pied mots/caractères, icônes et sections.
Non livré : Commenter, Suggérer, IA/Skills, copier le lien de bloc, date/auteur.

Clic droit : Notion ouvre un menu de mise en forme inline ; notre clic droit
reste le menu d'actions de bloc, désormais enrichi d'icônes et de sections.

## Vérifications

- ouverture réelle du menu, du sous-menu et de la recherche dans Chromium ;
- menu et sous-menu sans débordement à 390 px, thème sombre ;
- **1058 tests web** passent ; typecheck, build et lint des fichiers modifiés OK.
- Transformation « Titre 2 » déclenchée depuis le sous-menu, puis annulée.

## Limites

- La recherche affiche les actions à plat, comme Notion (Titre 1…), avec
  saisie directe, flèches et Entrée.
- Placement aligné à gauche de la poignée avec 5 px d'écart, largeur 240 px,
  sans passer sous la barre latérale.
- Actions testées : transformer, couleur (rouge appliqué), dupliquer (3→4),
  déplacer (ordre inversé), supprimer (4→3, annulé).
- L'icône de « Couleur » vient du sélecteur BlockNote et s'affiche au-dessus du
  libellé sur cette composition.
