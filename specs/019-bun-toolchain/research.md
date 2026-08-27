# Research: Chaîne d'outils unifiée sous Bun 1.4

Recherche consolidée le 27 août 2026 à partir de la documentation officielle
de Bun, des projets officiels des outils conservés et de prototypes exécutés
sur le commit `9700ba1b` avec Bun `1.4.0+1381054db`. Les prototypes ont été
réalisés dans une copie jetable ; ils n'ont modifié ni la branche de feature ni
les données de l'installation locale.

## Decision 1 — Épingler Bun 1.4.0 et effectuer une bascule à sens unique

**Decision**: Déclarer Bun 1.4.0 exactement dans `packageManager` et
`engines.bun`, versionner uniquement `bun.lock`, et supprimer de l'état final
pnpm, son workspace, son lockfile et les lancements directs Node.js.

**Rationale**: Bun regroupe runtime, gestionnaire, workspaces, exécuteur de
scripts et bundler. La version exacte évite que deux contributeurs ou jobs CI
produisent des graphes et artefacts différents. Le produit étant avant V1,
maintenir deux chemins doublerait les contrats et pourrait masquer une
incompatibilité jusqu'à la production.

La documentation Bun précise que `bun.lock` est textuel, doit être commité et
que `bun ci` équivaut à l'installation avec verrouillage gelé. Elle documente
aussi la migration automatique de `pnpm-lock.yaml` et des globs de
`pnpm-workspace.yaml` vers le manifeste racine.

**Alternatives considered**:

- **Bun seulement comme gestionnaire**: rejeté, car le runtime, les scripts et
  les artefacts resteraient dépendants de Node et ne répondraient pas à la
  demande.
- **Conserver pnpm comme secours**: rejeté, car deux lockfiles ne constituent
  pas un fallback fiable ; ils décrivent deux résolutions qui peuvent diverger.
- **Utiliser `latest` ou `1.4.x`**: rejeté pour la reproductibilité locale, CI
  et image.

**Sources**:

- Lockfile Bun et migration : https://bun.sh/docs/pm/lockfile
- Installation gelée et migration pnpm : https://bun.sh/docs/pm/cli/install
- Workspaces et filtres : https://bun.sh/docs/pm/workspaces

## Decision 2 — Conserver le code applicatif Node-compatible et prouver les dépendances réelles

**Decision**: Ne pas réécrire Fastify, Drizzle, `pg`, Pino, Loro ou les scripts
qui importent `node:*`. Les exécuter sous Bun et adapter seulement une surface
dont un test concret prouve l'incompatibilité.

**Rationale**: Bun fournit les modules et globaux Node les plus utilisés, mais
sa propre documentation dit explicitement que la compatibilité n'est pas
encore totale. Une affirmation générale « compatible Node » ne suffit donc pas ;
la bonne réduction de risque consiste à exercer le graphe précis de
MyOwnNotion.

Les preuves locales ont validé :

- installation des neuf workspaces et 804 paquets ;
- vérification TypeScript de tous les workspaces en parallèle ;
- 755 tests du package domaine ;
- un contrat API avec PostgreSQL réel ;
- Fastify 5.7.4 avec `@fastify/websocket` 11.3.0 sur un vrai port ;
- un client WebSocket Bun ayant reçu l'écho du serveur Fastify ;
- les trois entrées API bundlées pour la cible Bun ;
- le serveur bundle allant jusqu'à sa première connexion PostgreSQL.

**Alternatives considered**:

- **Remplacer Fastify par `Bun.serve`**: rejeté ; cela réécrirait routes,
  plugins, hooks, schémas, sécurité et cycle de vie sans besoin produit.
- **Remplacer `pg`/Drizzle par les APIs SQL Bun**: rejeté ; aucun défaut du
  stockage actuel ne le justifie et les migrations seraient inutilement
  risquées.
- **Traiter Bun comme totalement identique à Node**: rejeté ; la documentation
  officielle et les deux adaptations de test montrent qu'une validation
  ciblée reste nécessaire.

**Sources**:

- Compatibilité Node.js : https://bun.sh/docs/runtime/nodejs-compat
- Runtime et exécution TypeScript : https://bun.sh/docs/runtime
- Compatibilité ESM/CommonJS : https://bun.sh/docs/runtime/module-resolution
- Fastify, runtimes alternatifs : https://fastify.dev/docs/latest/Guides/Getting-Started/#run-your-server

## Decision 3 — Utiliser Bun comme bundler de production des trois entrées API

