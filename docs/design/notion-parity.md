# Parité Notion

Outil et méthode reproductibles pour comparer une surface MyOwnNotion à Notion.

## Outils

```sh
bun run notion:parity:capture --profile .notion-lab/profile --url <notion-url> \
  --steps scripts/notion-parity/recipes/notion-block-menu.json \
  --selector auto --item "[role=option]" --out .notion-lab/parity/notion-block-menu

bun run notion:parity:capture --profile .notion-lab/app-profile --url <app-url> \
  --steps scripts/notion-parity/recipes/myownnotion-block-menu.json \
  --selector ".bn-drag-handle-menu" --item ".bn-menu-item" \
  --out .notion-lab/parity/myownnotion-block-menu

bun run notion:parity:compare \
  --reference .notion-lab/parity/notion-block-menu/capture.json \
  --candidate .notion-lab/parity/myownnotion-block-menu/capture.json
```

Chaque capture produit `capture.json`, `report.md` et `surface.png`. Le rapport
donne les styles calculés au repos et au survol, les boîtes, l’ordre et le HTML.
La comparaison signale les items manquants/en trop et les écarts de styles.

## Recettes

`scripts/notion-parity/recipes/` contient les pas d’interaction (survol, clic,
clic droit). Une recette est réutilisable pour toute surface : barre, popover,
dialogue. `--selector auto` calcule le plus petit ancêtre commun des items.

## Gate automatisé

Chaque surface suivie a sa configuration (menu parent et chaque sous-menu). Le
gate compare aussi le voile de survol et lit les nœuds texte bruts des boutons
sans span. Pour une surface suivie, une configuration unique suffit :

```sh
bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-menu.json
```

La configuration décrit la recette de référence, la recette candidate, les
sélecteurs, le profil et les éléments explicitement hors périmètre. Le gate
capture les deux surfaces, compare tous les items (géométrie, icônes, texte,
chevrons, sections) et sort en erreur si un item ou une mesure in-scope dérive.
Les éléments hors périmètre sont listés dans le rapport, jamais oubliés.

## Identité des menus

- hauteur d’item : `--ui-menu-item-height` ;
- survol : `--ui-menu-item-hover-bg` (voile translucide, thème clair/sombre) ;
- destructif : neutre au repos, `--ui-color-danger-text` +
  `--ui-menu-item-danger-hover-bg` au survol/focus ;
- primitives : `.ui-menu__item`, `.bn-menu-item` et boutons de menu de base
  partagent ces tokens ;
- démonstration : `/__ui-lab`, section « Menus et actions ».

## Correction de forme — ne pas confondre mesure et résultat

Le contrôle automatique n’est pas une validation visuelle. Une police absente
ne doit pas être comparée à une autre valeur absente ; une graisse et les boîtes
SVG doivent être réellement testées. Les captures historiques sans famille de
police sont incomplètes et doivent être refaites.

Pour une adaptation au contexte MyOwnNotion, documenter l’échelle optique
choisie (menu de colonne : texte normal 13 px, lignes 28 px, icônes 20 px), sans prétendre que
la différence avec Notion a disparu. Examiner le rendu à taille native dans la
page, pas seulement une capture agrandie. Vérifier aussi tous les portails
imbriqués : ils n’héritent pas du CSS du menu déclencheur.
