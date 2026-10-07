> [!CAUTION]
> **Ce projet est produit en très grande partie par des intelligences artificielles.** Le code, les dépendances, les migrations, les mécanismes de sécurité, les sauvegardes et les procédures de restauration peuvent contenir des erreurs. Ne déployez pas ce projet avec des données importantes sans revue humaine, tests complets et sauvegardes indépendantes vérifiées. Utilisez-le avec prudence et à vos propres risques.

<p align="center">
  <img src="apps/web/assets/brand/myownnotion-logo.png" alt="Logo MyOwnNotion : un M en pages pliées" width="160" height="160" />
</p>

# MyOwnNotion

Un espace de connaissances personnel auto-hébergé : pages hiérarchiques, édition
par blocs, liens et graphe, tâches et bases de données. Une installation appartient
à un seul propriétaire, avec plusieurs appareils et des clients Web et desktop.

## Démarrer en développement

Prérequis : Git, **Bun 1.4.2** et Docker avec Compose.

```bash
bun ci
bun run dev:stack
```

Ouvrir [localhost:8080](http://localhost:8080). La stack lance PostgreSQL, l’API
et le client avec rechargement du code. HTTPS local, certificats, journaux,
arrêt et tests sont détaillés dans le [guide de développement](docs/development.md).

## Guides

- [Déploiement serveur et HTTPS](docs/deployment/reverse-proxy.md)
- [Clients desktop](docs/deployment/desktop.md)
- [Sauvegarde et restauration](docs/deployment/backups.md)
- [Import Notion](docs/notion-import.md) et [accès MCP](docs/mcp.md)
- [Vision du produit](docs/product/product-canvas.md) et [roadmap](docs/product/roadmap.md)
- [Architecture](docs/architecture/README.md) et [système UI](docs/design/ui-system.md)

## Contribuer

Lire [AGENTS.md](AGENTS.md), la [constitution](.specify/memory/constitution.md)
et les [artefacts de la fonctionnalité](specs/README.md) avant de modifier le projet.
Les spécifications, plans et tâches sont partagés entre Codex et Cursor.
Le [workflow Spec Kit](docs/development.md#workflow-spec-kit) et les contrôles
à choisir selon l’impact sont documentés dans le guide de développement.
