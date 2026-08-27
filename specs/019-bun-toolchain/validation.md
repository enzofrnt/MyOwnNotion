# Validation: Chaîne d'outils unifiée sous Bun 1.4

**Date**: 2026-08-27

**Branche**: `codex/019-bun-1-4-toolchain`

**Runtime validé**: Bun `1.4.0` exactement

**Commit exécutable candidat**: `de22b00e244fcc7a16ba651d4476a558fb7caa7d`

Ce journal rassemble les preuves reproductibles de la migration. Les données,
le schéma PostgreSQL et le protocole de synchronisation restent inchangés.

## Outillage et installation

| Preuve | Résultat |
| --- | --- |
| `bun --version` | `1.4.0` |
| Deux installations `bun ci` consécutives | réussite ; aucun changement du verrouillage |
| SHA-256 de `bun.lock` après chaque installation | `9dce3d6e335a1e5d280f8f037f8743b0fa76d1fd11f269ee76d22efa58ff9c44` |
| `bun run toolchain:check` | réussite ; 1 124 fichiers suivis contrôlés |
| Lockfiles actifs | `bun.lock` uniquement |
| Workspaces vérifiés par TypeScript | 9/9 |
| Runtime autonome dans l'image API | Bun `1.4.0`; aucun Node.js autonome |

Les smokes de développement et la matrice navigateur démarrent l'API, Vite et
les scripts avec Bun. La présence éventuelle de Node ou pnpm sur l'hôte n'est
pas utilisée par les commandes du dépôt. L'alias `node` fourni par l'image Bun
officielle est accepté uniquement lorsqu'il résout vers le même exécutable que
`bun`.

### Frontière du cache CI

`oven-sh/setup-bun` garde par défaut son cache du binaire téléchargé
(`no-cache: false`). Le cache GitHub Actions ajouté par le dépôt visait une
autre donnée, `~/.bun/install/cache`, c'est-à-dire les archives des dépendances.
Il n'était donc pas strictement dupliqué, mais sa valeur devait être mesurée
séparément.

Sur la CI de la PR, restaurer ce cache de paquets a transféré environ 196 Mio en
4,97 s par job, puis `bun ci` a encore pris 10,60 s. Sous l'image Bun 1.4.0
exacte, une installation froide a pris 18,98 s et une installation avec cache
local chaud 16,14 s : le gain de 2,84 s est inférieur au seul coût de
restauration GitHub. L'action locale conserve donc le cache intégré du binaire,
ne restaure ni `node_modules` ni le cache de paquets, et exécute toujours
`bun ci`. Toute réintroduction demande une nouvelle mesure du temps total du
dépôt.

## WebSocket Bun

- `Bun.resolveSync("ws", ...)` retourne le module `ws` intégré au runtime ;
  aucune implémentation npm ou voie de repli n'est installée.
- Fastify et `@fastify/websocket` sont conservés. Passer à `Bun.serve()` aurait
  remplacé le transport HTTP, les hooks, plugins, schémas et contrats de toute
  l'API pour un gain sans rapport avec la charge mono-utilisateur visée.
- Les tests utilisent une vraie écoute et un vrai client WebSocket, et non
  `injectWS()`.
- Sous Bun 1.4.0, l'upgrade est terminé synchroniquement avant
  l'authentification durable afin de contourner la régression documentée de
  `handleUpgrade()` après une macrotâche.
- Origine et cookie sont refusés avant l'upgrade. Pendant la résolution de
  session, une file conserve au maximum 8 trames et 2 MiB ; une session invalide
  ferme en `4401` et un dépassement en `1009`.
- Les quatre tests déterministes de la route couvrent le rejeu après
  authentification, le dépassement, la session absente et l'exception
  d'authentification. Les contrats existants couvrent aussi origine, CSRF,
  protocole, taille et révocation d'appareil.

## Builds, PWA et images

| Preuve | Résultat |
| --- | --- |
| Deux builds API | réussite ; `server.js`, `migrate.js`, `admin/admin-cli.js`, sources maps et Loro Wasm relogeable |
| Entrée administration bundlée | l'aide s'exécute une seule fois ; 42 tests CLI/administration et le contrat d'artefact réussissent |
| Deux builds Web | réussite ; HTML, React, CSS, chunks, worker de recherche, Loro Wasm, manifeste et service worker produits |
| Contrats d'artefacts Bun | 18/18 tests ciblés réussis, dont proxy HTTP/WebSocket |
| PWA hors ligne | première charge, worker prêt, coupure réseau puis rechargement réussis dans la matrice navigateur |
| Images `linux/amd64` et `linux/arm64` | builds réussis avec les bases épinglées |
| Smoke natif de l'image API | Bun `1.4.0`, migration et serveur chargeables, arrêt et code d'échec contrôlés |
| Compose | topologie `postgres`, `migrate`, `api`, `web` valide ; aucun sidecar Draw.io/collaboration |