**Decision**: Remplacer esbuild par un script TypeScript utilisant
`Bun.build()` avec `target: "bun"`, ESM et source maps pour `server`, `migrate`
et `admin-cli`. Bundler le graphe runtime afin que l'image n'ait besoin que des
sorties, des migrations SQL et de Bun.

**Rationale**: Le prototype a produit les trois bundles en moins d'une seconde.
Le smoke d'image a révélé que l'export Node de Loro conservait un chemin vers
son Wasm sous `node_modules`. Le build résout donc `loro-crdt` vers son export
`bundler`, que Bun sait transformer en un actif Wasm relogeable sous `dist`, et
interdit explicitement tout chemin de machine de compilation. Des fichiers JavaScript stables sont préférés à un
exécutable autonome : ils gardent le runtime exact inspectable dans l'image et
évitent de multiplier les binaires par architecture dans le dépôt.

**Alternatives considered**:

- **Conserver esbuild lancé par Bun**: rejeté, car la compilation de production
  ne serait pas réalisée par Bun.
- **Exécuter directement les sources TypeScript en production**: possible,
  mais rejeté pour conserver une frontière d'artefact vérifiée et réduire les
  fichiers copiés dans l'image.
- **Compiler un exécutable autonome**: rejeté pour cette feature ; il complique
  les trois commandes, le diagnostic, les plateformes et l'identification du
  runtime sans avantage nécessaire.
- **Externaliser toutes les dépendances**: rejeté ; l'image devrait alors
  reconstruire et transporter un workspace de production complet. Le bundle
  testé est plus petit et plus simple à vérifier.

**Sources**:

- Bundler Bun : https://bun.sh/docs/bundler
- Cibles et loaders : https://bun.sh/docs/bundler/loaders
- Exécutables autonomes, alternative examinée :
  https://bun.sh/docs/bundler/executables

## Decision 4 — Compiler le Web avec Bun et rendre explicites worker et PWA

**Decision**: Utiliser l'entrée `index.html` de Bun avec
`bun-plugin-tailwind`, compiler le worker de recherche comme entrée distincte,
injecter son URL hachée dans le build principal, puis compiler et remplir le
service worker avec Workbox.

**Rationale**: Le prototype Bun a correctement produit :

- l'HTML réécrit ;
- deux feuilles CSS, dont Tailwind et les styles BlockNote ;
- les imports dynamiques React ;
- le Wasm Loro et son chargeur ;
- le worker de recherche ESM ;
- le manifeste PWA haché ;
- le service worker avec quatorze ressources versionnées.

Un navigateur Chromium a chargé le shell, attendu l'activation du service
worker, coupé le réseau, rechargé l'application et exécuté le worker de
recherche depuis le précache. Cela prouve le comportement qui compte, pas
seulement la présence de fichiers.

Le seul écart découvert est que Bun 1.4 ne transforme pas automatiquement le
motif Vite `new Worker(new URL("...", import.meta.url))`. Compiler le worker en
premier et fournir son URL publique est une adaptation locale de quelques
lignes. Vite reçoit une valeur absente en développement et conserve son propre
traitement du même worker.

Le plafond Workbox est fixé explicitement au-dessus du Wasm Loro d'environ
3 Mio. Les réponses API ne font jamais partie du glob de précache.

**Alternatives considered**:

- **Conserver `vite build`**: rejeté, car Vite resterait le compilateur de
  production demandé à Bun.
- **Abandonner la PWA pendant la migration**: rejeté, car le démarrage hors
  ligne est un contrat permanent.
- **Intégrer le worker dans le thread principal**: rejeté, car cela modifierait
  les performances et le comportement de recherche.
- **Réécrire Workbox**: rejeté ; l'injection de manifeste reste un outil
  spécialisé compatible avec un build Bun.

**Sources**:

- HTML et sites statiques Bun : https://bun.sh/docs/bundler/html-static
- Plugin Tailwind recommandé par Bun :
  https://bun.sh/docs/bundler/fullstack#tailwindcss-plugin
- Loader HTML et ressources prises en charge :
  https://bun.sh/docs/bundler/loaders#html
- Workbox `injectManifest` :
  https://developer.chrome.com/docs/workbox/modules/workbox-build#injectmanifest_mode

## Decision 5 — Garder Vite seulement comme serveur de développement sous Bun

**Decision**: Conserver Vite, `@vitejs/plugin-react` et
`@tailwindcss/vite` pour le HMR et le proxy de développement, mais supprimer
Vite et `vite-plugin-pwa` du chemin de production.

