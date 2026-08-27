# Validation: Chaîne d'outils unifiée sous Bun 1.4

**Date**: 2026-08-27

**Branche**: `codex/019-bun-1-4-toolchain`

**Runtime validé**: Bun `1.4.0` exactement

**Commit exécutable candidat**: `2a1acf93a98030c7abbf1cb84e11613f9a55c81c`

Ce journal rassemble les preuves reproductibles de la migration. Les données,
le schéma PostgreSQL et le protocole de synchronisation restent inchangés.

## Outillage et installation

| Preuve | Résultat |
| --- | --- |
| `bun --version` | `1.4.0` |
| Deux installations `bun ci` consécutives | réussite ; aucun changement du verrouillage |
| SHA-256 de `bun.lock` après chaque installation | `9dce3d6e335a1e5d280f8f037f8743b0fa76d1fd11f269ee76d22efa58ff9c44` |
| `bun run toolchain:check` | réussite ; 1 122 fichiers suivis contrôlés |
| Lockfiles actifs | `bun.lock` uniquement |
| Workspaces vérifiés par TypeScript | 9/9 |
| Runtime autonome dans l'image API | Bun `1.4.0`; aucun Node.js autonome |

Les smokes de développement et la matrice navigateur démarrent l'API, Vite et
les scripts avec Bun. La présence éventuelle de Node ou pnpm sur l'hôte n'est
pas utilisée par les commandes du dépôt. L'alias `node` fourni par l'image Bun
officielle est accepté uniquement lorsqu'il résout vers le même exécutable que
`bun`.

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
| Statements | 2 216 | 2 211 / 17 751, soit 87,54 % | PASS |
| Branches | 2 465 | 2 462 / 12 183, soit 79,79 % | PASS |
| Fonctions | 337 | 337 / 3 321, soit 89,85 % | PASS |
| Lignes | 1 866 | 1 862 / 16 714, soit 88,85 % | PASS |

Le corpus complet de couverture a exécuté 300 fichiers et 3 154 tests avec
succès. Une augmentation d'un budget non couvert fait échouer la gate.

### Suites spécialisées

| Suite | Résultat observé |
| --- | --- |
| Performance sans instrumentation | 7 fichiers, 18 tests réussis et budgets respectés |
| Intégration PostgreSQL | 331 tests réussis |
| Migrations | 11 tests réussis |
| Contrats API/workspace | 1 217 tests réussis avant l'ajout des 4 cas déterministes de route ; relance ciblée Bun 18/18 réussie |
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
profils ont donc chacun passé le corpus. T048 relancera la matrice entière dans
la porte exacte avant push.

## Convergence Speckit

`$speckit-converge` n'a trouvé aucune exigence fonctionnelle ou technique sans
tâche correspondante. Les preuves finales, la porte locale, la PR et la CI sont
déjà suivies par T015, T026, T038, T043–T050 ; aucune tâche dupliquée n'a été
ajoutée.

## Porte candidate

Le commit exécutable candidat est
`2a1acf93a98030c7abbf1cb84e11613f9a55c81c`. Le seul diff préparé après ce
commit est ce résultat de validation et la fermeture de T048 ; il ne modifie
aucun fichier exécutable. La porte est exécutée sur cet arbre final avant de
créer le commit de preuve.

Commande lancée le 2026-08-27 à 16:32 CEST :

```sh
bun run checks:local
```

**Résultat**: PASS — toutes les étapes obligatoires de `docs/development.md`,
y compris la matrice complète des cinq profils navigateur et les images
multiarchitecture, ont terminé avec un code nul. Aucun gate n'a été ignoré ou
désactivé.