Le build Web ne précache aucune réponse `/v1` ou `/health`. Le runtime Web reste
nginx ; seul son builder utilise Bun. L'image API est non privilégiée et ne
contient pas de runtime Node.js distinct.

## Tests et non-régression

### Couverture Istanbul

Le fournisseur V8 historique n'est pas comparable à Istanbul : il comptait
différemment les branches implicites. La référence V8 de `main` était de
90,18 % de statements, 85,14 % de branches, 93,58 % de fonctions et 90,18 % de
lignes. Le premier corpus complet Istanbul sert donc de budget absolu maximal
de code non couvert :

| Mesure | Budget maximal non couvert | Dernier résultat | Statut |
| --- | ---: | ---: | --- |
| Statements | 2 216 | 2 207 / 17 746, soit 87,56 % | PASS |
| Branches | 2 465 | 2 460 / 12 179, soit 79,80 % | PASS |
| Fonctions | 337 | 335 / 3 319, soit 89,90 % | PASS |
| Lignes | 1 866 | 1 858 / 16 709, soit 88,88 % | PASS |

Le corpus complet de couverture a exécuté 301 fichiers et 3 160 tests avec
succès. Une augmentation d'un budget non couvert fait échouer la gate.

### Suites spécialisées

| Suite | Résultat observé |
| --- | --- |
| Performance sans instrumentation | 7 fichiers, 18 tests réussis et budgets respectés |
| Intégration PostgreSQL | 331 tests réussis |
| Migrations | 11 tests réussis |
| Contrats API/workspace | 108 fichiers et 1 227 tests réussis |
| Sauvegarde historique `v1-schema1.tar` | 1/1 : contrôles de compatibilité et restauration de tout le contenu canonique réussis |
| Format, lint, types et shell | réussite ; 9 workspaces typés |
| Audit, secrets, analyse statique, licences et Compose | réussite |

L'archive `v1-schema1.tar` reste volontairement au format canonique 1. Le
générateur courant produit le format canonique 2 ; son exécution n'est donc pas
une attente d'identité binaire. La preuve de rétrocompatibilité est la lecture
et la restauration inchangées de l'ancienne archive.

## Matrice navigateur

La première exécution complète a validé Chromium desktop, WebKit desktop,
Chromium mobile et WebKit mobile. Firefox s'est arrêté avant l'application car
le conteneur officiel ne possédait pas `unzip`, requis par l'installation de
Bun. Le lanceur installe désormais cet outil système lorsqu'il manque et monte
la clé de déploiement isolée de la pile.

La relance ciblée documentée
`bun run test:e2e:gate -- --project=firefox-desktop` a ensuite réussi. Les cinq
profils ont donc chacun passé le corpus. La porte T048 a ensuite relancé cette
matrice entière avant push.

La première CI de la PR #150 a ensuite exposé une mesure Firefox instable : le
contenu distant était correct, mais le chrono de propagation comptait le focus
Playwright et la saisie séquentielle de toute la phrase. Il a mesuré 2 141 ms,
puis 2 166 ms au retry, contre le budget de 2 000 ms. Le seuil produit n'a pas
été relevé. Le chrono démarre désormais à la dernière frappe réelle ; il couvre
toujours la fenêtre calme de l'éditeur, la durabilité locale, l'échange
WebSocket Bun et la projection distante.

La correction a réussi 10/10 répétitions Firefox dans le conteneur Linux, avec
948 ms au premier échantillon textuel et un maximum de 1 074 ms sur les trente
mesures texte/formatage/déplacement. La matrice ciblée a ensuite réussi sur les
cinq profils en parallèle en 73 secondes.

La première relance de la porte a ensuite exposé une saturation du harnais de
performance : les budgets exécutés étaient verts, mais sept fichiers lourds
avaient ouvert assez de threads pour faire expirer les RPC Vitest `fetch` et
`onTaskUpdate`. Le test annonçait alors à tort son timeout de 600 secondes après
54 secondes. Une tentative à deux workers a supprimé l'expiration RPC, mais a
fait dépasser de 13,7 Mio le budget mémoire du benchmark de page parce qu'il
concurrençait la fixture de base structurée. Les commandes complètes et
affectées utilisent donc le worker unique déjà déclaré par
`REALTIME_REFERENCE_MACHINE`. Les familles CI restent parallèles, mais les
benchmarks d'un même runner ne se faussent plus mutuellement. Les budgets
produit sont inchangés.

