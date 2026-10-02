# Revoir la passe d’uniformité

## Instance courante

```bash
docker compose -p myownnotion-ui-dev -f compose.dev.yaml -f work/ui-uniformity/compose.local.yaml up -d --wait
```

Stack de ce checkout, API watch et Vite HMR. Ancienne stack arrêtée, volumes
conservés. Nouveau workspace synthétique, mot de passe public de démo
`knowledge-graph-demo`. Ouvrir http://localhost:8080/notes et choisir
« Utiliser le mot de passe ». HTTPS https://localhost:8443 est aussi disponible
dans un navigateur qui fait confiance à la CA locale ; laboratoire sans session
via http://localhost:8080/__ui-lab. Le fichier local de partage de CA est ignoré.
Le mot de passe ouvre la démo existante : il n’est pas nécessaire de refaire
la première configuration. Ne pas relancer le seed : les modifications du
propriétaire sont désormais dans ce workspace.

Si le fichier local de partage de CA manque, son contenu est :

```yaml
volumes:
  caddy-data:
    external: true
    name: myownnotion-dev_caddy-data
  caddy-config:
    external: true
    name: myownnotion-dev_caddy-config
```

Cette variante réutilise les volumes de CA conservés sur cette machine. Sur
une autre machine, démarrer sans cet override et établir sa propre confiance
TLS locale. `bun run dev:stack` cible le projet Compose historique ; ne pas
le lancer en parallèle sur les mêmes ports.

## Scénarios

- Parcourir navigation, page/dossier, base et vues, rechercher, ouvrir graphe
  et fichier, puis les rubriques de réglages. Examiner clair/sombre, 1280/320.
- Examiner formes contrôles/surfaces, alignements, aide, séparation, texte long.
- Clavier : Tab, Entrée/Espace, Escape et retour du focus sur overlays touchés.
- Attente/vide/erreur : utiliser compositions mémoire si l’état serait sensible.
- Connexion et installation : liens du laboratoire ; Kanban directement via
  http://localhost:8080/__ui-lab?view=board.
- Voir [verification.md](verification.md) pour preuves, limites et commandes
  ciblées effectivement exécutées. Aucun E2E ni gate de publication annoncé.