**Rationale**: Le serveur Bun HTML sait fournir une SPA avec HMR, mais le dépôt
a besoin d'un proxy same-origin HTTP et WebSocket cohérent avec la production.
Le proxy Vite existe, est testé et ne possède aucune donnée. Sous Bun 1.4, un
prototype a démarré Vite 7.3, transmis un upgrade `/v1` à un serveur Bun et
retourné un message WebSocket dans les deux sens.

Vite reste un CLI tiers exécuté par le runtime Bun, comme TypeScript ou
Playwright. Il n'est plus un compilateur de livraison.

**Alternatives considered**:

- **Écrire un nouveau proxy/HMR Bun**: rejeté ; il augmenterait la surface de
  maintenance et les risques sur le temps réel pour retirer un outil qui
  fonctionne sous Bun.
- **Servir Web et API sur deux origines en développement**: rejeté ; cela
  introduirait CORS, changerait WebAuthn/cookies et divergerait de la
  production.

**Sources**:

- Serveur statique Bun et fallback SPA :
  https://bun.sh/docs/bundler/html-static#single-page-apps-spa
- Plugins du serveur Bun, solution alternative étudiée :
  https://bun.sh/docs/bundler/fullstack#plugins

## Decision 6 — Garder Vitest et Playwright sous Bun, remplacer seulement la couverture V8

**Decision**: Continuer à utiliser Vitest et Playwright, tous deux exécutés par
Bun. Remplacer `@vitest/coverage-v8` par
`@vitest/coverage-istanbul` de même version. Ne pas migrer les tests vers
`bun:test` dans cette feature.

**Rationale**: Les projets Vitest décrivent déjà les environnements navigateur,
base, contrats et seuils. Les réécrire ajouterait une migration de tests sans
rapport avec la demande et risquerait de perdre des portes.

Les tests Vitest ordinaires réussissent sous Bun. Les 755 tests domaine ont
terminé avec le fournisseur V8, puis son merge `@bcoe/v8-coverage` a récursé
jusqu'à dépasser la pile, car le runtime est JavaScriptCore. La même suite avec
Istanbul a produit un rapport normal. Sur la suite complète, les 3 150 tests
réussissent, mais les compteurs des deux fournisseurs ne sont pas équivalents :
le rapport V8 archivé de `main` compte 50 600 lignes à 90,18 %, tandis
qu'Istanbul en compte 16 712 à 88,83 % et instrumente davantage de fonctions et
de branches implicites. La porte migre donc vers les maxima absolus d'éléments
non couverts du premier rapport Istanbul. Cette forme est un ratchet : ajouter
du code couvert ne peut pas masquer une nouvelle branche non testée.

Playwright 1.62.1 s'exécute sous Bun dans le prototype et a validé le shell PWA
hors ligne. Les profils et navigateurs restent inchangés.

**Alternatives considered**:

- **Passer à `bun:test`**: rejeté pour la migration courante ; Bun lui-même
  indique que sa compatibilité avec `node:test` et l'écosystème n'est pas
  totale, et le dépôt perdrait les projets/rapports Vitest existants.
- **Conserver la couverture V8**: rejeté par une reproduction déterministe sous
  Bun 1.4.
- **Désactiver la couverture**: rejeté ; une porte indisponible n'est pas une
  réussite.
- **Copier les pourcentages 90/85 vers Istanbul**: rejeté ; les unités mesurées
  diffèrent et imposeraient une hausse arbitraire de couverture dans une
  migration de runtime. Le budget absolu conserve exactement la dette mesurée
  et bloque toute augmentation.

**Sources**:

- Test runner Bun et intégration CI : https://bun.sh/docs/test
- Vitest, fournisseur Istanbul :
  https://vitest.dev/guide/coverage.html#coverage-providers
- Vitest, seuil négatif comme maximum d'éléments non couverts :
  https://vitest.dev/config/coverage#coverage-thresholds
- Playwright, installation : https://playwright.dev/docs/browsers

## Decision 7 — Utiliser le module `ws` intégré à Bun avec un upgrade synchrone

**Decision**: Conserver Fastify et `@fastify/websocket`, laisser Bun résoudre
`ws` vers son module intégré, terminer l'upgrade avant toute lecture durable
asynchrone, puis authentifier avec le résolveur de session existant. Les tests
écoutent Fastify sur un port éphémère et se connectent par une vraie frontière
réseau plutôt que par `injectWS()`.

