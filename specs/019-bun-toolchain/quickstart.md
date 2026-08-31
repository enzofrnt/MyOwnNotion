# Quickstart: Valider la migration Bun 1.4

Ce guide valide la feature 019 depuis un environnement propre. Il ne doit pas
être exécuté contre l'unique base ou profil navigateur du propriétaire.

## Prérequis

- Bun 1.4.0 exactement ;
- Git ;
- Docker avec Buildx et Compose ;
- navigateurs Playwright supportés ;
- ports de test disponibles ;
- aucune donnée réelle dans les volumes ou profils utilisés.

Node.js, npm, Yarn, pnpm et Corepack ne sont pas des prérequis. Leur présence
éventuelle sur la machine ne doit avoir aucun effet.

## 1. Installation propre et verrouillée

Depuis un clone propre :

~~~sh
bun --version
bun ci
bun run toolchain:check
~~~

Attendu :

- la version affichée est `1.4.0` ;
- les neuf workspaces sont installés ;
- `bun.lock` n'est pas modifié ;
- aucun autre gestionnaire ou runtime n'est invoqué ;
- le contrôle refuse tout lockfile ou commande historique ajouté à une fixture.

Relever ensuite le hash de `bun.lock`, relancer `bun ci` et vérifier qu'il est
identique.

## 2. Développement sous Bun

Préparer la configuration de développement jetable décrite dans
`docs/development.md`, puis :

~~~sh
bun run db:migrate
bun run dev
~~~

Vérifier :

- l'API et le Web démarrent ;
- le Web appelle l'API en same-origin ;
- un changement TypeScript redémarre l'API ;
- un changement React/CSS est reflété par le serveur de développement ;
- l'upgrade `/v1/page-sync/socket` traverse le proxy ;
- une page modifiée dans deux profils continue à converger en temps réel.

Vite peut apparaître comme serveur de développement. Le processus qui
l'exécute doit être Bun, et `vite build` ne doit appartenir à aucune commande de
production.

Pour le HTTPS local (passkeys, cookie `__Host-`), la stack détachée
`compose.dev.yaml` reconstruit les images au démarrage et au reset :

~~~sh
bun run dev:stack
~~~

Attendu : `docker compose up --build` s'exécute, puis le projet reste
détaché à `https://localhost:8443`. Un changement de source bind-monté
recharge l'API ou Vite dans le conteneur déjà lancé, sans rebuild. Arrêt :
`bun run dev:stack:down`. Cette helper n'est pas la topologie officielle.

## 3. Boucle ciblée d'implémentation

Les familles indépendantes peuvent tourner simultanément sur une machine qui a
assez de mémoire :

~~~sh
bun run --bun vitest run --project domain
bun run --bun vitest run --project api-contract websocket
bun run --bun vitest run --project web search.worker
bun run build
~~~

Pour les navigateurs, utiliser le lanceur parallèle documenté :

~~~sh
bun run test:e2e:local -- --grep "offline|live sync"
~~~

Il isole ports, base et répertoires. La valeur par défaut reste limitée à deux
piles. Ne pas lancer plusieurs matrices brutes contre le même PostgreSQL.

## 4. Build API

~~~sh
bun run --filter @myownnotion/api build
~~~

Vérifier l'existence de :

- `apps/api/dist/server.js` ;
- `apps/api/dist/migrate.js` ;
- `apps/api/dist/admin/admin-cli.js` ;
- leurs source maps.

Avec une base jetable et les secrets de test, lancer successivement le bundle
de migration, le serveur et une commande admin. Vérifier le contrôle de santé,
un appel authentifié, le WebSocket, une sauvegarde vérifiée et l'arrêt par
signal.

## 5. Build Web et hors ligne

~~~sh
bun run --filter @myownnotion/web build
~~~

Vérifier :

1. `index.html` référence uniquement des fichiers présents ;
2. une ressource `search.worker-*.js` existe ;
3. le bundle principal référence cette URL et pas un chemin source `.ts` ;
4. Loro Wasm, CSS et manifeste sont produits ;
5. le service worker contient ces ressources dans son manifeste de précache ;
6. aucune route `/v1` ou `/health` n'est précachée.

Servir `dist/` sur loopback, charger une fois l'application dans Chromium,
attendre `navigator.serviceWorker.ready`, couper le réseau puis recharger.
Attendu : le titre et le shell apparaissent, puis le worker répond à une
commande de remise à zéro sans réseau.

## 6. Couverture et vrais WebSockets

~~~sh
bun run test:coverage
bun run test:contract
~~~

Attendu :

