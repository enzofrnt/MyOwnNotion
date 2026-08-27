# Data Model: Chaîne d'outils unifiée sous Bun 1.4

## User-data impact

Cette feature ne crée, ne modifie et ne supprime aucune entité utilisateur.
Elle ne change ni PostgreSQL, ni IndexedDB, ni les blobs, ni les sauvegardes,
ni les documents canoniques, ni les opérations Loro.

~~~text
avant feature 019                         après feature 019
-----------------                         -----------------
PostgreSQL ─────────── mêmes octets ─────────── PostgreSQL
IndexedDB  ─────────── mêmes octets ─────────── IndexedDB
blobs      ─────────── mêmes octets ─────────── blobs
sauvegardes ────────── mêmes formats ────────── sauvegardes
protocoles ─────────── mêmes versions ───────── protocoles
~~~

Les « entités » ci-dessous sont uniquement des artefacts de développement et
de livraison. Elles sont décrites pour rendre leur autorité et leurs invariants
testables.

## Toolchain declaration

Source d'autorité : `package.json` racine.

| Field | Type | Rules |
| --- | --- | --- |
| `packageManager` | exact string | `bun@1.4.0` uniquement |
| `engines.bun` | exact string | `1.4.0`, sans plage |
| `workspaces` | list | `apps/*`, `packages/*` ; chaque workspace possède un nom unique |
| `scripts` | map | toutes les commandes canoniques sont lancées par Bun |
| `devDependencies` | map | outils tiers verrouillés, aucun gestionnaire parallèle |

### Invariants

- La version déclarée, la version CI, la version image et `Bun.version` sont
  identiques.
- `packageManager` est l'autorité lisible par les humains et par
  `setup-bun` ; aucune seconde version n'est cachée dans un script.
- Une version différente échoue dans `toolchain:check` avant la porte de
  qualité.
- Les globs de workspace ne sont définis qu'une fois.

## Dependency lock

Source d'autorité : `bun.lock`.

| Field/concept | Meaning |
| --- | --- |
| `lockfileVersion` | version de format comprise par Bun 1.4.0 |
| `workspaces` | manifestes et dépendances directes de chaque workspace |
| `packages` | résolutions exactes, intégrités, peers et dépendances transitives |
| workspace reference | lien local, jamais publication ou résolution distante |

### Invariants

- Un et un seul lockfile JavaScript est suivi par Git.
- `bun ci` réussit sans écrire le lockfile.
- Une seconde installation sur les plateformes supportées laisse le fichier
  byte-identique.
- Aucun package direct n'est monté de version implicitement pendant la
  migration ; toute différence est examinée.
- Un manifeste modifié sans mise à jour du lockfile fait échouer
  l'installation gelée.

## Runtime execution

État dérivé à chaque processus.

| Field | Type | Rules |
| --- | --- | --- |
| `runtimeName` | literal | `bun` |
| `runtimeVersion` | string | `1.4.0` exactement |
| `entrypoint` | path | source TypeScript en développement, bundle JS en production |
| `mode` | enum | `development`, `test`, `migration`, `administration`, `production` |
| `exitCode` | integer | code de l'outil ou de l'application, jamais masqué |

### State transitions

~~~text
version lue
   ├── 1.4.0 ──► commande exécutée ──► code réel propagé
   └── autre ───► refus immédiat ─────► code non nul
~~~

La présence éventuelle de Node.js sur l'hôte n'entre pas dans la décision.

## Realtime upgrade bridge

État éphémère d'une connexion page-sync entre l'upgrade natif Bun et la
résolution durable de sa session propriétaire.

| Field | Type | Rules |
| --- | --- | --- |
| `origin` | URL header | correspondance exacte avant upgrade |
| `sessionCookiePresent` | boolean | doit être vrai avant upgrade ; la valeur n'est pas conservée ici |
| `principal` | owner ou null | produit par le résolveur PostgreSQL existant après upgrade |
| `pendingFrames` | FIFO | huit trames au maximum |
| `pendingBytes` | integer | 2 MiB cumulés au maximum |

### State transitions

~~~text
requête upgrade
   ├── origine/cookie refusé ──► réponse HTTP, aucun socket
   └── gardes synchrones OK ───► socket ouvert + file bornée
                                      ├── dépassement ──► close 1009
                                      ├── session invalide ─► close 4401
                                      └── propriétaire valide
                                              └── PageSyncSession + replay FIFO
~~~

Le pont ne change aucun message ni numéro de protocole. Il ne rend jamais une
trame visible à `PageSyncSession` avant authentification et disparaît après le
replay.