**Rationale**: Deux incompatibilités distinctes ont été reproduites sous Bun
1.4.0. Le helper de test de `@fastify/websocket` crée directement
`new WebSocket(null, ..., { isServer: false })` puis relie deux streams privés ;
le module intégré à Bun refuse cette URL nulle. Plus important, ce module
intégré possède en 1.4.0 une régression documentée : `handleUpgrade()` échoue
si une macrotâche s'est écoulée. Les hooks Fastify qui consultaient PostgreSQL
avant l'upgrade déclenchaient précisément ce cas.

Une vraie écoute couvre davantage : origine, cookie, upgrade HTTP, hooks,
fermeture et codes WebSocket. L'origine exacte et la présence du cookie sont
refusées synchroniquement avant l'upgrade. La connexion ouverte attache
immédiatement une file FIFO limitée à huit trames et 2 MiB cumulés, exécute le
même résolveur durable de propriétaire, puis remet les trames à
`PageSyncSession` seulement si l'authentification réussit. Une session absente
ou révoquée ferme en `4401`; un dépassement ferme en `1009`.

**Alternatives considered**:

- **Charger explicitement le package npm `ws`**: le prototype contourne la
  régression, mais il abandonne le module Bun demandé, ajoute un fallback à
  maintenir et masque le vrai runtime exercé ; rejeté.
- **Remplacer Fastify par `Bun.serve()`**: donne accès à l'API
  `ServerWebSocket` la plus performante, mais impose de remplacer le transport
  HTTP, les hooks, plugins et contrats Fastify de toute l'API ; disproportionné
  pour cette migration d'outillage.
- **Patcher `node_modules/@fastify/websocket`**: rejeté ; dépendance fragile et
  insuffisante pour la régression d'upgrade asynchrone du runtime.
- **Désactiver les trois contrats**: rejeté ; ils couvrent synchronisation et
  révocation critiques.
- **Faire tourner seulement ces tests sous Node**: rejeté ; ce serait un second
  runtime cachant une incompatibilité.

**Sources**:

- Documentation de test `@fastify/websocket` et `injectWS` :
  https://github.com/fastify/fastify-websocket#testing
- Sources du plugin :
  https://github.com/fastify/fastify-websocket/blob/master/index.js
- Module `ws` intégré à Bun et régression 1.4.0 après macrotâche :
  https://github.com/oven-sh/bun/issues/39766
- API WebSocket native Bun et différence de modèle `ServerWebSocket` :
  https://bun.sh/docs/runtime/http/websockets

## Decision 8 — Centraliser l'installation CI dans une action composite Bun

**Decision**: Créer une action locale qui installe Bun 1.4.0 via l'action
officielle épinglée et exécute `bun ci`. L'action officielle conserve son cache
interne du binaire, mais l'action locale ne restaure ni `node_modules` ni le
cache global de paquets Bun. L'utiliser dans chaque job TypeScript/JavaScript.
Les jobs purement Docker ou shell ne paient pas une installation inutile.

**Rationale**: La CI actuelle répète trois étapes Node/pnpm dans de nombreux
jobs. Une action locale garde version et mode gelé identiques et rend les tests
de contrat plus simples. L'action officielle lit aussi
`packageManager`, mais la version est fournie explicitement pour que la CI soit
auto-descriptive.

Le cache intégré de `setup-bun` porte seulement sur l'exécutable téléchargé.
Le projet a également évalué un cache GitHub Actions de
`~/.bun/install/cache`. Sur la CI de référence, sa restauration transférait
environ 196 Mio et prenait 4,97 s dans chacun d'environ quinze jobs, avant un
`bun ci` de 10,60 s. Un essai isolé sous l'image Bun 1.4.0 exacte a mesuré
18,98 s à froid et 16,14 s avec le cache déjà local : le gain de 2,84 s reste
inférieur au seul coût de restauration GitHub. L'issue officielle #14 rapporte
la même variabilité et un mainteneur y explique que le cache de dépendances
n'a pas été intégré parce que les premiers essais rendaient l'installation
directe plus rapide.

Le tag `v2` de `oven-sh/setup-bun` résolvait le 27 août 2026 vers le commit
`0c5077e51419868618aeaa5fe8019c62421857d6` (release 2.2.0). Le workflow
utilisera ce SHA immuable.

**Alternatives considered**:

- **Répéter les étapes dans chaque job**: possible, mais plus exposé à la
  dérive et aux oublis.
- **Mettre `node_modules` en artefact**: rejeté pour sa taille, sa portabilité
  et son coût disque sur les runners contraints.
- **Persister `~/.bun/install/cache` avec `actions/cache`**: rejeté après mesure
  parce que la restauration du cache de paquets est plus lente que le gain
  observé et multiplie les transferts dans la matrice. Cette décision pourra
  être revue si une mesure future du temps total démontre l'inverse.

