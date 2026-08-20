# Implementation Plan: Bases de données et tâches structurées

**Branch**: `codex/009-databases-structured-tasks` | **Date**: 2026-08-20 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from
`/specs/009-databases-structured-tasks/spec.md`

## Summary

Ajouter aux pages canoniques une capacité de base de données : la page hôte
conserve son identité, sa hiérarchie, son cycle de vie et son historique, puis
un schéma typé, des vues enregistrées et des pages membres viennent enrichir
cette identité. Une entrée reste une page ordinaire ; son appartenance à une
base est une relation structurelle distincte de son placement hiérarchique.

Les libellés, configurations et valeurs sont écrits dans les enveloppes
applicatives existantes. PostgreSQL ne conserve en clair que les identités et
métadonnées de routage nécessaires à l'intégrité. Le serveur ouvre ces
enveloppes dans une projection mémoire versionnée ; le navigateur utilise la
même logique de validation, filtre, tri et regroupement sur sa projection Dexie
chiffrée. Les deux chemins partagent donc un évaluateur déterministe sans créer
un index privé persistant ni contourner la synchronisation existante.

L'interface utilise TanStack Table 9.1.2 comme moteur headless de la table et
TanStack Virtual 3.14.10 pour limiter le DOM. Les cinq vues restent des
composants MyOwnNotion contrôlés par les configurations canoniques ; les
opérations sur de grands ensembles sont manuelles côté table et produites par
la projection structurée, jamais recalculées sur la seule page visible.

## Technical Context

**Language/Version**: TypeScript 5.9.3 ; Node.js 24 ; navigateurs définis par le
canevas produit

**Primary Dependencies**: Fastify 5, React 19.2, Drizzle 0.45, PostgreSQL 18,
Dexie 4.2, MiniSearch 7.2, TanStack Table 9.1.2, TanStack Virtual 3.14.10,
decimal.js-light 2.5.1, contrats TypeBox existants

**Storage**: PostgreSQL pour les identités canoniques et enveloppes protégées ;
IndexedDB/Dexie pour la projection locale protégée ; projection de requête
structurée uniquement en mémoire

**Testing**: Vitest et fast-check pour domaine, client, intégration, contrats,
conflits et performance ; Playwright pour les cinq vues, le responsive, le
clavier, l'offline et la synchronisation multi-navigateurs

**Target Platform**: serveur Linux auto-hébergé et client Web responsive,
Chrome/Edge/Firefox/Safari sur les deux dernières versions majeures

**Project Type**: application Web local-first avec API auto-hébergée

**Performance Goals**: 100 premières entrées d'une vue de 100 000 entrées
utilisables en moins de 1 seconde au p95 ; modification locale visible en moins
de 300 ms au p95 ; changement distant visible en moins de 2 secondes au p95

**Constraints**: mono-utilisateur ; contenu structuré chiffré au repos ; aucun
libellé ou valeur dans les URLs et journaux ; résultat local à couverture
explicite ; ordre identique entre clients ; clavier, lecteur d'écran, 320 px et
zoom 200 % ; aucune traduction partielle propre à 009, copies centralisées et
formats sensibles à la locale prêts à suivre la langue globale

**Scale/Scope**: 100 000 pages d'entrée, plusieurs centaines de propriétés et
vues par base, 100 000 relations, 10 appareils ; huit types de propriété et
cinq types de vue

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Les schémas, valeurs et vues présents localement restent lisibles et modifiables hors ligne ; export, sauvegarde et restauration transportent leur forme canonique | PASS |
| II. One Spec, Any Agent | Tous les choix, contrats et preuves de la feature restent sous `specs/009-databases-structured-tasks` | PASS |
| III. Incremental, Verifiable Delivery | Les fondations, schéma/entrées, table/liste, tâches, vues visuelles puis convergence forment des tranches testables et utiles | PASS |
| IV. Privacy and Security by Default | Libellés, options, configurations et valeurs utilisent les enveloppes serveur et locales ; la projection déchiffrée est transitoire et les requêtes privées restent dans des corps authentifiés | PASS |
| V. Simple, Modular Architecture | Une capacité ajoutée aux pages et un évaluateur commun réutilisent identité, révisions, outbox et recherche ; aucun service ni journal parallèle n'est ajouté | PASS |
| VI. Accessible and Predictable Experience | Les contrats imposent rôles, focus, clavier, annonces, alternatives au glisser-déposer, couverture et erreurs visibles pour les cinq vues | PASS |
| VII. Reproducible Toolchains | Les trois dépendances MIT sont ajoutées par pnpm, verrouillées et soumises aux contrôles de licences, builds et tests existants | PASS |
| VIII. Canonical Product Direction | Le plan concrétise les sections 10, 14, 17 à 22, 27 à 33 et 42 à 43 sans absorber graphe, whiteboards, public, MCP ou évolution complète de l'éditeur | PASS |

