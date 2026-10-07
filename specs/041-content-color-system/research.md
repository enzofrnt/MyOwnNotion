# Research — Couleurs de contenu

## Référence réellement inspectée

Le 2026-10-07, lecture DOM/getComputedStyle de l'onglet Notion fourni :
https://app.notion.com/p/2b1e31adde7780cb828ad46e5174c4a8?v=2b1e31adde7780df8cd5000c0a536906
Les mesures concernent le thème sombre ; elles ne prouvent pas le rendu clair
de Notion ni l'algorithme interne de génération de sa palette.

| Rôle | Neutre | Bleu | Vert |
| --- | --- | --- | --- |
| Canvas | `#191919` | idem | idem |
| Colonne | blanc 3 % | bleu `(41,139,253)` 6,3 % | vert `(83,255,140)` 3,5 % |
| Carte au repos | `#202020` | `#213041` | `#24342b` |
| Contour | `(255,255,243)` 8,2 % | `(71,157,255)` 17,3 % | `(119,255,179)` 11,8 % |
| Accent création/point | texte neutre `#bcbab6` / point `#8e8b86` | `#2783de` | `#46a171` |
| Badge groupe | `(255,252,235)` 30,6 % | `(81,166,255)` 49,4 % | `(113,255,175)` 33,7 % |

Le contour est une ombre de 1 px, pas une bordure en couleur de texte.
Les cartes ont aussi une ombre de profondeur très faible ; rayon 10 px.
Le survol réel relève la luminosité HSL du fond de 2,5 points sans perdre sa
teinte. Les groupes ne possèdent pas de bordure. Les options des cartes utilisent
le même fond fort que les groupes, avec une autre géométrie (4 px vs pastille).

Fichiers privés de mesure : `work/notion-api/041-notion-colors-dark.json`,
`041-notion-palette-dark.json`, `041-notion-reference-dark.jpg`.

## Cause locale

La bordure de toutes les cartes et créations est surchargée par `--pill`,
qui pointe vers le texte clair des couleurs de contenu en sombre. Le fond de
badge utilise le même `-soft` que la carte ; la colonne le dilue encore. Il
manque donc des rôles distincts, pas simplement une saturation plus forte.

## Choix

Une teinte de base par famille, des ratios communs par thème pour la surface
faible, le contenu, le badge et le contour. Le gris utilise les surfaces neutres.
Les teintes de base sont inspirées des accents mesurés ; les transformations
restent les nôtres et sont vérifiées à l'écran. Ne pas copier une table de toutes
les couleurs de chaque composant. Conserver les noms de couleurs stockées.

## Ajustement après revue

L’ancien OptionTonePicker a été aligné sur -accent. Les accents mesurés dans
Notion sombre ne sont pas assez contrastés pour du texte sur nos fonds clairs
(jaune ≈2,1:1). Un rôle commun -foreground mélange 52 % accent avec le texte
principal en clair, 100 % en sombre. Il sert aux commandes et compteurs,
sans changer le point, le badge ni le texte éditorial.
