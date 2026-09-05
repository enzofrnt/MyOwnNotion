> [!CAUTION]
> **Ce projet est produit en très grande partie par des intelligences artificielles.** Le code, les dépendances, les migrations, les mécanismes de sécurité, les sauvegardes et les procédures de restauration peuvent contenir des erreurs. Ne déployez pas ce projet avec des données importantes sans revue humaine, tests complets et sauvegardes indépendantes vérifiées. Utilisez-le avec prudence et à vos propres risques.

# Knowledge Workspace

Projet d’application de gestion des connaissances combinant pages hiérarchiques, édition par blocs, liens bidirectionnels, graphe, tâches, bases structurées, canvas et intégrations.

Le dépôt est préparé avec GitHub Spec Kit pour OpenAI Codex et Cursor. Les deux agents utilisent exactement la même constitution et les mêmes fichiers de fonctionnalité : il n’existe aucune copie de spec propre à un agent.

## État du développement

Mise à jour du 3 septembre 2026.

**Prochain travail** : feature 014 — applications Electron Windows, macOS et
Linux ([`specs/014-desktop-clients`](specs/014-desktop-clients/)). La chaîne
Bun 1.4.0 est déjà livrée ; ne pas réintroduire pnpm. Les journaux 021 et la
convergence finale 017 suivent.

| Grande étape | Fait | Reste à faire (RAF) |
| --- | --- | --- |
| Fondations fonctionnelles — features 001 à 008 | Implémentées et fusionnées dans `main`. | Protocoles humains 002 après le desktop. |
| Chaîne d'outils Bun — feature 019 | Livrée et convergée : `packageManager bun@1.4.0`, `bun.lock`, CI, images. | Conserver l'exclusivité Bun. Les mentions de pnpm dans d'anciennes specs sont historiques. |
| Clients desktop — feature 014 | Spec, plan et tâches prêts ; Bun exclusif. | **Implémenter maintenant** (cinq installateurs : Windows x64/ARM, macOS ARM, Linux x64/ARM). |
| Convergence V1 — feature 017 | Éditeur, shell et arbre livrés dans `main`. | T319 après 014. |
| Fil d'Ariane, onglets, vue dossier — feature 022 | Composants et tests unitaires dans `main`. | Journey Playwright T040 après 014. |
| Journaux serveur — feature 021 | Spec initiale. | Planifier et implémenter **après** 014. |
| Graphe — feature 010 | Livré (`/graph`, `/graph/:itemId`). | Preuves croisées 008 T081. |
| URLs canoniques — feature 020 | Livrées et convergées, y compris le graphe. | Tenir le contrat à jour. |
| Bases structurées — feature 009 | Livrées dans `main`. | Vues avancées après la V1. |
| Sync temps réel — feature 018 | Livrée. | Conserver les régressions HAR dans la gate. |
| Tableaux blancs — feature 011 | Après la V1. | Spécifier plus tard. |
| Publication — feature 012 | Après la V1. | — |
| MCP — feature 013 | Après la V1. | — |
| iOS — feature 015 | Après la V1. | — |

Le détail, les dépendances et les limites de chaque étape sont dans la
[`roadmap produit`](docs/product/roadmap.md). L’avancement vérifiable d’une
feature reste dans son fichier `tasks.md`, pas dans ce résumé.

## Prérequis

- Git ;
- Bun `1.4.0` exactement ;
- Docker avec Compose pour PostgreSQL, les navigateurs isolés et les images ;
- Codex et/ou Cursor ;
- le CLI `specify` uniquement pour installer, mettre à jour ou diagnostiquer Spec Kit.

Le dépôt a été généré avec Spec Kit `v0.16.0`. Pour installer la même version avec `uv` :

```text
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.16.0
specify version
```

## Démarrage développeur

La chaîne JavaScript/TypeScript est entièrement pilotée par Bun :

```bash
bun --version
bun ci
docker compose up -d --wait postgres
bun run db:migrate
bun run dev
```

Pour le HTTPS local (passkeys, cookie `__Host-`), une stack de développement
séparée lance PostgreSQL, l’API et Vite, et Caddy. Le lancement reconstruit
les images. Elle reste ensuite détachée : Bun `--watch` et le HMR de Vite
rechargent le code dans les conteneurs.

```bash
bun run dev:stack
```

Ouvrir `http://localhost:8080` (navigateur intégré de Cursor) ou
`https://localhost:8443` (Safari/Chrome). Pour HTTPS, faire confiance à
l’autorité locale : `bun run dev:trust` — ajouter le certificat au trousseau
**session**, pas à « Racines du système ». Cursor n’utilise pas ce trousseau ;
rester en HTTP dans ce navigateur. Journaux : `bun run dev:stack:logs`.
Arrêt : `bun run dev:stack:down`. Pour vider Postgres, les fichiers et les
sauvegardes de cette stack : `bun run dev:stack:reset`.

