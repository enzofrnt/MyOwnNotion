# Validation: Menu de création de propriété et icônes

**Feature**: 053-database-property-menu
**Date**: 2026-11-05

## Preuves

- [sélecteur de type, recherche et icônes](evidence/property-type-picker-1440.png)
- [étape nom/configuration avec retour](evidence/property-config-step-1440.png)
- [popover ancré à la colonne +, sans carré de focus](evidence/property-popover-1440.png)

## Vérifications

- Le « + » ouvre le sélecteur, la recherche filtre les types, le choix ouvre le
  formulaire avec « Changer de type ».
- Test d’interaction mis à jour : type choisi avant le nom, options visibles.
- Icônes : plus aucun glyphe `Aa`/`#` dans le sélecteur, les en-têtes ni le volet.
- Le champ de recherche n'affiche plus de carré de focus : caret seul, bord subtil.
- Le menu est un popover ancré, large de 440 px, et non un dialogue centré ;
- groupes « Basique » / « Avancé » avec séparateurs, champ nom, deux colonnes ;
- icône de propriété cliquable dans l'en-tête, catalogue interne et suppression ;
- menu d'en-tête avec sections Affichage/Structure et suppression rouge ;
- placement recalculé pour rester dans la fenêtre même si la colonne + est
  hors écran.
- **1058 tests web** passent (deux attentes d’icônes mises à jour vers `data-icon="type"`),
  typecheck et build OK.

## Limites

- Le flux « page existante / dossier / ajout direct » n’est pas encore
  contextualisé ; seul le flux table est livré.
- Les icônes de types sont Lucide mais certains pictogrammes (statut, sélection)
  restent à valider visuellement avec le propriétaire.
