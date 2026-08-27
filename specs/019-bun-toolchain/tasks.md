---

description: "Tâches d'implémentation de la chaîne d'outils unifiée sous Bun 1.4"

---

# Tasks: Chaîne d'outils unifiée sous Bun 1.4

**Input**: Design documents from `/specs/019-bun-toolchain/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: La spécification exige explicitement des preuves d'installation
verrouillée, de runtime, de build, de PWA hors ligne, de WebSocket, de CI,
d'images multiarchitecture, de sécurité et de non-régression. Les contrats et
tests ciblés précèdent donc les changements qu'ils protègent.

**Organization**: Les fondations fixent le contrat Bun exact et les tests de
politique. Les quatre stories couvrent ensuite le parcours contributeur, les
artefacts de production, les portes de livraison, puis la documentation de la
rupture. La migration est atomique : chaque story peut être prouvée isolément
sur la branche, mais aucune coexistence pnpm/Node n'est livrée sur `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: tâche parallélisable dans des fichiers distincts une fois les
  prérequis de sa phase terminés
- **[Story]**: user story couverte par la tâche
- Toute tâche cite les fichiers qu'elle crée ou modifie

## Phase 1: Setup — contrat et graphe Bun

**Purpose**: Établir l'unique version, workspace et verrouillage avant de
modifier les commandes qui en dépendent.

- [x] T001 Écrire les contrats en échec pour la version Bun exacte, le lockfile unique, la résolution `ws` intégrée, les métadonnées retirées et les commandes interdites dans `tests/contract/bun-toolchain.spec.ts`
- [x] T002 Déclarer Bun 1.4.0, les workspaces et l'exécution forcée sous Bun dans `package.json` et `bunfig.toml`
- [x] T003 Réconcilier les dépendances de migration dans `package.json`, `apps/api/package.json` et `apps/web/package.json`, puis générer l'unique `bun.lock`
- [x] T004 Retirer les artefacts de l'ancienne chaîne dans `pnpm-lock.yaml`, `pnpm-workspace.yaml` et `.npmrc` après vérification de leur remplacement

---

## Phase 2: Foundations — politique et commandes partagées

**Purpose**: Rendre les invariants vérifiables et convertir les orchestrateurs
communs avant les parcours applicatifs.

**⚠️ CRITICAL**: Les stories ne sont validables qu'après le contrôle de version
et la conversion des scripts transversaux.

- [x] T005 Implémenter le contrôle de version exacte, lockfile unique, métadonnées et commandes actives interdites dans `scripts/ci/check-toolchain.ts`
- [x] T006 [P] Adapter les fixtures et assertions de politique de chaîne d'outils dans `tests/contract/toolchain-editor-dependencies.spec.ts` et `tests/contract/bun-toolchain.spec.ts`
- [x] T007 Convertir les commandes racine et tous les manifestes workspace à l'orchestration Bun dans `package.json`, `apps/api/package.json`, `apps/web/package.json`, `packages/blob-store/package.json`, `packages/client-core/package.json`, `packages/contracts/package.json`, `packages/database/package.json`, `packages/domain/package.json`, `packages/page-state/package.json` et `packages/test-utils/package.json`
- [x] T008 [P] Convertir les lanceurs TypeScript transversaux dans `scripts/ci/build-images.ts`, `scripts/ci/check-compose.ts`, `scripts/ci/check-release-gate.ts`, `scripts/ci/license-policy.ts`, `scripts/ci/run-affected-vitest.ts`, `scripts/ci/scan-secrets.ts`, `scripts/ci/static-security.ts`, `scripts/ci/test-impact.ts`, `scripts/db/migrate.ts`, `scripts/e2e/run-local-matrix.ts` et `scripts/fixtures/generate-reference-backups.ts`
- [x] T009 [P] Convertir les lanceurs shell et leurs politiques vers Bun dans `scripts/test-e2e-local.sh`, `scripts/test-e2e-firefox-container.sh`, `scripts/ci/smoke-api-image.sh` et `scripts/ci/check-shell.ts`

**Checkpoint**: `bun run toolchain:check` refuse toute réintroduction active et
les scripts partagés ne lancent plus l'ancien runtime ou gestionnaire.

---

## Phase 3: User Story 1 — Préparer et lancer le dépôt avec un seul outil (Priority: P1) 🎯 MVP

**Goal**: Installer, vérifier et lancer les applications depuis un clone propre
avec Bun 1.4.0 seulement.

**Independent Test**: Utiliser un `PATH` sans Node/pnpm, exécuter deux fois
`bun ci`, comparer `bun.lock`, puis lancer API et Web avec rechargement et proxy
HTTP/WebSocket.

### Tests for User Story 1