## API build artifact set

Source d'autorité : sortie de `apps/api/build.ts`.

| Artifact | Purpose | Required runtime |
| --- | --- | --- |
| `dist/server.js` | serveur HTTP/WebSocket et tâches planifiées | Bun 1.4.0 |
| `dist/migrate.js` | migration gardée et one-shot Compose | Bun 1.4.0 |
| `dist/admin/admin-cli.js` | sauvegarde, restauration, inspection, rotation | Bun 1.4.0 |
| matching `.map` files | diagnostic | none at rest |
| `/app/migrations/**` in image | SQL revu, non bundlé | read by migration bundle |

### Invariants

- Les trois entrées sont produites par un seul appel de build canonique.
- Aucun chemin absolu de la machine de build n'est requis au runtime.
- Un diagnostic du bundler ou une sortie manquante échoue.
- Le serveur répond à `/health`, le migrateur conserve ses gardes et le CLI
  conserve ses codes structurés.
- L'image runtime ne contient ni source applicative nécessaire, ni
  `node_modules`, ni runtime Node.js autonome. L'alias `node` fourni par
  l'image officielle est acceptable uniquement s'il se résout vers Bun.

## Web build artifact set

Source d'autorité : sortie de `apps/web/build.ts`.

| Artifact | Purpose | Cache rule |
| --- | --- | --- |
| `index.html` | shell et références hachées | precached |
| `assets/*.js` | client et chunks dynamiques | precached |
| `assets/*.css` | Tailwind, primitives, éditeur | precached |
| `assets/search.worker-*.js` | index de recherche local | precached |
| `assets/*loro*.wasm` | moteur CRDT navigateur | precached |
| `assets/*.webmanifest` | installation PWA | precached |
| `service-worker.js` | activation et routage Workbox | browser-managed |
| source maps | diagnostic/build artifact | not precached |

### Invariants

- `index.html` référence uniquement des sorties présentes.
- Le bundle principal contient exactement l'URL publique du worker produit.
- Le worker répond à une commande `clear` connecté et hors ligne.
- Le manifeste de précache contient toutes les sorties fonctionnelles et
  aucune route/réponse API.
- Le service worker n'est enregistré qu'en build production.
- `MYOWNNOTION_API_URL` reste une valeur publique injectée, jamais un secret.

## CI toolchain setup

Source d'autorité : `.github/actions/setup-bun/action.yml`.

| Field | Value/rule |
| --- | --- |
| setup action | `oven-sh/setup-bun` épinglé par SHA |
| Bun version | `1.4.0` |
| cache key | OS + architecture + hash de `bun.lock` |
| cache content | cache de téléchargement Bun uniquement |
| install | `bun ci` |

### Invariants

- Tout job qui exécute une commande TypeScript/JavaScript passe par cette
  action ou installe explicitement le même Bun lorsqu'aucune dépendance n'est
  requise.
- Aucun job ne prépare Node.js, pnpm, npm ou Yarn pour le projet.
- Un cache absent ou corrompu ne contourne jamais `bun ci`.
- Les jobs sans impact conservent leur no-op explicite ; les jobs impactés
  utilisent exactement le plan téléchargé.

## Container runtime identity

Source d'autorité : `docker/base-images.json` et les Dockerfiles.

| Image | Build runtime | Production runtime | User |
| --- | --- | --- | --- |
| API | Bun 1.4.0 Debian | Bun 1.4.0 Debian | `bun` (1000) |
| Web | Bun 1.4.0 Debian | nginx unprivileged | `101` |

### Invariants

- Les deux bases sont référencées par manifeste multiarchitecture SHA-256.
- `linux/amd64` et `linux/arm64` sont présents.
- L'image API retourne Bun 1.4.0 et ne résout pas `node`.
- Les volumes blobs/sauvegardes restent accessibles par l'utilisateur non
  privilégié.
- Aucun fichier `.env`, clé ou contenu utilisateur n'entre dans une couche.
- La santé, les signaux et les codes de migration sont identiques à la version
  précédente.

## Migration state

La migration du dépôt suit un automate éphémère sur la branche :

~~~text
pnpm/Node courant
    │ génération et comparaison du lock
    ▼
état transitoire de preuve
    ├── preuve échoue ──► corriger sous Bun, sans fallback Node
    └── preuves ciblées réussissent
             │
             ▼
Bun exclusif
    ├── porte locale complète
    ├── CI PR complète
    └── main déployable
~~~

Seul l'état `Bun exclusif` peut être fusionné. Aucun marqueur de migration
n'est persisté dans l'application ou chez le propriétaire.
