# Import Notion en ligne de commande

L’import accepte une archive ZIP native Markdown/CSV de Notion ou un dossier
local, y compris un export converti pour Obsidian. Il crée un dossier « Import
Notion » contenant des pages, fichiers et bases ordinaires, modifiables et
synchronisés avec les clients. Il ne réalise aucune synchronisation avec Notion.

## Préparer la source et examiner le rapport

Dans Notion, exporter le contenu au format **Markdown & CSV**, avec les
sous-pages nécessaires. Un export partiel ne contient pas nécessairement tous
les fichiers ou pages référencés. Consulter les
[instructions d’export de Notion](https://www.notion.com/help/export-your-content).
Les liens externes et images distantes ne sont jamais téléchargés.

Lancer depuis le dépôt avec Bun 1.4.0 :

```bash
bun run import:notion --source /chemin/vers/export.zip
bun run import:notion --source /chemin/vers/dossier --json
```

Ces commandes lisent uniquement la source. Aucun paramètre de cible n’est
nécessaire et aucune connexion à une base de données n’est ouverte. `--dry-run`
impose ce comportement même si `--apply` est présent.

Le résumé donne un identifiant d’import stable et les totaux. `--json` produit
le rapport privé complet : chemins et empreintes de chaque fichier, identités
canoniques, hiérarchie des pages et fichiers, pages synthétisées, liens résolus
ou incertains, conversions de propriétés, membres de chaque source et affichages.
Ce rapport contient les titres et noms de fichiers de la source : le conserver
dans un emplacement privé si vous le redirigez vers un fichier.

Les observations bloquantes empêchent l’application. Les autres décrivent une
conversion limitée ou un lien à corriger après import. Un lien manquant ou
ambigu n’est jamais associé arbitrairement à une page homonyme.

## Appliquer à une installation explicitement choisie

L’administrateur exécute la commande sur un hôte qui accède à la base PostgreSQL,
au stockage de fichiers et à la clé externe de l’installation. L’installation
doit être initialisée, avec un propriétaire actif, toutes ses migrations
appliquées et les écritures autorisées. Une cible restaurée doit avoir terminé
son activation locale ; ce contrôle est répété pendant la reprise. Les outils PostgreSQL 18 `pg_dump` et
`pg_restore` doivent être disponibles dans `PATH`, comme pour les
[sauvegardes complètes](deployment/backups.md).

Configurer explicitement les quatre variables pour cette cible :

| Variable | Valeur |
| --- | --- |
| `DATABASE_URL` | Connexion à la base de l’installation choisie |
| `MYOWNNOTION_BLOB_ROOT` | Racine de son stockage de fichiers |
| `MYOWNNOTION_DEPLOYMENT_KEY_FILE` | Chemin de sa clé de déploiement |
| `MYOWNNOTION_BACKUP_ROOT` | Racine de ses sauvegardes ; les complètes utilisent le sous-dossier `full` |

La commande ne choisit aucune base de développement par défaut. Utiliser
l’identifiant affiché par l’aperçu, ou choisir explicitement un nouvel UUID :

```bash
bun run import:notion --source /chemin/vers/export.zip --id UUID_DE_L_APERCU --apply
```

Après compilation API, le même parcours est disponible avec :

```bash
bun apps/api/dist/imports/notion/cli.js --help
```

Chaque nouvel import prend une sauvegarde complète vérifiée **avant le premier
changement**, y compris sur une cible vide. Une sauvegarde indisponible ou
échouée empêche l’import. Le reçu de réussite contient l’identifiant de cette
sauvegarde et du dossier créé.

Les mutations utilisent les services canoniques et les protections habituelles.
Les pages, propriétés, pièces jointes, originaux et informations de reprise sont
chiffrés au repos. L’événement final d’audit identifie une commande de
l’administrateur d’hébergement ; aucun cookie propriétaire n’est requis.

## Reprendre ou examiner une interruption

Relancer exactement la même commande avec **le même UUID et les mêmes octets
source**. Chaque opération validée possède un point de reprise chiffré, écrit
dans sa transaction. La reprise conserve la première sauvegarde et ne recrée
pas les éléments déjà importés. Deux processus ne peuvent pas traiter
simultanément le même import.

Une importation déjà terminée indique « already complete » sans remplacer les
modifications ultérieures du propriétaire. Pendant une reprise, une page ou
définition de base modifiée depuis sa dernière opération importée provoque
`import.target-changed`. Une source différente provoque `import.source-changed`.
Ne supprimer ni les données partielles ni leurs points de reprise pour forcer
le passage : examiner le dossier créé et le rapport, puis choisir explicitement
une nouvelle importation si une seconde copie est souhaitée.

L’import est progressif ; une interruption peut laisser un dossier partiellement
rempli. La sauvegarde complète reste disponible indépendamment de cet état.
La restauration complète suit son parcours normal de vérification et
d’activation, avec les conséquences sur la confiance des appareils décrites
dans sa documentation. L’import ne déclenche aucune restauration automatique.

Les erreurs courantes sont des codes sans contenu de notes :

| Code | Action |
| --- | --- |
| `import.preview-blocked` | Examiner les observations bloquantes du rapport JSON |
| `import.target-configuration-required` | Configurer les quatre paramètres de la cible |
| `import.pending-migrations` | Mettre à niveau l’installation selon le parcours normal |
| `import.target-not-ready` | Rétablir l’état prêt et un propriétaire actif |
| `import.already-running` | Laisser terminer le processus qui utilise cet UUID |
| `import.source-changed` / `import.target-changed` | Examiner le changement avant de choisir une nouvelle importation |
| `import.unavailable` | Vérifier clé externe, stockage, connexion et outils de sauvegarde |

## Représentations conservées et limites

Markdown prend en charge titres, paragraphes, styles usuels, listes, cases à
cocher, citations, code, séparateurs, liens locaux et fichiers. Les liens wiki
sont interprétés dans le texte, sans modifier les exemples de code. Les ancres
internes ne sont pas reconstruites. HTML, tableaux Markdown et autres éléments
non représentables restent du texte inerte, avec une observation. Chaque fichier
Markdown, CSV et Bases original est également conservé dans « Sources importées »
avec ses sous-dossiers. Les pièces jointes restent des fichiers canoniques.

Le CSV natif utilise sa première colonne comme titre. Les lignes correspondent
aux sous-pages exportées lorsqu’elles sont identifiables sans ambiguïté ; sinon
une entrée vide identifiée comme synthétisée conserve les propriétés de la ligne.
Les personnes restent des valeurs ; l’import ne crée aucun compte utilisateur.
Les valeurs booléennes, numériques, dates simples et statuts sont typées quand
l’export les décrit sans ambiguïté ; les autres valeurs restent du texte. Les
listes de liens wiki deviennent des relations lorsque chaque cible est résolue.

Pour Obsidian, le filtre Bases reconnu est `note["base"] == link("Référence")`
(ou `note.base`), seul ou dans un `and` contenant cette seule expression. Il
associe les notes dont la propriété `base` correspond. Aucun code ni formule
n’est évalué. Plusieurs affichages de la **même référence de sélection** utilisent
une source réutilisable unique ; deux sélections distinctes ne sont pas fusionnées
parce qu’elles contiennent actuellement les mêmes pages. Chaque premier affichage
table conserve son nom et son ordre de propriétés. Les autres réglages et vues
exportés sont signalés et préservés dans l’original chiffré.

Un CSV ne fournit pas la configuration des vues Notion : une table est donc
explicitement nommée « Import — table par défaut ». L’import ne prétend pas
reconstruire des tableaux Kanban, calendriers, aperçus de galerie, automatisations,
permissions, historiques ou rôles de tâches absents de l’export. Les associations
de base impossibles à représenter et les dépendances cycliques empêchent
l’application.

| Limite | Maximum |
| --- | --- |
| Entrées source, fichiers et dossiers | 10 000 |
| Profondeur de chemin | 32 niveaux |
| Un fichier Markdown, CSV ou Bases | 8 Mio |
| Un autre fichier ou l’archive ZIP | 64 Mio |
| Contenu décompressé total | 256 Mio |
| Rapport de compression d’une entrée ZIP | 100:1 |

Les liens symboliques, chemins absolus ou traversants, collisions de noms après
normalisation, archives chiffrées ou corrompues et alias/tags YAML non sûrs sont
refusés. Les archives imbriquées restent des pièces jointes opaques. La source
n’est jamais modifiée et les archives ne sont pas extraites en clair sur disque.
