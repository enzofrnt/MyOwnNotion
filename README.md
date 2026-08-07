> [!CAUTION]
> **Ce projet est produit en très grande partie par des intelligences artificielles.** Le code, les dépendances, les migrations, les mécanismes de sécurité, les sauvegardes et les procédures de restauration peuvent contenir des erreurs. Ne déployez pas ce projet avec des données importantes sans revue humaine, tests complets et sauvegardes indépendantes vérifiées. Utilisez-le avec prudence et à vos propres risques.

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

1. Vérifier l’état Git et signaler les changements non commités ou non poussés ; ne jamais les réinitialiser pour changer d’agent.
2. Terminer si possible l’étape Spec Kit en cours et enregistrer les fichiers modifiés sans régénérer les artefacts précédents.
3. Indiquer au nouvel agent le dossier de fonctionnalité, par exemple `specs/001-core-workspace/`.
4. Lui demander de relire `AGENTS.md`, la constitution et les artefacts existants de la fonctionnalité.
5. Continuer l’étape suivante sans créer de copie propre à l’agent.

Les conversations ne sont pas la mémoire du projet. Toute clarification ou décision durable doit être écrite dans la spec ou le plan partagé.

## Structure du produit

Les dossiers de code seront créés par les plans et tâches des premières fonctionnalités, lorsqu’une architecture aura réellement été décidée. Le dépôt ne conserve donc aucun squelette vide anticipant ces choix.

## Mettre à jour Spec Kit

Après une mise à jour du CLI `specify`, rafraîchir séparément les deux intégrations gérées :

```text
specify integration upgrade codex
specify integration upgrade cursor-agent
specify integration status
```

Relire le diff avant de conserver une mise à jour : les artefacts canoniques sous `.specify/memory/` et `specs/` ne doivent pas être remplacés. Ne pas modifier à la main les compétences générées dans `.agents/skills/` et `.cursor/skills/`.