**Sources**:

- Action officielle `setup-bun` : https://github.com/oven-sh/setup-bun
- Discussion officielle sur le cache de dépendances :
  https://github.com/oven-sh/setup-bun/issues/14
- Installation CI gelée : https://bun.com/docs/pm/cli/install#ci-cd
- Cache global des paquets : https://bun.com/docs/pm/global-cache

## Decision 9 — Utiliser l'image officielle Bun épinglée et garder nginx pour le Web

**Decision**: Remplacer la base Node des builders et du runtime API par
`oven/bun:1.4.0-debian` épinglée au manifeste multiarchitecture
`sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef`.
Conserver nginx non privilégié pour servir le Web compilé.

**Rationale**: Le manifeste couvre `linux/amd64` et `linux/arm64`. L'image
contient l'utilisateur `bun` uid/gid 1000, Bun 1.4.0 et aucun exécutable
`node`. Le runtime API peut donc prouver l'exclusivité au lieu de supprimer
Node d'une image Node. Le Web n'exécute aucun JavaScript côté serveur ; nginx
reste la plus petite frontière existante.

**Alternatives considered**:

- **Installer Bun dans l'image Node**: rejeté ; Node resterait présent sans
  raison et la fumée ne pourrait pas prouver son absence.
- **Servir aussi le Web avec Bun**: rejeté ; cela agrandirait le runtime Web et
  remplacerait un nginx déjà configuré pour le proxy, les en-têtes et le
  WebSocket.
- **Image `alpine` Bun**: non retenue pour cette première bascule afin de rester
  proche du runtime Debian actuel et réduire les différences libc/outils.

**Sources**:

- Images Docker officielles Bun : https://hub.docker.com/r/oven/bun
- Dockerfile officiel : https://github.com/oven-sh/bun/tree/main/dockerhub

## Decision 10 — Conserver les politiques d'audit et de licence avec les commandes Bun 1.4

**Decision**: Utiliser `bun audit --prod --audit-level=high` et
`bun pm licenses --prod --json`, puis conserver la logique d'allowlist, les
artefacts et les niveaux de blocage existants.

**Rationale**: Bun 1.4 expose ces deux commandes. Le JSON de licences est déjà
groupé par identifiant avec `name`, `versions`, `paths` et `license`, soit la
même forme consommée par le contrôle actuel. Un prototype a exécuté l'audit
avec filtrage production et niveau élevé, et généré le JSON de licences.

**Alternatives considered**:

- **Ajouter un scanner de licences tiers**: rejeté ; Bun fournit désormais la
  donnée nécessaire.
- **Parser manuellement `bun.lock` et tous les `package.json`**: rejeté ; cela
  recréerait un graphe production complexe et plus fragile.
- **Réduire le niveau d'audit**: rejeté ; le changement d'outil ne justifie pas
  une politique plus faible.

**Sources**:

- Audit Bun : https://bun.sh/docs/pm/audit
- Utilitaires du gestionnaire Bun : https://bun.sh/docs/pm/cli/pm

## Prototype evidence summary

| Preuve | Résultat Bun 1.4.0 |
| --- | --- |
| Migration pnpm → `bun.lock` | 963 entrées verrouillées, 9 workspaces reconnus |
| Installation complète | 804 paquets, aucun script non approuvé signalé |
| Typecheck workspace parallèle | 9/9 workspaces réussis |
| Tests domaine ordinaires | 755 réussis |
| Couverture V8 | tests réussis puis stack overflow du merge V8 |
| Couverture Istanbul | collecte et rapport normaux |
| Contrat API + PostgreSQL | 4/4 réussis |
| Fastify + vrai WebSocket | écho bidirectionnel réussi |
| `injectWS` synthétique | échec reproductible sur URL nulle |
| Bundle API Bun | serveur, migration et administration produits |
| Build Web Bun | HTML, CSS, chunks, Loro Wasm, manifeste et worker produits |
| PWA hors ligne | reload Chromium et worker de recherche réussis réseau coupé |
| Vite sous Bun | démarrage et proxy WebSocket `/v1` réussis |
| Licences Bun | JSON production compatible avec la politique existante |
| Audit Bun | niveau élevé et filtre production acceptés |
| Image Bun Debian | Bun 1.4.0, utilisateur `bun`, aucun `node`, deux architectures |

## Resolved unknowns

Tous les `NEEDS CLARIFICATION` techniques de la phase de recherche sont
résolus. Les risques restants sont des travaux de mise en œuvre et de validation
de la porte complète, pas des décisions d'architecture.
