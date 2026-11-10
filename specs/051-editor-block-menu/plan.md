# Plan: Menu de bloc de l'éditeur

**Feature**: 051-editor-block-menu

## UI quality

- Skill `ui-quality` + `lessons.md` chargés ; composants BlockNote
  `Generic.Menu` et tokens de l'éditeur.
- Icônes `AppIcon`, séparateurs, sections, focus clavier.

## Approach

1. Remplacer le contenu de `MyOwnNotionDragHandleMenu` par un menu riche :
   en-tête, recherche, sous-menus, actions, pied de métadonnées.
2. Utiliser `components.Generic.Menu.Root/Dropdown/Item/Label/Divider` et
   `BlockColorsItem` fourni par BlockNote.
3. Ajouter les icônes, raccourcis et styles dans `editor.css`.
4. Enrichir `BlockContextMenu` (MenuRoot maison) avec les mêmes icônes et
   sections, sans changer les actions existantes.

## Risques

- Les sous-menus BlockNote ont leur propre positionnement ; vérifier à 320 px.
- La recherche ne doit pas casser la navigation clavier.
