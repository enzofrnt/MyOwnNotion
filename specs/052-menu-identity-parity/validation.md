# Validation: Identité des menus et parité

**Feature**: 052-menu-identity-parity
**Date**: 2026-11-05

## Preuves

- [survol destructif, texte rouge et voile](evidence/menu-hover-danger-1440.png)
- [section Menus et actions du laboratoire](evidence/ui-lab-menu-section-1440.png)
- [clic droit sur la poignée](evidence/right-click-handle-1440.png)
- [clic droit dans le texte](evidence/right-click-text-1440.png)

## Comparaison outillée

Commande exécutée :

```sh
bun run notion:parity:capture --profile .notion-lab/profile ...
bun run notion:parity:capture --profile .notion-lab/app-profile ...
bun run notion:parity:compare --reference ... --candidate ...
```

Le rapport relève 10 items Notion contre 5 chez nous, et signale :
- actions Notion non livrées : copier le lien, commenter, suggérer, IA, Skills ;
- ordre « Déplacer » à aligner ;
- écarts de géométrie (hauteur 28 vs 32, padding, rayon de conteneur) ;
- survol : Notion utilise un voile translucide ~5 %, notre token aligné à 6 %
  après correction.

Ces écarts sont désormais mesurés, pas supposés.

## Vérifications

- clic droit poignée : menu riche ouvert, menu contextuel de texte non visible ;
- survol « Dupliquer » : fond translucide ; « Supprimer » : texte rouge + voile ;
- `1058` tests web passent ; typecheck, build et lint des fichiers modifiés OK ;
- clic droit poignée re-vérifié après formatage : menu riche visible ;
- l’outil de capture vérifie l’**occlusion** par `elementFromPoint` ;
- la couche du menu de bloc (BlockPopover) est remontée à `z-index: 70` :
  le rapport ne signale plus aucun point de contenu recouvert, même avec une
  sidebar élargie à 480 px ; le menu est à gauche de la poignée, au-dessus de
  la sidebar.