La porte suivante a confirmé que le dernier aléa restant venait de la politique
de collecte de JavaScriptCore : dans un processus frais, le benchmark de page
terminait correctement mais variait entre 518,8 et 555,4 Mio de croissance de
heap selon la mémoire disponible, contre le plafond inchangé de 512 Mio. Le
projet de performance démarre désormais avec le profil Bun `--smol`, prévu pour
collecter plus souvent sur une machine contrainte. Le profil ne concerne aucun
autre projet, ne relève aucun budget et garde les mesures de temps réelles. La
mesure force aussi une collecte uniquement entre les phases chronométrées et
borne le pic de heap encore vivant. Elle ne dépend ainsi plus d'un pic d'objets
déjà libérables que JavaScriptCore aurait choisi de collecter quelques
millisecondes plus tôt ou plus tard.

Trois processus frais ont ensuite mesuré respectivement 162,7 Mio, 178,9 Mio
et 137,0 Mio de croissance maximale du heap vivant. La suite complète, dans son
ordre réel, a réussi ses 7 fichiers et 18 tests en 160 secondes avec 179,3 Mio
sur le scénario de page ; les budgets d'ingestion, rattrapage, compaction,
recherche, base structurée, sauvegarde et WebSocket sont tous restés verts.

La CI suivante a exposé deux limites supplémentaires du harnais, sans régression
du produit :

- dans WebKit mobile, le second contexte isolé rechargeait le graphe Vite à
  froid et franchissait le délai générique de 10 secondes quelques instants
  avant l'apparition réelle de `workspace-shell`. La trace montrait le shell
  présent et en phase `initializing`, sans 404 ni échec d'API. Seule l'attente
  initiale du shell dispose désormais de 30 secondes ; toutes les assertions
  fonctionnelles restent à 10 secondes. Le scénario exact de révocation a
  réussi 3/3 répétitions, puis les 237 parcours WebKit mobile ont réussi dans la
  matrice complète ;
- après la grosse fixture de base structurée, Vitest pouvait encore annoncer à
  tort le timeout de 600 secondes du benchmark de page après environ 69
  secondes, sur une expiration RPC du worker. Le même fichier dans un processus
  neuf terminait en 36 secondes. Le wrapper conserve donc un seul PostgreSQL
  jetable, mais lance un coordinateur Vitest neuf pour chacun des sept fichiers.
  Les budgets et le worker unique sont inchangés.

Trois suites complètes successives avec cette isolation ont réussi leurs 7
fichiers et 18 tests. Le benchmark de 10 000 mises à jour de page a mesuré
respectivement 127,9 Mio, 137,5 Mio puis 155,3 Mio de croissance maximale du
heap vivant, toujours très sous le plafond inchangé de 512 Mio.

## Convergence Speckit

`$speckit-converge` n'a trouvé aucune exigence fonctionnelle ou technique sans
tâche correspondante. Les preuves finales, la porte locale, la PR et la CI sont
déjà suivies par T015, T026, T038, T043–T050 ; aucune tâche dupliquée n'a été
ajoutée.

## Porte candidate

Le commit exécutable candidat est
`de22b00e244fcc7a16ba651d4476a558fb7caa7d`. Le seul diff préparé après ce
commit est ce journal ; il ne modifie aucun fichier exécutable. La porte a été
exécutée sur cet arbre final avant le prochain push.

Commande exécutée exactement :

```sh
bun run checks:local
```

**Résultat**: PASS, code de sortie 0.

- couverture : 301 fichiers et 3 160 tests réussis sous Istanbul ; budgets
  absolus respectés ;
- performance : 7 fichiers et 18 tests réussis, dont 10 000 mises à jour de
  page avec 155,3 Mio de croissance maximale du heap vivant ;
- intégration et migrations : 331 puis 11 tests réussis ;
- contrats API/workspace : 108 fichiers et 1 227 tests réussis, dont 90 jours
  hors ligne et 10 000 changements distants ;
- Playwright : Chromium desktop 257, Firefox desktop 241, WebKit desktop 241,
  Chromium mobile 246 et WebKit mobile 237 tests réussis ; les exclusions
  propres aux profils restent respectivement 0, 16, 16, 11 et 20 ; 5/5 profils
  réussis en 1 614 secondes avec deux piles simultanées ;
- builds API/Web, PWA, images API/Web `linux/amd64` et `linux/arm64`, smoke API
  Bun 1.4.0 sans runtime Node autonome, audit, secrets, analyse statique,
  licences et contrat Compose : PASS.

## Livraison de la PR dédiée

La PR #150 a passé toutes ses gates sur le candidat Bun puis a été fusionnée
dans `main` au commit `dff719e71b77c3e244e49794d93aed331907227a`.
T049 est donc terminée. La CI de ce premier push `main` a ensuite échoué sur une
course WebKit mobile du dialogue `/lien`, indépendante de la chaîne Bun et
suivie par T274 de la feature 017. T050 reste volontairement ouverte jusqu'à ce
que cette correction soit fusionnée, que la CI complète de `main` soit verte et
que les images commit-addressable correspondantes soient publiées.
