---
name: notion-parity
description: Reproduire une surface Notion dans MyOwnNotion avec une méthode vérifiable (structure, styles, états, clic droit, thèmes). À utiliser dès qu’une demande dit « comme Notion ».
---

# Parité Notion vérifiable

Reproduire Notion ne veut pas dire copier une silhouette. La parité est atteinte
quand la **structure**, les **libellés**, l’**ordre**, les **états** (repos,
survol, focus, actif, désactivé, destructif), les **dimensions**, les **couleurs**
et les **parcours clavier** sont alignés — et le prouvent.

## Quand l’utiliser

- « Fais comme Notion », « reproduis ce menu », « même UX que Notion ».
- Toute surface d’interaction : menus, popovers, dialogues, barres, cartes.
- Avant de coder, puis après coder pour comparer.

## Prérequis

- Session Notion de test : `bun run notion:login` (profil `.notion-lab/profile`).
- Session MyOwnNotion : profil `.notion-lab/app-profile`.
- Ne jamais capturer le workspace personnel ; utiliser le workspace de test.
- Les captures vont dans `.notion-lab/parity/` (ignoré par Git).

## Boucle obligatoire

### 1. Capturer la référence

Écrire une recette JSON de pas d’interaction (clic normal **et** clic droit),
puis :

```sh
bun run notion:parity:capture \
  --profile .notion-lab/profile \
  --url "https://app.notion.com/p/<page>" \
  --steps scripts/notion-parity/recipes/notion-block-menu.json \
  --selector auto --item "[role=option]" \
  --out .notion-lab/parity/notion-block-menu
```

La capture contient : HTML du conteneur, boîtes, styles calculés au repos et au
survol de chaque item, capture d’écran, rapport Markdown.

### 2. Relever exhaustivement

Lister dans la feature :

1. **Structure** : chaque item, son ordre, ses sections, sous-menus, séparateurs.
2. **Libellés et raccourcis** exacts.
3. **Géométrie** : largeur, hauteur des items, padding, gap, rayon, ombre.
4. **Couleurs** : fond, texte, bordure, survol, focus, destructif, thème sombre.
5. **États** : repos, survol, focus, actif, désactivé, chargement, erreur.
6. **Parcours** : clic normal, clic droit, Échap, clavier, retour du focus.
7. **Responsive** : 320 px, 390 px, texte long.
8. **Fonctions non prises en charge** : à déclarer hors périmètre, pas à simuler.

### 3. Implémenter

- Réutiliser les primitives (`MenuContent`, `MenuItem`, `PopoverContent`, `Dialog…`).
- Les couleurs viennent des tokens ; ne jamais recopier un hex Notion.
- Le survol est un **voile translucide** commun (`--ui-menu-item-hover-bg`), pas
  un fond opaque différent par menu.
- Une action destructive est neutre au repos, **rouge au survol/focus** avec un
  voile rouge (`--ui-menu-item-danger-hover-bg`).
- Afficher les raccourcis à droite, alignés, muted.
- Le clic droit doit ouvrir la **même surface logique** que le clic normal sur la
  poignée, ou une surface explicitement prévue ; jamais rien.

### 4. Capturer le candidat

Même recette, mêmes sélecteurs, profil app :

```sh
bun run notion:parity:capture \
  --profile .notion-lab/app-profile \
  --url "https://localhost:8443/notes/<page>" \
  --steps scripts/notion-parity/recipes/myownnotion-block-menu.json \
  --selector ".bn-drag-handle-menu" --item ".bn-menu-item" \
  --out .notion-lab/parity/myownnotion-block-menu
```

### 5. Comparer et corriger

```sh
bun run notion:parity:compare \
  --reference .notion-lab/parity/notion-block-menu/capture.json \
  --candidate .notion-lab/parity/myownnotion-block-menu/capture.json \
  --out .notion-lab/parity/notion-block-menu/comparison.md
```

Le rapport signale les items manquants/en trop, l’ordre et les écarts de styles
au repos et au survol. Corriger, recapturer, recommencer.

### 6. Prouver

Dans `specs/<feature>/validation.md` :

- captures de la référence et du résultat (clair, sombre, 320/390 px) ;
- fichier de comparaison (ou extrait sans données personnelles) ;
- tests exécutés ;
- limites réelles.

## Définition de terminé

- [ ] Tous les items de la référence sont présents ou explicitement hors périmètre.
- [ ] Ordre et sections alignés.
- [ ] Survol/focus/destructif vérifiés, pas seulement le repos.
- [ ] Clic normal **et** clic droit vérifiés.
- [ ] Échap et focus clavier vérifiés.
- [ ] Thème clair et sombre.
- [ ] 320 px et 390 px sans débordement.
- [ ] Capture de comparaison et tests joints.

## Pièges déjà rencontrés

- Ne capturer qu’un menu **fermé** : vérifier la capture d’écran et le nombre
  d’items avant d’implémenter.
- Un menu Notion peut utiliser `role=option`, pas `menuitem` : `--item` doit
  correspondre au DOM réel.
- Clic droit sur une poignée : le gérer explicitement (`preventDefault` +
  ouverture du menu) et vérifier qu’il n’ouvre pas le menu de texte en même temps.
- Un fond de survol opaque se voit différemment selon la surface : préférer le
  voile translucide commun.
- Ne pas afficher « rouge en permanence » : destructive = neutre puis rouge au
  survol/focus.
