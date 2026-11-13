# Feature Specification: Identité des menus et parité vérifiable

**Feature**: `052-menu-identity-parity`
**Date**: 2026-11-05

## Problème

Deux défauts constatés par le propriétaire :

1. le clic droit sur la poignée de bloc n'ouvrait pas le menu riche (seul le clic
   normal le faisait) ;
2. le survol et l'action destructive n'étaient pas cohérents entre les menus
   (éditeur, bases, navigation), et les reproductions Notion restaient des
   silhouettes sans preuve des états.

## Solution

- Identité commune des menus : hauteur, rayon, gap, survol translucide et
  destructif rouge au survol via des tokens partagés.
- Clic droit sur la poignée : ouvre le même menu riche que le clic normal.
- Outil de parité réutilisable : capture d'une surface Notion ou MyOwnNotion
  (structure, boîtes, styles repos/survol, capture, HTML), comparaison et rapport.
- Skill `notion-parity` + recettes + guide pour tous les modèles.

## Critères d'acceptation

1. Clic droit sur la poignée → menu riche, sans menu contextuel concurrent.
2. Survol d'un item de menu : voile translucide commun, clair/sombre.
3. Action destructive : neutre au repos, texte rouge + voile rouge au survol.
4. `/__ui-lab` présente l'identité des menus.
5. L'outil capture et compare le menu de bloc avec Notion, et signale les écarts.
6. Tests, typecheck, build et lint passent.

## Hors périmètre

Commenter/Suggérer/IA/Skills (fonctions absentes), copie de lien de bloc, menu de
mise en forme inline au clic droit.