## Project Structure

### Documentation (this feature)

~~~text
specs/009-databases-structured-tasks/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── database-api.openapi.yaml
│   └── database-ui.md
├── checklists/
│   └── requirements.md
└── tasks.md
~~~

### Source Code (repository root)

~~~text
packages/domain/src/databases/
├── types.ts
├── values.ts
├── schema.ts
├── query.ts
├── merge.ts
└── commands.ts

packages/database/
├── migrations/0007_databases.sql
└── src/
    ├── mutations/database-commands.ts
    ├── repositories/database-repository.ts
    └── schema/index.ts

packages/client-core/src/
├── databases/
│   ├── local-database-repository.ts
│   └── local-database-query.ts
├── local-store/schema.ts
├── outbox/apply-local-mutation.ts
└── reconciliation/reconcile.ts

packages/contracts/src/content-api.ts

apps/api/src/
├── databases/database-query-service.ts
├── routes/databases.ts
├── routes/changes.ts
├── routes/snapshots.ts
├── search/search-service.ts
└── security/protected-content.ts

apps/web/src/features/databases/
├── database-page.tsx
├── database-toolbar.tsx
├── property-editor.tsx
├── filter-editor.tsx
├── table-view.tsx
├── list-view.tsx
├── board-view.tsx
├── gallery-view.tsx
├── calendar-view.tsx
├── entry-panel.tsx
└── use-database-view.ts

packages/domain/tests/databases/
packages/database/tests/database.integration.spec.ts
packages/client-core/tests/database-*.spec.ts
apps/api/tests/database-*.spec.ts
apps/web/tests/database-*.spec.tsx
tests/e2e/databases-*.spec.ts
tests/performance/databases.perf.spec.ts
~~~

**Structure Decision**: Les règles de type, conversion, filtre, tri, groupement
et fusion appartiennent au domaine commun. PostgreSQL et Dexie ne font que
persister et projeter les mêmes identités. L'API hydrate la projection complète
du serveur ; les composants Web consomment soit cette projection paginée, soit
la projection locale lorsque la couverture le permet. Les vues restent dans un
module Web unique et n'introduisent pas un package ou service autonome.

## Design

### Identité canonique et persistance

Une base est une page canonique portant une capacité `database`. Son `itemId`
est aussi son `databaseId` : renommer, déplacer, mettre à la corbeille et
restaurer passent par les mécanismes existants. Un enregistrement structurel
`databases` atteste cette capacité. Une entrée est une autre page canonique ;
`database_entries` relie son identité à une seule base sans déduire cette
appartenance de la hiérarchie.

Deux familles de payloads protégés sont ajoutées : `database.definition`
contient propriétés, options, vues et rôles de tâche ;
`database.entry-values` contient les valeurs non relationnelles d'une entrée.
Le titre reste la propriété canonique `item.name`. Une relation de propriété
réutilise `relationships` avec le type `database:property` et des métadonnées
protégées portant l'identité de propriété. Il n'existe donc aucune seconde
identité de page, relation ou tâche.

### Commandes, révisions et conflits