Pour tester le Knowledge Graph avec une base locale riche et reproductible,
utiliser `bun run dev:stack:demo`, puis suivre la
[procédure de réinitialisation serveur et navigateur](docs/testing/knowledge-graph-demo.md).
Le mot de passe factice est `knowledge-graph-demo` ; cette commande détruit
uniquement les volumes de la stack locale `myownnotion-dev` et refuse toute
cible distante ou déjà remplie.

`bun --version` doit afficher exactement `1.4.0`. Avant de pousser une
modification de code, de dépendance, de build, de configuration ou de
déploiement, exécuter la porte complète :

```bash
bun run checks:local
```

Les commandes ciblées, l'exécution parallèle et le chemin Firefox conteneurisé
sur macOS sont documentés dans [`docs/development.md`](docs/development.md).

## Où se trouve la vérité du projet ?

| Contenu | Emplacement |
| --- | --- |
| Principes non négociables | `.specify/memory/constitution.md` |
| Besoin et critères d’acceptation | `specs/<fonctionnalité>/spec.md` |
| Architecture et choix techniques | `specs/<fonctionnalité>/plan.md` |
| Travail à réaliser et avancement | `specs/<fonctionnalité>/tasks.md` |
| Vision et ordre indicatif des fonctionnalités | `docs/product/roadmap.md` |
| Aide propre aux agents | `AGENTS.md`, `.cursor/rules/`, compétences générées |

## Workflow commun

```text
constitution → specify → clarify → plan → tasks → analyze → implement → converge
```

Une fonctionnalité passe dans ce flux une seule fois, même si Codex démarre le travail et Cursor le poursuit. Le second agent relit simplement les fichiers existants dans `specs/<fonctionnalité>/`.

### Avec Codex

Ouvrir le dépôt dans Codex, puis appeler les compétences du projet :

```text
$speckit-specify Décrire ici la fonctionnalité et sa valeur utilisateur
$speckit-clarify
$speckit-plan Décrire ici les contraintes et choix techniques
$speckit-tasks
$speckit-analyze
$speckit-implement
$speckit-converge
```

La constitution existe déjà. Utiliser `$speckit-constitution` uniquement pour la faire évoluer consciemment.

### Avec Cursor

Ouvrir le même dossier dans Cursor. La règle `.cursor/rules/spec-kit.mdc` est toujours active et les compétences Spec Kit se trouvent dans `.cursor/skills/` :

```text
/speckit-specify Décrire ici la fonctionnalité et sa valeur utilisateur
/speckit-clarify
/speckit-plan Décrire ici les contraintes et choix techniques
/speckit-tasks
/speckit-analyze
/speckit-implement
/speckit-converge
```

Selon la version de Cursor, une compétence peut aussi être sélectionnée depuis son interface plutôt que saisie comme commande.

## Passer d’un agent à l’autre

1. Vérifier l’état Git et signaler les changements non commités ou non poussés ; ne jamais les réinitialiser pour changer d’agent.
2. Terminer si possible l’étape Spec Kit en cours et enregistrer les fichiers modifiés sans régénérer les artefacts précédents.
3. Indiquer au nouvel agent le dossier de fonctionnalité, par exemple `specs/001-core-workspace/`.
4. Lui demander de relire `AGENTS.md`, la constitution et les artefacts existants de la fonctionnalité.
5. Continuer l’étape suivante sans créer de copie propre à l’agent.

Les conversations ne sont pas la mémoire du projet. Toute clarification ou décision durable doit être écrite dans la spec ou le plan partagé.

## Structure du produit

Le monorepo contient le client dans `apps/web`, l'API dans `apps/api`, les
modèles et services partagés sous `packages/`, les scénarios transversaux sous
`tests/` et les artefacts Spec Kit sous `specs/`. Les frontières détaillées et
leurs invariants sont documentés dans [`docs/architecture/`](docs/architecture/).

## Mettre à jour Spec Kit

Après une mise à jour du CLI `specify`, rafraîchir séparément les deux intégrations gérées :

```text
specify integration upgrade codex
specify integration upgrade cursor-agent
specify integration status
```

Relire le diff avant de conserver une mise à jour : les artefacts canoniques sous `.specify/memory/` et `specs/` ne doivent pas être remplacés. Ne pas modifier à la main les compétences générées dans `.agents/skills/` et `.cursor/skills/`.
