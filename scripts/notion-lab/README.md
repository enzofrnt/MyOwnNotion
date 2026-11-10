# Cabine de mesure Notion

Outils locaux pour observer Notion comme un utilisateur réel : interface, DOM,
styles calculés, animations, réseau, console, et code du client Electron.

Ils servent à **reproduire des comportements dans MyOwnNotion**, pas à copier
Notion. Aucun fichier Notion n'est versionné.

## Mise en place (une seule fois)

```sh
bun run notion:login
```

Une fenêtre Chromium s'ouvre. Connecte-toi normalement (passkey, e-mail, SSO),
ouvre l'espace et la page de base à étudier, puis appuie sur Entrée dans le
terminal. La session reste dans `.notion-lab/profile/`, ignoré par Git.

> Le profil contient un cookie de session vivant. Ne le copie jamais dans une
> sauvegarde, un ticket ou un dépôt. `NOTION_LAB_PROFILE` permet de le placer
> ailleurs, par exemple sur un volume chiffré.

## Capturer une page

```sh
bun run notion:capture -- --url "https://www.notion.so/..." --theme dark
bun run notion:capture -- --url "https://www.notion.so/..." \
  --selector "[role=grid]" --selector "table" --width 1440
```

Sortie dans `.notion-lab/captures/<page>-<date>/` :

| Fichier | Contenu |
| --- | --- |
| `viewport.png` | capture à la taille demandée |
| `full.png` | capture pleine page |
| `dom.html` | DOM rendu (post-hydratation) |
| `styles.json` | styles calculés + rectangle des sélecteurs demandés |
| `animations.json` | animations en cours : keyframes, durées, easing, cible |
| `network.json` | requêtes et réponses (URL, statut, type) |
| `console.json` | messages console et erreurs de page |
| `manifest.json` | URL, titre, statut, viewport, thème, date |

Options : `--headed` pour voir la fenêtre, `--wait <ms>` pour laisser la page se
stabiliser, `--viewport-only` pour éviter la capture longue.

## Lire le code du client desktop

Notion Desktop est une application Electron. L'archive `app.asar` contient le
shell et les ponts, pas l'éditeur (chargé depuis le web).

```sh
bun run notion:extract -- --list
bun run notion:extract -- --grep "keydown" --ext .js
bun run notion:extract -- --out .notion-lab/notion-asar
```

## Comment je m'en sers pour la parité

1. Capturer la vue Notion à reproduire (table, kanban, galerie, liste, calendrier)
   dans le thème et la largeur voulus.
2. Lire `styles.json` et `animations.json` pour les valeurs réelles (hauteurs,
   paddings, couleurs, durées) au lieu de deviner.
3. Comparer avec une capture de `/__ui-lab` ou de l'application, au même
   viewport et même thème.
4. Écrire l'écart dans la spec, implémenter, recapturer, comparer.
5. Recommencer écran par écran.

## Limites honnêtes

- Le code serveur de Notion n'est jamais accessible ; seule l'interface et le
  client sont observables.
- Les captures et le DOM restent locaux : ce sont des données propriétaires.
  On versionne les **mesures** et nos propres implémentations, pas les assets.
- Une session peut expirer ; relancer `bun run notion:login` dans ce cas.
