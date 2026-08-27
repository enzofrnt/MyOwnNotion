# Implementation Plan: Chaîne d'outils unifiée sous Bun 1.4

**Branch**: `codex/019-bun-1-4-toolchain` | **Date**: 2026-08-27 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-bun-toolchain/spec.md`

## Summary

Remplacer en une seule migration pré-V1 le gestionnaire pnpm, le runtime
Node.js des applications et scripts, ainsi que les compilations de production
esbuild/Vite par Bun 1.4.0 exactement épinglé. Le code métier, les API, les
données, le protocole de synchronisation et l'interface restent inchangés. Le
transport WebSocket Fastify reçoit seulement l'adaptation de cycle de vie
requise par le module `ws` intégré à Bun 1.4.0.

Le dépôt devient un workspace Bun avec `bun.lock`, une installation CI par
`bun ci`, des scripts TypeScript exécutés directement, une API compilée par
`Bun.build()` pour la cible Bun et un client Web compilé depuis son entrée HTML
par le bundler Bun. Le build Web compile explicitement le worker de recherche,
Tailwind, le manifeste, Loro Wasm et le service worker Workbox afin de conserver
le démarrage hors ligne.

Vitest, TypeScript, Biome, Playwright, Vite en développement et Workbox restent
des outils spécialisés, mais ils sont tous installés, lancés et orchestrés par
Bun. Vite ne produit plus aucun artefact de production ; il reste seulement le
serveur de développement éprouvé pour le rechargement React et le proxy HTTP /
WebSocket same-origin. La couverture passe du fournisseur V8 au fournisseur
Istanbul, adapté à JavaScriptCore. Les trois contrats WebSocket qui dépendaient
du faux socket interne Node de Fastify utilisent une vraie écoute éphémère. Le
serveur accepte l'upgrade natif avant la résolution de session asynchrone,
capture les premières trames dans une file strictement bornée, puis les rejoue
uniquement après authentification par le résolveur existant.

Les images de construction et d'exécution API utilisent l'image officielle Bun
1.4.0 multiarchitecture épinglée ; l'image Web conserve nginx comme runtime
statique. La CI emploie l'action officielle `setup-bun` épinglée par SHA, le
cache Bun et le verrouillage strict, sans préparer Node.js ni pnpm.

## Technical Context

**Language/Version**: Bun 1.4.0 exactement ; TypeScript 5.9.3 ; JavaScriptCore ;
sources applicatives TypeScript/TSX

**Primary Dependencies**: React 19.2, Fastify 5.7.4,
`@fastify/websocket` 11.3, PostgreSQL 18, Drizzle 0.45, Loro 1.14.1,
BlockNote 0.54, Dexie 4.2 ; `bun-plugin-tailwind` 0.1.2 et Workbox 7.4 pour le
build Web ; Vite 7.3 seulement pour le développement ; Vitest 3.2 avec
`@vitest/coverage-istanbul` ; Playwright 1.58+

**Storage**: aucune modification des données utilisateur ; `bun.lock` devient
l'unique verrouillage du graphe workspace ; `dist/` contient des artefacts
éphémères Bun ; PostgreSQL, IndexedDB, fichiers et sauvegardes restent inchangés

**Testing**: Vitest exécuté sous Bun pour unités, propriétés, intégration,
contrats, sécurité, couverture Istanbul et performances ; Playwright sous Bun
sur cinq profils ; vrais sockets éphémères pour les contrats Fastify ;
installations verrouillées, build/PWA hors ligne, images multiarchitecture,
Compose, audits, licences et fumées runtime

**Target Platform**: développement macOS et Linux ; serveur Linux
`linux/amd64` et `linux/arm64` ; navigateur Web/PWA ; images Docker
multiarchitecture ; aucun exécutable Node.js requis sur l'hôte ou dans l'image
API

**Project Type**: monorepo Web local-first, API Fastify, client React et
packages TypeScript partagés

**Performance Goals**: ne régresser aucun budget produit ; installation et
build déterministes ; garder deux piles Playwright au maximum sur un hôte
contraint et le worker unique défini par la machine de référence pour les
fixtures de performance lourdes ; conserver le plan d'impact CI et les caches
par plateforme ; ne pas augmenter la latence ou les tailles protocolaires de
l'application

**Constraints**: migration à sens unique et PR dédiée ; version patch exacte ;
un seul lockfile ; aucune migration de données, aucun changement d'API, de
protocole ou d'UI ; outils tiers autorisés seulement sous Bun ; build Web
complet avec CSS, imports dynamiques, worker, Wasm, PWA et variables publiques ;
module WebSocket intégré à Bun sans fallback npm ; images non privilégiées et
sans secrets ; portes indisponibles toujours bloquantes

**Scale/Scope**: 9 workspaces, 3 entrées API, 1 entrée HTML, 1 worker de
recherche, 1 service worker, environ 800 dépendances installées et l'inventaire
CI existant de 18 jobs bloquants

## Constitution Check

*GATE: Passed before research and re-checked after Phase 1 design.*

| Principe | Décision | Gate |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Aucun format utilisateur ne change ; le build Bun précache aussi le worker et le Wasm nécessaires au shell hors ligne | PASS |
| II. One Spec, Any Agent | Intention, recherche, contrats, plan et tâches résident uniquement dans `specs/019-bun-toolchain` et tracent les sections 38–47 du canevas | PASS |
| III. Incremental, Verifiable Delivery | La PR reste dédiée ; verrouillage, scripts, builds, tests, images et docs possèdent des preuves ciblées avant la porte complète | PASS |
| IV. Privacy and Security by Default | Aucun secret n'entre dans le lockfile ou les builds ; audits, licences, scans, utilisateur non privilégié et images épinglées restent bloquants | PASS |
| V. Simple, Modular Architecture | Le code métier est conservé ; deux petits scripts de build Bun remplacent les compilateurs de production et Vite reste uniquement là où son proxy/HMR est utile | PASS |
| VI. Practical and Predictable Experience | Aucun parcours visible ne change ; les tests clavier et navigateurs existants restent requis | PASS |
| VII. Reproducible Toolchains and Enforced Quality | Bun 1.4.0, `bun.lock`, `bun ci`, builds Bun, runtime Bun, CI et images satisfont le nouveau contrat exclusif | PASS |
| VIII. Canonical Product Direction | La feature réalise les fondations de livraison des sections 38–46 et phase 0 sans empiéter sur les features produit suivantes | PASS |

### Post-design re-check

- Le serveur de développement Vite est un outil tiers exécuté par Bun. Il ne
  produit aucun artefact livré et ne constitue ni runtime applicatif ni second
  gestionnaire de paquets.
- Vitest reste le moteur de tests existant afin de conserver les projets,
  environnements et rapports. Le passage à Istanbul corrige seulement
  l'incompatibilité du fournisseur de couverture V8 avec JavaScriptCore.
- Le vrai socket de test remplace le helper synthétique de
  `@fastify/websocket`, qui construit volontairement un objet `ws` avec une URL
  nulle. Il a aussi révélé la régression Bun 1.4.0 qui invalide un
  `handleUpgrade()` après une macrotâche. L'upgrade est donc synchrone, puis le
  même résolveur de session s'exécute immédiatement sur la connexion ouverte.
- Aucun contenu n'atteint la session de synchronisation avant cette résolution :
  une file FIFO bornée par les limites protocolaires conserve au plus les
  premières trames, ferme en `1009` en cas de dépassement et n'est rejouée
  qu'après authentification. Les refus origine/cookie restent HTTP ; une
  session absente ou révoquée ferme en `4401`.
- Le build Web ne cache aucune réponse API. Il précache uniquement ses propres
  artefacts versionnés, y compris le worker de recherche et Loro Wasm.
- Le bundle API ne modifie aucune entrée : serveur, migration et administration
  restent trois commandes distinctes. Les migrations SQL restent externes,
  lisibles et copiées dans l'image.
- L'image officielle Bun 1.4.0 ne fournit pas de runtime Node.js autonome. Son
  alias de compatibilité `node` pointe vers Bun lui-même ; la fumée d'image
  vérifie cette identité plutôt que de déduire le runtime depuis le nom de la
  commande.
- Aucun ancien chemin pnpm/Node n'atteint `main`. L'état transitoire de la
  branche n'est pas une compatibilité maintenue.

## Project Structure

### Documentation (this feature)

```text
specs/019-bun-toolchain/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── production-artifacts.md
│   ├── quality-gate.md
│   └── toolchain.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json
bun.lock
bunfig.toml