- [x] T010 [P] [US1] Ajouter les probes d'installation figée, hash stable et version incorrecte dans `tests/contract/bun-toolchain.spec.ts`
- [x] T011 [P] [US1] Étendre le contrat du proxy de développement HTTP/WebSocket lancé sous Bun dans `tests/contract/realtime-proxy.spec.ts`

### Implementation for User Story 1

- [x] T012 [US1] Faire échouer rapidement les commandes avec une version Bun différente et exposer les commandes canoniques d'installation, développement, migration et administration dans `package.json` et `scripts/ci/check-toolchain.ts`
- [x] T013 [P] [US1] Passer le serveur API de développement au watch natif Bun dans `apps/api/package.json`
- [x] T014 [P] [US1] Conserver Vite uniquement comme serveur de développement sous Bun avec HMR et proxy same-origin HTTP/WebSocket dans `apps/web/package.json` et `apps/web/vite.config.ts`
- [x] T015 [US1] Exécuter l'installation figée deux fois, les contrôles d'outillage et un smoke des deux serveurs sans Node/pnpm, puis consigner la preuve dans `specs/019-bun-toolchain/validation.md`

**Checkpoint**: Un contributeur n'a besoin que de Bun 1.4.0 pour préparer et
lancer le dépôt ; les outils éventuellement présents sur l'hôte sont sans
effet.

---

## Phase 4: User Story 2 — Compiler et exécuter les artefacts de production avec Bun (Priority: P1)

**Goal**: Produire le client Web/PWA et les trois entrées API avec Bun, puis les
exécuter dans des images sans Node côté API.

**Independent Test**: Compiler deux fois, inspecter toutes les références,
charger le Web hors ligne avec son worker, démarrer l'API et construire les
images amd64/arm64.

### Tests for User Story 2

- [x] T016 [P] [US2] Écrire les contrats en échec de l'inventaire API/Web, des références worker/Wasm/PWA et du runtime d'image dans `tests/contract/bun-production-artifacts.spec.ts`
- [x] T017 [P] [US2] Ajouter le test de résolution de l'URL du worker sous build Bun et développement Vite dans `apps/web/tests/search-service.spec.ts`
- [x] T018 [P] [US2] Étendre les contrats d'artefacts publiés et d'images épinglées à Bun dans `tests/contract/release-artifacts.spec.ts` et `tests/contract/compose-security.spec.ts`

### Implementation for User Story 2

- [x] T019 [US2] Implémenter le bundle Bun déterministe et relogeable (dont Loro Wasm) des entrées serveur, migration et administration dans `apps/api/build.ts` et `apps/api/package.json`
- [x] T020 [US2] Implémenter la compilation séparée et l'URL injectée du worker de recherche dans `apps/web/build.ts`, `apps/web/src/services/search.ts` et `apps/web/vite.config.ts`
- [x] T021 [US2] Compiler HTML, React, Tailwind, imports dynamiques et Loro Wasm avec Bun dans `apps/web/build.ts`, `apps/web/index.html` et `apps/web/package.json`
- [x] T022 [US2] Produire le manifeste et le service worker Workbox, puis limiter son enregistrement à la production dans `apps/web/manifest.webmanifest`, `apps/web/src/service-worker.ts`, `apps/web/src/main.tsx` et `apps/web/build.ts`
- [x] T023 [P] [US2] Migrer l'image API builder/runtime vers Bun 1.4.0 épinglé, non privilégié et sans Node dans `docker/api.Dockerfile` et `docker/base-images.json`
- [x] T024 [P] [US2] Migrer uniquement le builder Web vers Bun et conserver le runtime nginx durci dans `docker/web.Dockerfile` et `docker/base-images.json`
- [x] T025 [US2] Adapter la construction, le smoke runtime, le healthcheck, les signaux et l'inventaire d'images dans `scripts/ci/build-images.ts`, `scripts/ci/smoke-api-image.sh`, `compose.yaml` et `compose.override.yaml`
- [x] T026 [US2] Exécuter les builds répétés, les contrats d'artefacts, le parcours PWA hors ligne, le WebSocket API et les images natives/multiarchitecture, puis consigner la preuve dans `specs/019-bun-toolchain/validation.md`

**Checkpoint**: Les artefacts livrés proviennent de Bun ; l'API de production
fonctionne sans Node et le Web reste utilisable après une première charge hors
ligne.

---

## Phase 5: User Story 3 — Conserver toutes les preuves de qualité et de livraison (Priority: P1)

**Goal**: Garder chaque gate bloquante et le même inventaire de CI en lançant
les outils spécialisés sous Bun.

**Independent Test**: Exécuter les familles ciblées, la porte locale complète,
puis la CI de PR ; chaque job requis doit utiliser Bun exact et remonter son
vrai code d'échec.

