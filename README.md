# Knowledge Workspace

Projet d’application de gestion des connaissances combinant pages hiérarchiques, édition par blocs, liens bidirectionnels, graphe, tâches, bases structurées, canvas et intégrations.

Le dépôt est préparé avec GitHub Spec Kit pour OpenAI Codex et Cursor. Les deux agents utilisent exactement la même constitution et les mêmes fichiers de fonctionnalité : il n’existe aucune copie de spec propre à un agent.

## Prérequis

- Git ;
- Codex et/ou Cursor ;
- le CLI `specify` uniquement pour installer, mettre à jour ou diagnostiquer Spec Kit.

Le dépôt a été généré avec Spec Kit `v0.16.0`. Pour installer la même version avec `uv` :

```text
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.16.0
specify version
```

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

1. Terminer l’étape Spec Kit en cours et enregistrer les fichiers modifiés.
2. Indiquer au nouvel agent le dossier de fonctionnalité, par exemple `specs/001-core-workspace/`.
3. Lui demander de relire `AGENTS.md`, la constitution et les trois artefacts de la fonctionnalité.
4. Continuer l’étape suivante sans régénérer les documents déjà présents.

Les conversations ne sont pas la mémoire du projet. Toute clarification ou décision durable doit être écrite dans la spec ou le plan partagé.

## Structure initiale

```text
apps/
  api/                    API et services applicatifs
  web/                    interface web
packages/
  database/               modèles et persistance
  editor/                 éditeur par blocs
  graph/                  liens, backlinks et graphe
  mcp/                    intégration Model Context Protocol
specs/                    artefacts canoniques par fonctionnalité
docs/
  architecture/           décisions transversales
  product/                vision et roadmap
docker/                   environnement self-hosted
```

Ces répertoires posent les frontières du projet sans choisir prématurément un framework ou créer des implémentations vides.

## Mettre à jour Spec Kit

Après une mise à jour du CLI `specify`, rafraîchir séparément les deux intégrations gérées :

```text
specify integration upgrade codex
specify integration upgrade cursor-agent
specify integration status
```

Ne pas modifier à la main les compétences générées dans `.agents/skills/` et `.cursor/skills/`.