apps/api/
├── build.ts
├── package.json
├── src/
└── tests/
    └── helpers/real-websocket.ts

apps/web/
├── build.ts
├── index.html
├── manifest.webmanifest
├── package.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── service-worker.ts
    ├── features/search/search.worker.ts
    └── services/search.ts

scripts/
├── ci/
│   ├── check-toolchain.ts
│   ├── license-policy.ts
│   ├── run-affected-vitest.ts
│   ├── smoke-api-image.sh
│   └── test-impact.ts
├── db/
├── e2e/
└── test-e2e-*.sh

.github/
├── actions/setup-bun/action.yml
└── workflows/
    ├── ci.yml
    └── release.yml

docker/
├── api.Dockerfile
├── web.Dockerfile
└── base-images.json

tests/contract/
docs/development.md
README.md
```

**Structure Decision**: Les deux scripts de build vivent près de leur
application parce qu'ils connaissent ses entrées et artefacts, tandis que les
contrôles transversaux restent sous `scripts/ci`. Une action composite locale
centralise l'installation Bun identique de chaque job CI. Aucune nouvelle
frontière métier, aucun package partagé et aucun service ne sont créés.

## Architecture and Delivery

### 1. Contrat de version, workspace et verrouillage

Déclarer `packageManager: bun@1.4.0`, `engines.bun: 1.4.0` et les globs de
workspace dans le manifeste racine. `bunfig.toml` force les exécutables de
paquets à utiliser Bun même lorsque leur shebang nomme Node. Le contrôle
d'outillage compare la version runtime exacte, exige `bun.lock`, refuse les
lockfiles et métadonnées des gestionnaires retirés, et conserve les règles
TypeScript/uv/gates existantes.

Produire une seule fois `bun.lock` à partir du verrouillage pnpm existant, puis
le réconcilier avec les dépendances strictement nécessaires à la migration.
Comparer les versions directes et examiner toute différence au lieu d'accepter
une montée implicite. Après preuve, retirer `pnpm-lock.yaml`,
`pnpm-workspace.yaml` et `.npmrc` lorsqu'elle ne contient qu'une politique pnpm.

L'installation reproductible canonique devient `bun ci`, alias documenté de
`bun install --frozen-lockfile`. Une seconde installation ne doit modifier
aucun octet de `bun.lock`.

### 2. Runtime de développement et scripts

Exécuter chaque script TypeScript directement par Bun et remplacer les appels
internes `node`, `tsx`, `pnpm exec` et `pnpm --filter` par leurs formes Bun.
Les imports `node:*` compatibles restent autorisés : ce sont des API de
compatibilité fournies par Bun, pas un processus Node.js.

L'API utilise `bun --watch src/server.ts`. Le Web conserve Vite pour le HMR
React et le proxy same-origin `/v1` + `/health`, lancé par Bun avec l'alias de
runtime forcé. Un prototype Bun 1.4.0 a validé l'upgrade WebSocket à travers ce
proxy ; aucune passerelle de développement spécifique n'est nécessaire.

Les scripts workspace indépendants (`typecheck`, `build`, `dev`) emploient le
filtrage et le parallélisme Bun. Les familles de tests ciblées peuvent toujours
être lancées en parallèle selon `docs/development.md`, tandis que la porte
complète conserve ses bornes PostgreSQL/Playwright pour ne pas saturer l'hôte.

### 3. Compilation API sous Bun

`apps/api/build.ts` appelle `Bun.build()` avec les trois entrées
`server.ts`, `migrate.ts` et `admin/admin-cli.ts`, `target: "bun"`, ESM,
source maps et bundling des dépendances runtime. Les noms de sortie restent
stables (`server.js`, `migrate.js`, `admin/admin-cli.js`). Le script efface
uniquement son propre `dist/`, vérifie chaque sortie attendue et échoue sur tout
diagnostic du bundler.

L'export Node de Loro lit son Wasm à côté de `node_modules` et n'est donc pas
relogeable dans l'image minimale. Une résolution limitée au build API remplace
uniquement `loro-crdt` par son export `loro-crdt/bundler` : Bun émet alors le
Wasm dans `dist/assets`, et le build refuse tout bundle qui conserverait le
chemin de la machine de compilation.

Le bundle est volontairement JavaScript, pas un exécutable natif : l'image
garde le runtime Bun exact visible, les trois entrées restent inspectables et
la même sortie fonctionne sur les architectures supportées. Les migrations SQL
restent copiées à `/app/migrations` et résolues comme aujourd'hui.

### 4. Compilation Web, worker et PWA

`apps/web/build.ts` réalise quatre étapes déterministes :

1. compiler le worker de recherche comme entrée navigateur ESM nommée et
   hachée ;
2. compiler `index.html` avec `Bun.build()`, le plugin Tailwind, les imports
   dynamiques, le Wasm Loro et l'URL publique exacte du worker ;
3. compiler `service-worker.ts` avec Bun ;
4. injecter par Workbox le manifeste de précache dans ce service worker.

Le source du client possède une petite frontière `searchWorkerUrl()`. En
développement, Vite reçoit `undefined` et conserve son traitement natif du
worker. En production, Bun injecte l'URL du fichier déjà compilé. Le build
échoue si le worker ou une sortie attendue manque.

Le manifeste PWA devient un fichier source lié depuis `index.html`. Le client
enregistre le service worker seulement en production. Le précache couvre HTML,
JS, CSS, manifeste, fontes, SVG, worker et Wasm, avec une taille maximale
explicite suffisante pour Loro. Les réponses API restent exclues.

### 5. Tests et adaptations de compatibilité

Vitest continue d'exécuter tous les projets sous Bun. Le fournisseur
`@vitest/coverage-v8` est remplacé par la version correspondante de
`@vitest/coverage-istanbul`, car Bun utilise JavaScriptCore et le merge du
format V8 boucle après les tests. Le périmètre couvert ne change pas. Les
pourcentages V8 historiques ne sont pas réutilisés comme s'ils mesuraient la
même chose : le premier rapport complet Istanbul devient un budget absolu de
code non couvert, que toute régression augmente et fait donc échouer.

Les contrats WebSocket ouvrent l'application Fastify sur `127.0.0.1` avec un
port attribué par le système et utilisent le module `ws` intégré à Bun avec
cookie et origine. Le helper ferme toujours les sockets et le listener. Cela
couvre le vrai chemin d'upgrade sous Bun et remplace `injectWS()`, dont le faux
duplex crée `new WebSocket(null)`.

Bun 1.4.0 surcharge `ws` avec son module de compatibilité intégré. Celui-ci ne
peut plus terminer `handleUpgrade()` après une macrotâche, alors que les hooks
Fastify historiques attendaient une lecture PostgreSQL avant l'upgrade. Les
gardes synchrones vérifient donc d'abord l'origine exacte et la présence du
cookie, l'upgrade se termine dans le même tour, puis la route appelle le même
résolveur durable propriétaire. Une file FIFO dédiée accepte au maximum huit
trames et 2 MiB cumulés pendant cette résolution ; tout dépassement ferme en
`1009`, toute session invalide en `4401`, et seules les trames authentifiées
sont remises à `PageSyncSession`. Les tests couvrent l'ordre, les deux bornes,
le hello/CSRF, la révocation et les erreurs de protocole.

Ajouter des contrats d'outillage et d'artefacts pour : version exacte,
lockfile unique, absence de commandes historiques, sorties API/Web, URL du
worker, manifeste de précache, image API sans Node, CI Bun et inventaire de
gates inchangé. Les tests applicatifs existants restent inchangés sauf lorsque
leur harnais dépendait du runtime supprimé.

### 6. CI, sécurité et images

Une action composite locale utilise
`oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6`
avec `bun-version: 1.4.0`, restaure le cache d'installation Bun par OS,
architecture et hash de `bun.lock`, puis exécute `bun ci`. Les jobs purement
Docker/shell n'installent pas inutilement le workspace. Tous les jobs
TypeScript/JavaScript retirent `setup-node` et `pnpm/action-setup`.

Les commandes du plan d'impact et ses attentes contractuelles deviennent Bun.
Playwright reste mis en cache par sa propre version et s'installe via Bun. La
matrice reste distribuée par profil et la porte locale garde deux piles au
maximum par défaut.

`bun audit --prod --audit-level=high` remplace l'audit pnpm.
`bun pm licenses --prod --json` possède la même forme groupée par licence que
le script existant et alimente la même allowlist. Les scans de secrets, de
source, de Compose, d'images et les artefacts SARIF ne changent pas de
politique.

L'image Bun officielle
`oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef`
sert aux builders et au runtime API. L'API s'exécute comme utilisateur `bun`
et le healthcheck emploie `bun --eval`. La fumée vérifie `bun --version`,
l'absence de runtime Node.js autonome (un alias `node` vers Bun est permis),
les migrations, le serveur, les signaux et la santé.
L'image Web conserve nginx non privilégié et ne contient aucun runtime
JavaScript en production.

### 7. Documentation et bascule

Mettre à jour les procédures actives, le README, `docs/development.md`, les
contrats de livraison et les tests qui les lisent. Une note de rupture explique
que la branche principale n'accepte plus les commandes pnpm/Node, comment
installer Bun 1.4.0, comment effectuer `bun ci`, et comment supprimer seulement
`node_modules` et les caches locaux obsolètes si nécessaire.

La branche peut connaître un état intermédiaire pendant l'implémentation. Avant
push, la recherche automatisée et les contrats doivent trouver zéro dépendance
exécutable historique dans les surfaces maintenues, puis `bun run checks:local`
doit réussir. La PR et `main` doivent ensuite réussir la même CI avant toute
suite fonctionnelle.

## Migration and Rollback

### Migration du dépôt

1. Générer et examiner `bun.lock` depuis l'ancien verrouillage encore présent.
2. Ajouter les dépendances Bun nécessaires et retirer les compilateurs de
   production remplacés.
3. Basculer scripts, builds, tests, CI et images.
4. Retirer les artefacts pnpm/Node seulement après réussite des preuves ciblées.
5. Exécuter l'installation propre, la porte complète et la CI.

### Données utilisateur

Aucune migration n'est créée. Les versions de schéma PostgreSQL, IndexedDB,
document canonique, protocole Loro, sauvegarde et export restent strictement
identiques. Les fixtures de référence et tests de restauration constituent la
preuve de compatibilité.

### Retour arrière

Avant V1, le retour du dépôt consiste à redéployer le commit/image antérieur,
qui embarque son ancienne chaîne. Il n'existe pas de double outillage dans le
nouveau commit. Comme aucune donnée ne migre, les volumes restent compatibles ;
les règles usuelles de sauvegarde et de restauration continuent de s'appliquer.

## Recorded Exceptions

- **Scope**: les seuils globaux Vitest passent des pourcentages V8 historiques
  (90 % instructions/lignes/fonctions, 85 % branches) aux maxima Istanbul de
  2 216 instructions, 1 866 lignes, 337 fonctions et 2 465 branches non
  couvertes. Le périmètre de fichiers et les exclusions restent inchangés.
- **Reason**: Bun utilise JavaScriptCore et ne fournit pas les données V8
  requises par `@vitest/coverage-v8`. Le rapport archivé de `main` et le rapport
  Bun portent sur le même périmètre mais ne comptent pas les mêmes unités : V8
  3.2 annonce 50 600 lignes contre 16 712 pour Istanbul, et omet plusieurs
  branches implicites qu'Istanbul instrumente. Réutiliser 90/85 sous un autre
  compteur ne préserverait donc pas le seuil historique ; ce serait une
  nouvelle hausse non planifiée.
- **Risk**: les pourcentages affichés avant et après migration ne sont plus
  comparables. Le budget absolu évite toutefois la dilution : une seule unité
  non couverte supplémentaire bloque la porte, même après l'ajout de beaucoup
  de code couvert.
- **Evidence**: 299 fichiers de tests et 3 150 tests réussissent lors du relevé
  initial. Le rapport V8 de `main` donne 45 633/50 600 lignes et 10 489/12 319
  branches ; Istanbul donne 14 846/16 712 lignes et 9 717/12 182 branches.
- **Review/removal condition**: réduire les budgets dès que des tests couvrent
  une dette existante ; ne jamais les augmenter sans nouvelle exception. Si un
  fournisseur natif JavaScriptCore produit un jour une mesure stable et
  comparable, exécuter les deux portes en parallèle avant de recalibrer.

## Complexity Tracking

Aucune violation constitutionnelle. Les adaptations worker, couverture,
profil mémoire du benchmark et socket sont les plus petites frontières
nécessaires pour conserver le comportement sous JavaScriptCore, le bundler Bun
et le module `ws` intégré. Le projet de performance utilise seul un worker et
le profil Bun `--smol` afin que son plafond mémoire mesure une collecte adaptée
à la machine minimale au lieu de l'heuristique mémoire disponible de l'hôte.
Le benchmark de page collecte entre ses phases chronométrées et borne le pic de
heap vivant ; les objets déjà libérables ne dépendent donc plus du moment choisi
par JavaScriptCore pour lancer une collecte sur une machine plus grande. Le
passage direct à `Bun.serve()` aurait remplacé le transport HTTP de Fastify et
ses hooks ; il est volontairement écarté de cette migration ciblée.