### Tests for User Story 3

- [x] T027 [P] [US3] Écrire les contrats en échec de l'action Bun, de l'absence de cache externe de dépendances, de `bun ci`, des 18 jobs et des dépendances de publication dans `tests/contract/bun-quality-gate.spec.ts` et `tests/contract/release-gates.spec.ts`
- [x] T028 [P] [US3] Étendre les tests full/affected/no-impact aux commandes Bun sans changer les sélections dans `tests/contract/test-impact.spec.ts`
- [x] T029 [P] [US3] Créer un helper de vrai listener/socket éphémère et ses tests de fermeture dans `apps/api/tests/helpers/real-websocket.ts` et `apps/api/tests/helpers/real-websocket.spec.ts`

### Implementation for User Story 3

- [x] T030 [US3] Remplacer la couverture V8 par Istanbul sans changer le périmètre de fichiers et traduire les pourcentages incomparables en budget absolu de non-régression documenté dans `vitest.config.ts`, `package.json`, `docs/development.md` et `specs/019-bun-toolchain/plan.md`
- [x] T031 [US3] Remplacer `app.injectWS()` par le helper réseau réel et adapter le cycle upgrade/authentification au module `ws` intégré à Bun avec file pré-authentification bornée dans `apps/api/src/app.ts`, `apps/api/src/routes/installation.ts`, `apps/api/src/routes/page-sync-socket.ts`, `apps/api/src/realtime/pending-authentication-frames.ts`, `apps/api/tests/pending-authentication-frames.spec.ts`, `apps/api/tests/realtime-page-sync.contract.spec.ts`, `apps/api/tests/realtime-page-sync-security.contract.spec.ts` et `apps/api/tests/realtime-device-revocation.integration.spec.ts`
- [x] T032 [US3] Convertir le plan d'impact et l'exécution Vitest sélectionnée vers Bun dans `ci/test-impact.json`, `scripts/ci/test-impact.ts` et `scripts/ci/run-affected-vitest.ts`
- [x] T033 [P] [US3] Ajouter l'action composite Bun exacte avec cache intégré du binaire seulement et installation `bun ci` dans `.github/actions/setup-bun/action.yml`
- [x] T034 [US3] Migrer chaque job JavaScript de PR vers l'action Bun, sans affaiblir concurrence, timeouts, artefacts ni inventaire, dans `.github/workflows/ci.yml`
- [x] T035 [US3] Migrer publication et preuve de commit exact vers Bun dans `.github/workflows/release.yml`
- [x] T036 [P] [US3] Adapter l'audit de production et la politique de licences aux sorties Bun dans `package.json` et `scripts/ci/license-policy.ts`
- [x] T037 [US3] Faire de `bun run checks:local` l'unique porte complète, bornée et bloquante dans `package.json`, `scripts/e2e/run-local-matrix.ts` et `docs/development.md`
- [x] T038 [US3] Exécuter en parallèle les familles indépendantes format/lint/types, unités-couverture, intégration, contrats et performance ; isoler les gros benchmarks par coordinateur Vitest neuf sans relever leurs budgets ; corriger toute incompatibilité Bun sans changer les attentes et consigner les preuves dans `specs/019-bun-toolchain/validation.md`

**Checkpoint**: La nouvelle chaîne donne au minimum les mêmes preuves qu'avant
et aucune étape absente, sautée ou annulée ne peut rendre le gate vert.

---

## Phase 6: User Story 4 — Comprendre la rupture et les commandes actuelles (Priority: P2)

**Goal**: Rendre la migration à sens unique compréhensible et supprimer toute
procédure active qui orienterait encore vers l'ancienne chaîne.

**Independent Test**: Suivre la documentation depuis un clone propre puis
rechercher toute commande historique exécutable dans les surfaces maintenues.

### Tests for User Story 4

- [x] T039 [P] [US4] Ajouter au contrat d'outillage les surfaces documentaires actives et les exceptions de prose historique dans `tests/contract/bun-toolchain.spec.ts`

### Implementation for User Story 4

- [x] T040 [US4] Documenter prérequis, installation, développement, tests parallèles, gate, build et diagnostic Bun dans `docs/development.md`
- [x] T041 [P] [US4] Mettre à jour le démarrage rapide, l'état des grandes étapes et les commandes opérateur dans `README.md`
- [x] T042 [P] [US4] Mettre à jour les procédures actives de déploiement, sauvegarde, architecture et desktop dans `docs/deployment/reverse-proxy.md`, `docs/architecture/README.md`, `docs/architecture/backup.md` et `specs/014-desktop-clients/quickstart.md`
- [x] T043 [US4] Tracer la rupture et l'état de livraison dans `docs/product/product-canvas.md`, `docs/product/roadmap.md`, `specs/019-bun-toolchain/quickstart.md` et `specs/019-bun-toolchain/validation.md`
- [x] T044 [US4] Exécuter les contrôles documentaires et la recherche des commandes historiques actives, puis consigner les exceptions justifiées dans `specs/019-bun-toolchain/validation.md`

