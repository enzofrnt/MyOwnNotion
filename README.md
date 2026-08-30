> [!CAUTION]
> **Ce projet est produit en très grande partie par des intelligences artificielles.** Le code, les dépendances, les migrations, les mécanismes de sécurité, les sauvegardes et les procédures de restauration peuvent contenir des erreurs. Ne déployez pas ce projet avec des données importantes sans revue humaine, tests complets et sauvegardes indépendantes vérifiées. Utilisez-le avec prudence et à vos propres risques.

# Knowledge Workspace

Projet d’application de gestion des connaissances combinant pages hiérarchiques, édition par blocs, liens bidirectionnels, graphe, tâches, bases structurées, canvas et intégrations.

Le dépôt est préparé avec GitHub Spec Kit pour OpenAI Codex et Cursor. Les deux agents utilisent exactement la même constitution et les mêmes fichiers de fonctionnalité : il n’existe aucune copie de spec propre à un agent.

## État du développement

Mise à jour du 27 août 2026 :

| Grande étape | Fait | Reste à faire (RAF) |
| --- | --- | --- |
| Fondations fonctionnelles — features 001 à 008 | Implémentées et fusionnées dans `main` : sécurité mono-utilisateur, pages et dossiers, éditeur par blocs, fichiers, offline, synchronisation, sauvegarde/restauration et recherche. | Exécuter les trois protocoles humains/opérationnels encore ouverts dans la feature 002 et terminer la convergence d'interface 017 avant de déclarer la release V1 formellement validée. |
| Convergence V1 proche de Notion — feature 017 | Éditeur BlockNote/Loro, page focalisée, blocs riches, fichiers offline, liens unifiés et arborescence interactive ont été livrés par étapes et fusionnés dans `main`. | Continuer la finition Notion-like : interactions d'édition avancées et cohérence visuelle des surfaces restantes, avec accessibilité limitée aux usages clavier/toucher/WebKit requis par le propriétaire. |
| Synchronisation temps réel durable — feature 018 | Canal WebSocket same-origin avec ACK après commit, reprise hors ligne/crash, convergence des pages fermées, auto-réparation des anciens conflits, révocation immédiate, fichiers vérifiés, identité distincte par profil et passkey complète sont implémentés et fusionnés. | Continuer d'exercer les données réelles et conserver les régressions HAR, multi-appareils, révocation et restauration dans la gate. |
| Chaîne d'outils Bun — feature 019 | Migration dédiée vers Bun 1.4.0 en cours : gestion des paquets, runtime, builds Web/API, tests, CI et images convergent vers une seule chaîne. | Terminer la gate locale complète, obtenir une CI distante verte et fusionner sans conserver pnpm, Node.js ou un WebSocket npm de secours. |
| Bases structurées et tâches — feature 009 | Implémentation terminée, convergée et validée par le gate local complet ; [pull request #125](https://github.com/enzofrnt/MyOwnNotion/pull/125) ouverte. | Obtenir un gate CI distant vert, faire relire puis fusionner la pull request dans `main`. |
| Graphe de connaissances — feature 010 | Direction et dépendances définies dans la roadmap. | Spécifier, planifier et implémenter la navigation par graphe après la 009 et la convergence V1 017. |
| Tableaux blancs — feature 011 | Périmètre produit ordonné après le graphe. | Spécifier, planifier et implémenter les canvas sans dupliquer les données canoniques. |
| Publication contrôlée — feature 012 | Frontière mono-utilisateur/public déjà posée par le canevas produit. | Concevoir puis livrer le partage public avec permissions et révocation explicites. |
| Intégrations et MCP — feature 013 | Positionnée après les surfaces publiques afin de réutiliser leurs contrôles d’accès. | Spécifier puis livrer les intégrations et l’exposition MCP sécurisée. |
| Clients supplémentaires — features 014 et 015 | Le client desktop est spécifié et planifié ; l’expérience iOS est positionnée dans la roadmap. | Implémenter le desktop après les fonctions 010 à 013, puis spécifier et développer l’expérience iOS. |

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
séparée lance PostgreSQL, l’API et Vite, et Caddy. Elle reste détachée :
Bun `--watch` et le HMR de Vite rechargent le code dans les conteneurs.

```bash
bun run dev:stack
```

Ouvrir `https://localhost:8443`. Au premier passage, faire confiance à
l’autorité locale : `bun run dev:trust`. Journaux : `bun run dev:stack:logs`.
Arrêt : `bun run dev:stack:down`. Pour vider Postgres, les fichiers et les
sauvegardes de cette stack : `bun run dev:stack:reset`.

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
