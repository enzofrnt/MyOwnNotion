# Search UI Contract

## Entry Points

- Une action Recherche est visible dans la barre latérale.
- Un raccourci documenté ouvre la même surface depuis tout écran propriétaire.
- La surface prend le focus dans le champ sans perdre la page courante tant
  qu'aucun résultat n'est ouvert.

## Query Lifecycle

1. Une saisie vide affiche l'état empty-query et n'appelle pas le serveur.
2. Dès qu'un caractère visible existe, le worker local répond.
3. Si le serveur est joignable, une requête complète part dans un corps HTTP.
4. La liste locale reste visible pendant server-loading.
5. La réponse serveur est fusionnée par identité, puis la couverture devient
   complete.
6. Hors ligne, rebuilding ou degraded, la couverture et l'action possible sont
   annoncées sans effacer la requête.

La requête n'est placée ni dans l'URL, ni dans l'historique du navigateur, ni
dans un stockage persistant implicite.

## Result Presentation

Chaque résultat montre :

- titre ;
- type ;
- chemin courant ;
- extrait textuel lorsque le corps correspond ;
- disponibilité locale lorsque connue ;
- conflit lorsque présent.

Le texte correspondant peut être visuellement mis en évidence, mais le titre
et l'extrait sont toujours rendus comme texte et jamais comme HTML interprété.
La couleur n'est jamais le seul signal.

## Filters

- Types : pages, dossiers, fichiers ; sélections combinables.
- Branche : racine choisie et descendants actifs.
- Tout filtre actif reste visible, modifiable et réinitialisable.
- La modification d'un filtre remet la pagination au début sans effacer la
  requête.

## Keyboard and Focus

- Tab atteint le champ, les filtres, la liste et la fermeture dans un ordre
  cohérent.
- Flèche bas entre dans la liste ; haut/bas déplacent la sélection.
- Entrée ouvre le résultat sélectionné.
- Échap ferme la surface et rend le focus à son déclencheur.
- Charger une page supplémentaire ne déplace pas la sélection existante.
- Le résultat sélectionné, le nombre de résultats et les changements de
  couverture sont annoncés aux technologies d'assistance sans annoncer chaque
  frappe deux fois.

## Responsive Contract

À 320 pixels et à 200 % de zoom :

- champ, filtres actifs, titre, type et action d'ouverture restent utilisables ;
- le chemin et l'extrait peuvent se tronquer visuellement sans perdre leur nom
  accessible ;
- aucun défilement horizontal de la page n'est requis ;
- la surface utilise la hauteur disponible et garde la fermeture accessible.

## Failure and Coverage States

| État | Message attendu | Résultats affichables |
| --- | --- | --- |
| local-only | Recherche limitée aux données de cet appareil | Oui, locaux |
| server-loading | Recherche complète en cours | Oui, locaux |
| rebuilding | Index en reconstruction | Oui, locaux ; aucun serveur partiel |
| degraded | Recherche complète temporairement indisponible | Oui, locaux fiables |
| offline | Serveur inaccessible | Oui, locaux |
| no-results | Aucun résultat dans la couverture annoncée | Aucun |
| cursor-stale | Le contenu a changé, résultats actualisés | Repartir de la première page |

## Local/Server Merge

- itemId est l'unique clé.
- Une révision locale pending ou conflict garde sa présentation.
- Un item local trashed disparaît même si le serveur renvoie encore l'ancienne
  révision.
- Une même identité n'apparaît jamais deux fois.
- Une reconnexion enrichit la liste sans la vider entre deux états.