**Checkpoint**: Une seule procédure courante existe et elle ne suppose aucun
outil supprimé.

---

## Phase 7: Polish and cross-cutting validation

**Purpose**: Fermer la compatibilité produit, Spec Kit et les gates de livraison
avant la PR.

- [x] T045 Vérifier une installation existante et les sauvegardes de référence sans migration de schéma/protocole avec `scripts/fixtures/generate-reference-backups.ts` et les suites existantes, puis consigner le résultat dans `specs/019-bun-toolchain/validation.md`
- [x] T046 Exécuter intégralement `specs/019-bun-toolchain/quickstart.md`, notamment le démarrage sans Node, le build, Compose, le PWA offline et l'administration, puis compléter `specs/019-bun-toolchain/validation.md`
- [x] T047 Exécuter `$speckit-converge`, ajouter toute tâche réellement manquante à `specs/019-bun-toolchain/tasks.md` et fermer chaque ajout
- [x] T048 Exécuter `bun run checks:local` exactement selon `docs/development.md` et enregistrer le commit candidat et le résultat dans `specs/019-bun-toolchain/validation.md`
- [x] T049 Pousser `codex/019-bun-1-4-toolchain`, ouvrir la PR dédiée et vérifier toutes les gates sur le commit candidat
- [ ] T050 Corriger tout échec sans désactiver de gate, fusionner la PR verte et vérifier la CI complète ainsi que les images commit-addressable de `main`

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: démarre immédiatement et produit le graphe Bun.
- **Foundations (Phase 2)**: dépend de T002–T004 ; bloque les quatre stories.
- **US1 (Phase 3)**: dépend des fondations et prouve le poste contributeur.
- **US2 (Phase 4)**: dépend du graphe Bun ; ses tests T016–T018 peuvent être
  écrits en parallèle de US1, mais le smoke final dépend des scripts convertis.
- **US3 (Phase 5)**: dépend des commandes canoniques US1 et des builds US2 pour
  la porte complète ; ses contrats et le helper socket peuvent commencer après
  Foundations.
- **US4 (Phase 6)**: dépend des noms de commandes stabilisés par US1–US3.
- **Polish (Phase 7)**: dépend de toutes les stories.

### User story completion order

~~~text
Setup + Foundations
        │
        ├──────────────┐
        ▼              ▼
US1 local/dev      US2 production
        └──────┬───────┘
               ▼
        US3 quality/CI
               │
               ▼
        US4 documentation
               │
               ▼
      convergence + full gate + PR
~~~

## Parallel opportunities

- Les contrats US1, US2 et US3 marqués `[P]` touchent des fichiers distincts
  et peuvent être préparés ensemble après Foundations.
- Les builds API et Web peuvent être développés séparément après stabilisation
  de `bun.lock` ; les images attendent leurs deux sorties.
- Le helper WebSocket et Istanbul sont indépendants du build Web.
- Les familles format/lint/types, couverture, intégration, contrats et
  performance peuvent être lancées simultanément pour le feedback ; la porte
  finale conserve l'ordonnancement et les limites PostgreSQL/Playwright de
  `docs/development.md`.
- La documentation README, architecture et déploiement peut être corrigée en
  parallèle après stabilisation des commandes.

## Implementation strategy

1. Faire échouer les contrats de politique et d'artefacts pour les raisons
   attendues.
2. Basculer le graphe et les scripts communs une seule fois.
3. Valider le développement local, puis les builds et images séparément.
4. Adapter les harnais incompatibles sans toucher à la logique applicative.
5. Migrer CI et documentation seulement après stabilisation des commandes.
6. Lancer les familles indépendantes en parallèle, puis la porte locale
   canonique complète avant tout push.
7. Converger Spec Kit, pousser la PR dédiée, corriger la CI sans exemption et
   fusionner uniquement le candidat vert.

## Notes

- Les adaptations prévues se limitent au build Web/PWA, au harnais de trois
  tests WebSocket et au pont upgrade/authentification exigé par le module `ws`
  intégré à Bun 1.4.0 ; elles ne constituent pas une refonte du produit.
- Les imports `node:*` compatibles sont des API Bun et ne signifient pas qu'un
  processus Node est autorisé.
- Vite demeure un serveur de développement spécialisé, jamais le compilateur
  de production.
- Les cases ne sont cochées qu'après preuve correspondante ; un outil requis
  indisponible reste bloquant.