Les commandes structurées rejoignent l'union `MutationCommand`, son parseur et
le même batch idempotent que les autres écritures. Une modification de
définition produit une révision de la page hôte ; une modification de valeurs
produit une révision de la page d'entrée. Le snapshot de révision transporte
l'état structuré concerné sous l'enveloppe existante.

Toute mutation ordinaire qui touche une page hôte ou une page d'entrée
(renommage, document, déplacement de lifecycle ou restauration) capture aussi
son état structuré courant. Une conversion de l'une de ces pages en dossier est
refusée tant que la capacité ou l'appartenance existe, car elle violerait
l'invariant « base et entrée sont des pages ».

Une fusion à trois voies compare les objets par identités stables. Deux
propriétés, deux vues ou deux valeurs de propriétés distinctes peuvent fusionner
automatiquement. Deux changements incompatibles du même champ, une suppression
concurrente avec une édition, ou un changement de type incompatible créent un
conflit conservant ancêtre, local et distant. La résolution produit une nouvelle
révision à deux parents, comme les conflits documentaires.

### Projection de requête et pagination

Le serveur reconstruit atomiquement une `StructuredProjectionGeneration` depuis
les lignes et enveloppes protégées, puis maintient ses entrées après commit. Le
navigateur construit la même projection depuis Dexie après déverrouillage. Le
même évaluateur pur valide et applique les filtres, les tris, les groupes et les
axes de vue ; le départage final est toujours `entryId`.

Les configurations persistées sont l'unique source des opérations. TanStack
Table ne recalcule ni filtre ni tri sur une page partielle : il reçoit des
données déjà évaluées avec les modes `manual*`. Le curseur opaque lie
`databaseId`, `viewId`, révision de définition, génération et dernière clé
d'ordre. Une génération différente refuse le curseur et relance la vue, ce qui
évite doublons et omissions silencieux.

La projection mémoire garde des index de présence et d'égalité par propriété,
puis évalue les comparaisons de plage et le tri sur le sous-ensemble candidat.
Elle est dérivée, reconstructible et jamais sérialisée. Une reconstruction
échouée conserve l'ancienne génération sûre ou annonce `degraded` ; elle ne
publie jamais une vue partielle comme complète.

### Valeurs canoniques

Les nombres sont acceptés comme chaînes décimales, normalisés avec
decimal.js-light et jamais convertis par un aller-retour `Number`. Une date
civile est `YYYY-MM-DD`; un instant est un RFC 3339 UTC. L'affichage utilise
`Intl`, mais filtres et ordre travaillent sur les formes canoniques.

Les textes utilisent une clé de tri déterministe partagée : normalisation NFKD,
suppression des marques, casse Unicode puis valeur brute et identité. Les
sélections et relations persistent des UUID, jamais leur libellé. Une valeur
absente est distincte de `false`, de zéro et d'une chaîne vide.

### Local-first et synchronisation

Dexie reçoit des stores structurels indexés par `databaseId` et des payloads
scellés avec le codec local existant. La préparation cryptographique reste hors
transaction ; les lignes prêtes, la projection optimiste, la révision locale et
l'outbox sont écrites dans une transaction unique. Le snapshot et le flux de
changements incluent définitions, appartenances, valeurs et relations dans le
même curseur vérifié.

Une base marquée hors ligne épingle sa définition, ses vues, ses appartenances
et les valeurs de ses entrées. Sinon, la projection expose `complete` ou
`partial` avec décompte chargé/attendu. Un calcul local partiel reste utile mais
n'affiche jamais ses groupes, totaux ou absence de résultat comme exhaustifs.

Un changement destructif préparé hors ligne utilise un digest d'impact
déterministe calculé sur la révision de base, la définition candidate et les
identités/valeurs affectées. Le serveur recalcule ce digest à la reconnexion :
il accepte la décision uniquement s'il est identique, sinon il conserve la
mutation locale et demande un nouvel aperçu au lieu d'appliquer une confirmation
devenue obsolète.

### Interface et accessibilité

