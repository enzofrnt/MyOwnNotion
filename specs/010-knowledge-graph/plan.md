# Implementation Plan: Graphe de connaissances privé

**Branch**: `codex/010-knowledge-graph-spec` | **Date**: 2026-08-31 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-knowledge-graph/spec.md`

## Summary

Livrer avant la V1 les backlinks, un voisinage local et une vue globale privée
à partir des liens réellement présents dans les contenus et des relations
métier déjà canoniques. Le graphe n'ajoute ni table métier, ni flux de
synchronisation, ni endpoint de recherche : il projette les éléments et
relations présents dans la projection Dexie chiffrée, elle-même reconstruite
par le snapshot et le journal ordonné. Les placements et pièces jointes restent
disponibles dans des couches structurelles explicites, désactivées par défaut.

Un nouveau package pur `@myownnotion/graph` porte normalisation, agrégation,
périmètres, parcours bornés, couches, filtres et disposition relationnelle
déterministe. Le client
lit d'abord la topologie structurelle non sensible, calcule au plus 200 nœuds
visibles, puis ouvre seulement les libellés nécessaires. Cette séparation
permet un premier résultat progressif sur le jeu de référence sans créer un
index privé persistant. L'interface React ajoute `/graph` et `/graph/:itemId`,
une vue SVG navigable au pointeur et au clavier et son équivalent complet en
liste.

La validation de release reçoit en plus un environnement de démonstration
strictement local et jetable. Une commande explicite remet à zéro la stack de
développement, génère par les parcours canoniques 240 éléments et 480 relations
avec un propriétaire/mot de passe publics de démonstration, puis vérifie les
invariants, le contenu lisible de 190 pages et la traçabilité de 360 liens
internes avant d'annoncer que le jeu est prêt. Une procédure distincte remet
à zéro l'état du site dans le navigateur afin qu'un ancien service worker,
cache, cookie ou IndexedDB ne fausse pas un test après redéploiement.

## Technical Context

**Language/Version**: TypeScript 5.9.3 sous Bun 1.4.0 ; React 19.2

**Primary Dependencies**: React, Dexie et contrats/domaines existants ; SVG
natif et solveur relationnel pur borné pour le rendu, sans moteur de graphe
externe

**Storage**: aucune nouvelle donnée canonique ; PostgreSQL et Dexie existants
pour les sources, préférences visuelles bornées à l'appareil dans `localStorage`

**Testing**: Vitest et fast-check pour projection, couches, agrégation,
déterminisme, cycles et convergence ; Testing Library pour les composants ;
Playwright pour les parcours local/global, pointeur, clavier, offline et
responsive ; contrat de seed et contrôle d'intégrité contenu/relation sur la
base locale de démonstration

**Target Platform**: serveur Linux auto-hébergé et client Web responsive sur
les deux dernières versions majeures de Chrome, Edge, Firefox et Safari

**Project Type**: application Web local-first avec API auto-hébergée

**Performance Goals**: voisinage de 500 nœuds projeté en moins d'une seconde au
p95 ; première vue ou résumé global du jeu 100 000/100 000 en moins de deux
secondes au p95 ; aucun lot de calcul UI supérieur à 100 ms

**Constraints**: mono-propriétaire ; offline ; sources et libellés chiffrés au
repos ; aucun filtre ou titre privé dans une URL ou un journal ; 200 nœuds et
400 relations rendus au maximum ; vue liste et parcours pointeur/clavier
obligatoires ; 320 px, zoom 200 % et réduction des animations

**Demo Safety**: génération désactivée hors environnement de développement,
origine publique et hôte de base locale attendus exactement, intention
destructive explicite, installation vide requise, aucun seed au démarrage

**Scale/Scope**: 100 000 éléments et 100 000 relations ; pages, dossiers,
bases, tâches et fichiers ; quatre périmètres, filtres combinables, profondeur
1 à 3, backlinks et relations sortantes

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | La projection locale suffit à lire le graphe hors ligne ; snapshot, restauration et export conservent déjà ses sources canoniques | PASS |
| II. One Spec, Any Agent | Besoin, plan, contrats, modèle et tâches restent sous `specs/010-knowledge-graph` | PASS |
| III. Incremental, Verifiable Delivery | Projection pure, lecture locale, backlinks, graphe local/global puis environnement de validation constituent des tranches testables | PASS |
| IV. Privacy and Security by Default | Aucun index dérivé persistant ; les libellés sont ouverts après sélection et les filtres restent sur l'appareil | PASS |
| V. Simple, Modular Architecture | Une frontière pure `packages/graph` réutilise projection, sync et relations existantes sans service ni base supplémentaire | PASS |
| VI. Practical and Predictable Experience | Vue liste équivalente, glisser/molette/survol/clic prévisibles, focus visible, boutons nommés, limites annoncées et état de complétude explicite | PASS |
| VII. Reproducible Toolchains | Aucun runtime ni bundler ajouté ; scripts et contrôles utilisent exclusivement Bun verrouillé | PASS |
| VIII. Canonical Product Direction | Le plan concrétise les sections 5, 10, 14, 17, 22, 27 à 33 et 42 sans absorber whiteboard, public ou MCP | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/010-knowledge-graph/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── graph-projection.md
│   └── graph-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/graph/
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts
│   ├── normalize.ts
│   ├── project.ts
│   ├── layout.ts
│   └── index.ts
└── tests/
    ├── projection.spec.ts
    └── projection.property.spec.ts

packages/client-core/src/local-store/
└── local-repository.ts

apps/web/src/
├── features/knowledge-graph/
│   ├── graph-copy.ts
│   ├── graph-controls.tsx
│   ├── graph-canvas.tsx
│   ├── graph-list.tsx
│   ├── graph-inspector.tsx
│   ├── knowledge-graph.worker.ts
│   ├── knowledge-graph-view.tsx
│   └── use-knowledge-graph.ts
├── features/hierarchy/hierarchy-explorer.tsx
├── features/navigation/sidebar.tsx
├── routing/paths.ts
└── styles.css

scripts/dev/
├── knowledge-graph-demo-fixture.ts
├── seed-knowledge-graph-demo.ts
└── stack.ts

docs/testing/
└── knowledge-graph-demo.md

tests/contract/
└── knowledge-graph-demo.spec.ts

tests/e2e/
└── knowledge-graph.spec.ts

tests/performance/
└── knowledge-graph.perf.spec.ts
```