- Istanbul collecte chaque projet et respecte le budget absolu de non-couverture
  figé dans `vitest.config.ts` ;
- aucun provider V8 n'est chargé ;
- les contrats page-sync ouvrent un vrai listener Fastify éphémère ;
- `Bun.resolveSync("ws", ...)` désigne le module intégré à Bun, sans alias npm ;
- refus d'origine, CSRF, tailles, protocoles et révocation gardent les mêmes
  codes ;
- un hello envoyé dès l'ouverture attend l'authentification durable dans une
  file bornée, puis est rejoué dans l'ordre ; la neuvième trame ou plus de
  2 MiB ferme la connexion ;
- aucun test ne repasse sous Node ou n'utilise `injectWS()`.

## 7. Images et stack officielle

Construire les images avec les bases déjà épinglées :

~~~sh
bun run images:build
bun run compose:check
~~~

Dans l'image API, vérifier :

~~~sh
bun --version
node_path="$(command -v node || true)"
test -z "$node_path" || test "$(readlink -f "$node_path")" = "$(readlink -f "$(command -v bun)")"
~~~

Attendu : Bun retourne `1.4.0`, aucun runtime Node.js autonome n'existe (le
possible alias `node` de l'image officielle pointe vers Bun), l'utilisateur
est `bun`, les volumes restent inscriptibles, la migration termine et
`/health` devient sain. Les deux images doivent être construites pour
`linux/amd64` et `linux/arm64`.

Démarrer ensuite Compose sur des volumes vierges, réaliser le bootstrap avec
un profil jetable, créer/modifier une page, synchroniser deux navigateurs,
ajouter un fichier et vérifier une sauvegarde/restauration.

## 8. Compatibilité des données

Contre des copies de fixtures uniquement :

1. démarrer avec une base et un stockage local créés avant la feature 019 ;
2. exécuter les nouvelles images ;
3. lire et modifier des pages ;
4. rattraper des opérations hors ligne ;
5. restaurer chaque sauvegarde de référence ;
6. comparer versions de schéma, protocoles et digests canoniques.

Attendu : aucune migration de contenu, aucune nouvelle version de protocole et
aucune divergence de digest causée par l'outillage.

## 9. Porte complète avant push

Lire l'inventaire actuel dans `docs/development.md`, puis lancer exactement :

~~~sh
bun run checks:local
~~~

Cette commande est obligatoire avant le push. Un Docker, navigateur ou autre
outil requis indisponible bloque le push ; il ne doit pas être ignoré.

Après réussite :

1. vérifier que `git status` ne contient que les changements voulus ;
2. vérifier qu'une recherche des commandes actives historiques est vide ;
3. mettre `tasks.md` et la validation à jour ;
4. pousser la branche ;
5. ouvrir la PR et attendre toute la CI ;
6. corriger jusqu'à ce que chaque job soit vert avant fusion.

## Nettoyage ciblé en cas de transition locale

Si un checkout existant contient des modules matérialisés par l'ancienne
chaîne, fermer les processus du dépôt puis supprimer uniquement le
`node_modules` de ce checkout. Relancer `bun ci`.

Les caches globaux pnpm/Node n'ont pas besoin d'être effacés pour que le dépôt
fonctionne. Ne jamais supprimer un home, un cache partagé ou un volume de
données en bloc. Les volumes Compose et profils navigateur ne sont supprimés
que lorsqu'ils sont explicitement jetables et précisément identifiés.

## Diagnostic rapide

| Symptôme | Vérification |
| --- | --- |
| Version refusée | `bun --version` doit être exactement `1.4.0` |
| Installation gelée refuse | mettre à jour volontairement manifestes et `bun.lock`, ne pas utiliser `--no-save` |
| Worker 404 | vérifier l'URL hachée dans le bundle et le fichier sous `dist/assets` |
| PWA incomplète hors ligne | vérifier que worker et Wasm figurent dans `service-worker.js` |
| Couverture boucle après les tests | vérifier le provider `istanbul` et l'absence de `@vitest/coverage-v8` |
| Contrat WebSocket URL nulle | rechercher un `injectWS()` restant |
| Upgrade WebSocket bloqué après authentification | vérifier que les hooks d'upgrade ne rendent pas la main avant `handleUpgrade()` et que la résolution durable reste dans la route |
| `ws` résout vers `node_modules` | retirer tout alias/patch npm ; le contrat exige la résolution intégrée `ws` |
| Image trouve Node | vérifier la base Bun épinglée et la fumée runtime |
| CI utilise un ancien cache | vérifier la clé OS/architecture/hash `bun.lock`, puis laisser `bun ci` valider |