La 009 ajoute une frontière de copie unique pour ses libellés, erreurs et
annonces, utilisée aussi par ses points d'entrée dans la hiérarchie. Elle livre
le catalogue anglais correspondant à la langue actuelle de l'application et
ne persiste jamais une identité métier depuis un libellé. Le basculement vers
le français est volontairement transversal : le catalogue 009 changera avec
les autres surfaces pendant le gate de release porté par la 008, sans migration
des définitions, options, filtres, tris ou valeurs canoniques.

La table applique le modèle ARIA `grid` uniquement parce que ses cellules sont
éditables : un seul point d'entrée Tab, flèches entre cellules, Entrée/F2 pour
éditer et Échap pour revenir à la navigation. Les listes et galeries conservent
des structures natives. Le Kanban et le calendrier offrent toujours une action
clavier explicite équivalente au glisser-déposer.

TanStack Virtual limite les lignes ou cartes montées sans masquer la position,
le nombre total ni le focus à la technologie d'assistance. À 320 px, la table
défile dans son propre conteneur ; les actions, les vues et le panneau d'entrée
restent hors de ce défilement bidimensionnel.

### Recherche, sauvegarde et cycle de vie

La recherche 008 reçoit, après commit local ou serveur, les valeurs textuelles
actives et les libellés des rôles de tâche. Elle garde une seule identité par
page d'entrée et indique l'identité de propriété correspondante. Les index
restent transitoires.

Le snapshot canonique, l'export versionné, les sauvegardes de référence et leur
validation incluent les deux tables structurelles, les enveloppes, les
relations et les révisions. La corbeille d'une base crée dans une transaction
les révisions et états de la page hôte et de toutes ses entrées actives. La
restauration réactive ces mêmes identités. La purge reste un événement canonique
consommé, pas une nouvelle orchestration de cette feature.

## Phase 0 Output

[research.md](research.md) fixe le modèle page-capacité, la frontière de
chiffrement, la projection transitoire, les valeurs canoniques, la stratégie de
vue, la fusion et les intégrations transversales.

## Phase 1 Output

- [data-model.md](data-model.md) décrit les entités persistées, payloads
  protégés, projections, états et transitions.
- [contracts/database-api.openapi.yaml](contracts/database-api.openapi.yaml)
  définit les lectures et requêtes propriétaires ainsi que les formes de
  commandes structurées.
- [contracts/database-ui.md](contracts/database-ui.md) fixe les cinq vues, la
  couverture, le clavier, les annonces et le responsive.
- [quickstart.md](quickstart.md) décrit les preuves fonctionnelles, offline,
  conflits, sécurité, reprise et performance.

## Constitution Check — post-design

Le design conserve une seule identité par base, entrée et relation ; toutes les
écritures passent par les révisions, l'outbox et le flux existants. Les contenus
privés ne quittent les enveloppes que dans les projections mémoire déjà
autorisées, et ces projections sont reconstructibles. Les cinq vues partagent
des règles déterministes, exposent leur couverture et possèdent des parcours
clavier complets. Export, sauvegarde, migration, corbeille et restauration sont
inclus dans le modèle au lieu d'être laissés aux features suivantes. Les huit
gates constitutionnels restent PASS.

## Complexity Tracking

| Choix | Pourquoi nécessaire | Alternative plus simple rejetée |
| --- | --- | --- |
| Projection structurée transitoire serveur et locale | Le chiffrement applicatif interdit d'indexer les valeurs privées en clair dans PostgreSQL, tandis que les vues doivent filtrer et trier 100 000 entrées | Déchiffrer tout à chaque requête dépasse la cible et créer un index persistant ajouterait une nouvelle surface sensible |
| TanStack Table + Virtual | Une table éditable, contrôlée, accessible et volumineuse exige état de colonnes et réduction du DOM sans imposer de rendu propriétaire | Une table maison reconstruirait navigation et état ; une grille complète imposerait son modèle de données et son identité visuelle |
| decimal.js-light | Les nombres doivent garder une forme et un ordre identiques sans perte binaire entre Node et navigateurs | `Number` perd des chiffres à partir de certaines saisies et rend la valeur canonique dépendante d'un aller-retour flottant |