**Structure Decision**: `packages/graph` reçoit uniquement des structures
déjà ouvertes ou non sensibles et retourne une projection déterministe sans
I/O. `client-core` garde la frontière Dexie et crypto. `apps/web` orchestre le
chargement progressif et porte exclusivement l'état de présentation. L'API,
PostgreSQL, le change feed et les sauvegardes restent inchangés parce qu'ils
transportent déjà toutes les sources nécessaires.

## Design

### Sources canoniques et types de nœud

Chaque `item` non purgé devient un candidat stable. Une page portant une
capacité `database` est présentée comme base ; une page membre d'une base dont
les rôles de tâche sont configurés est présentée comme tâche. Les autres pages,
dossiers et fichiers gardent leur type canonique. Une identité n'apparaît
jamais deux fois lorsqu'elle possède plusieurs rôles.

Les lignes `relationships` créent la couche `knowledge`, dont `page:link`
provient exclusivement des liens présents dans le document canonique. Les
placements `hierarchy` deviennent `hierarchy:contains` dans la couche
`hierarchy` ; les placements `attachment` deviennent `file:attachment` dans la
couche `attachment`. Ces deux couches sont dérivées, non éditables et
désactivées par défaut. Une relation inconnue mais syntaxiquement valide reste
visible sous un libellé générique ; une ligne invalide rejoint le diagnostic de
projection sans interrompre les autres relations.

### Projection, agrégation et complétude

Le calcul suit un ordre fixe : normaliser les sources, activer les couches,
choisir le périmètre, parcourir le voisinage, appliquer les filtres, agréger par
`sourceId/targetId/type`, calculer les compteurs, puis borner le rendu. Les
identités constituent le départage final, ce qui rend le résultat indépendant
de l'ordre de réception et stable entre appareils.

La topologie structurelle est lue en une transaction courte. La projection est
traitée par lots en rendant la main entre eux ; seuls les éléments visibles
sont ensuite déchiffrés pour obtenir titre, icône et format. Le résumé conserve
les comptes candidats exacts lorsque la limite de rendu est atteinte. L'état
est `complete` seulement quand un snapshot a été établi et que la synchro n'est
ni initiale, ni hors ligne avant ce premier snapshot ; sinon il est `partial`
avec une explication explicite.

### Périmètres et filtres

- `workspace` part de tous les éléments non purgés ;
- `branch` part d'un dossier ou d'une page et suit ses descendants de
  hiérarchie ;
- `neighborhood` part d'un élément et suit dans les deux sens uniquement les
  couches actives, donc les relations de connaissance avec les réglages par
  défaut, sur une profondeur 1 à 3 ;
- `selection` part d'un ensemble borné d'identités choisies.

Les couches `knowledge`, `hierarchy` et `attachment` se combinent explicitement,
avec `knowledge` seule par défaut. Les filtres de type d'élément, type de
relation, format de fichier, cycle de vie, profondeur et éléments isolés
s'appliquent ensuite localement. Les
dimensions structurées (propriété, statut, dates) sont exposées lorsque la
définition de base locale les rend évaluables ; une valeur déchargée produit
une couverture partielle plutôt qu'un résultat négatif implicite.

### Disposition et interaction

