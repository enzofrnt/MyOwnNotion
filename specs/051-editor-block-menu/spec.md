# Feature Specification: Menu de bloc de l'éditeur

**Feature**: `051-editor-block-menu`
**Date**: 2026-11-05

## Problème

Le bouton « Ouvrir le menu du bloc » ouvre une liste plate : six actions sans
icône, sans section, sans recherche, sans sous-menu, sans raccourci et sans
métadonnées. Le menu de Notion est plus fourni et plus fini.

## Comparaison Notion

Notion (clic normal sur la poignée) :
- champ « Rechercher des actions… » ;
- en-tête du type de bloc (« Texte ») ;
- « Transformer en » et « Couleur » en sous-menus ;
- « Copier le lien du bloc », « Dupliquer », « Déplacer » (sous-menu),
  « Supprimer » avec raccourcis ;
- « Commenter », « Suggérer des modifications » ;
- « Demander à l'IA », « Skills » ;
- pied de menu : date de modification, auteur, mots/caractères.

Notion (clic droit dans le texte) : menu de mise en forme (style de texte,
gras/italique/souligné/barré/code/lien), commentaire et actions IA.

## Périmètre livré

- En-tête du type, recherche d'action, icônes, sous-menu « Transformer en »
  (texte, titres 1–3, listes, tâche, citation, code), « Couleur » via le
  sélecteur BlockNote si le bloc le supporte, « Déplacer » (haut/bas),
  « Dupliquer », « Supprimer » avec raccourcis et style danger.
- Pied de menu : nombre de mots et de caractères.
- Clic droit : menu de bloc enrichi avec icônes, sections et raccourcis.

## Hors périmètre

Commentaires, suggestions, IA/Skills, copie de lien de bloc, mise en forme inline
complète au clic droit (non pris en charge par l'éditeur aujourd'hui).

## Critères d'acceptation

1. Le menu s'ouvre au clic sur la poignée et se ferme par Échap.
2. La recherche filtre les actions.
3. Les transformations et déplacements fonctionnent comme avant.
4. Le menu reste utilisable à 320 px et en thème sombre.
5. Les tests éditeur existants passent.