Le package calcule une disposition SVG relationnelle déterministe : positions
initiales stables, répulsion, attraction des arêtes et centrage sont résolus en
un nombre fixe d'itérations, sans animation permanente ni coordonnée persistée.
La taille visuelle d'un nœud dépend de façon bornée de ses références entrantes.
Le fond de carte se déplace au glisser, la molette zoome autour du pointeur, le
survol atténue les éléments hors voisinage, le clic sélectionne et une action
directe ouvre la page. Panoramique, zoom, recentrage, sélection et ouverture
sont des préférences ou actions locales. La vue liste expose exactement la même
projection, les directions et multiplicités, et devient la présentation par
défaut sous 480 px ou avec animations réduites.

La route `/graph` ouvre le workspace global et `/graph/:itemId` le voisinage
local. Les filtres ne sont jamais encodés dans l'URL. Un bouton de barre
latérale ouvre le global ; une action contextuelle près de la page ouvre le
local. L'inspecteur sépare explicitement « pointe vers » et « est référencé
par » et ouvre la page cible dans le parcours habituel.

### Résilience, reconstruction et confidentialité

La projection n'écrit aucune source. Un crash pendant son calcul laisse Dexie
et l'outbox intacts ; le prochain montage recalcule depuis le dernier curseur
durable. La réception du même changement ou le remplacement par snapshot
produit les mêmes agrégats sans doublon. Une erreur conserve la dernière
projection UI sûre, l'annonce comme potentiellement ancienne et propose de
recalculer.

Les préférences enregistrées contiennent seulement mode de vue, profondeur,
types techniques et booléens. Elles excluent titres, requêtes, sélections et
identités. Les erreurs et métriques ne journalisent que comptes, durée, état de
couverture et codes stables.

### Workspace de démonstration et redéploiement propre

Le seed reste une capacité de développement, jamais un comportement de
l'application. L'orchestrateur local effectue d'abord le reset déjà propriétaire
des volumes PostgreSQL, fichiers et sauvegardes, redémarre la stack, puis lance
le générateur dans le conteneur API. Le générateur refuse de continuer sauf si
`NODE_ENV=development`, l'origine vaut exactement l'origine HTTPS locale, la
base visée appartient au réseau de développement, l'installation est vide et
un marqueur d'intention explicite est présent. Aucun flag analogue n'existe
dans les images ou commandes de production.

Le propriétaire et le mot de passe factices sont insérés seulement après ces
gardes, puis le contenu est soumis par les mêmes routes de mutation et les
mêmes contrôles de chiffrement que l'interface. Le corpus déterministe contient
huit branches, 190 pages lisibles organisées autour de 23 concepts transversaux,
une base de tâches avec statut/priorité/date, un fichier attaché et huit
éléments réellement isolés. Cent quatre-vingts pages contiennent chacune deux
liens internes visibles, soit 360 relations documentaires ; 120 relations
métier explicables complètent le jeu avec doublons, cycles, réciprocité, liens
inter-branches et un type futur valide. Un élément relié est placé dans la
corbeille. Les
comptes attendus sont constants même si les UUID sont régénérés.

La génération se termine par des requêtes de preuve : un propriétaire et un
mot de passe actifs, 240 éléments, 480 relations canoniques, aucune extrémité
orpheline, une base et quarante tâches, la pièce jointe, les isolés, la
multiplicité, les relations réciproques/inter-branches, le type inconnu,
l'état corbeille, 180 documents sources et la correspondance exacte entre
leurs 360 arêtes et les liens de leurs blocs. Une interruption laisse donc
éventuellement une base locale
partielle, mais jamais un message « prêt » ; la reprise documentée recommence
par le reset complet.

Le reset navigateur reste volontairement séparé du reset serveur : la
procédure supprime les données du site pour `https://localhost:8443`, ce qui
couvre cookies HttpOnly, IndexedDB, localStorage, caches, service worker et
installation PWA, puis exige une nouvelle navigation et une connexion par le
mot de passe factice. Cette séparation empêche une commande serveur de prétendre
avoir effacé un état qu'elle ne peut pas contrôler dans le profil du navigateur.

## Phase 0 Output

[research.md](research.md) fixe la projection locale comme source, la frontière
pure, les couches relationnelles, le contrat comportemental observé dans les
sources publiques d'Obsidian, le rendu SVG relationnel, la stratégie de volume,
le corpus éditorial et le contrat de complétude.

## Phase 1 Output

- [data-model.md](data-model.md) décrit les sources, nœuds, relations,
  agrégats, requêtes, résultats et invariants.
- [contracts/graph-projection.md](contracts/graph-projection.md) fixe le contrat
  pur partagé par les tests et l'interface.
- [contracts/graph-ui.md](contracts/graph-ui.md) fixe routes, états, actions et
  comportement responsive/pointeur/clavier.
- [quickstart.md](quickstart.md) décrit les preuves locales et manuelles.

## Complexity Tracking

Aucune violation constitutionnelle ne requiert de dérogation.
