# Tasks: Applications Desktop Electron Windows et macOS

**Input**: Design documents from `/specs/014-desktop-clients/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: Inclus, car les exigences de la feature imposent des tests unitaires,
de contrat, Playwright et des smoke tests installés sur les deux plateformes.

**Séquence** : prochain travail. Ne pas démarrer 021 / 017 T319 / 022 T040 avant
ces tâches, sauf correctif bloquant sur `main`. Toolchain : Bun 1.4.0 uniquement.

## Phase 1: Setup

**Purpose**: Ajouter le package desktop et rendre le toolchain reproductible.

- [ ] T001 Documenter l’installation Bun du workspace desktop et le layout `node_modules` requis par Electron Forge dans `docs/development.md` et `apps/desktop/package.json`, sans réintroduire pnpm, npm ni Yarn.
- [ ] T002 Créer le package `@myownnotion/desktop` et ses scripts `dev`, `build`, `package`, `make`, `publish` dans `apps/desktop/package.json`.
- [ ] T003 [P] Épingler Electron, Electron Forge, les makers Windows/macOS et leurs types dans `apps/desktop/package.json`, puis régénérer `bun.lock` avec Bun 1.4.0.
- [ ] T004 [P] Créer les configurations TypeScript et Vite séparées du processus principal et du preload dans `apps/desktop/tsconfig.json`, `apps/desktop/vite.main.config.ts` et `apps/desktop/vite.preload.config.ts`.
- [ ] T005 [P] Ajouter les scripts racine filtrés `desktop:dev`, `desktop:build`, `desktop:make` et `desktop:smoke` dans `package.json`.
- [ ] T006 [P] Ajouter les checks de présence, version et artefact desktop dans `scripts/ci/check-desktop.ts` et les référencer dans `scripts/ci/check-toolchain.ts`.

## Phase 2: Foundational

**Purpose**: Poser les contrats partagés, la frontière de sécurité et la
construction du shell avant tout parcours utilisateur.

**⚠️ CRITICAL**: Aucune user story ne commence avant la validation de cette phase.

- [ ] T007 Définir le profil runtime Web/desktop et la détection feature-safe dans `apps/web/src/runtime/client-runtime.ts` et `apps/web/src/runtime/client-runtime.d.ts`.
- [ ] T008 Adapter `ContentApi` et `SecurityApi` pour utiliser le profil runtime validé tout en conservant le mode same-origin du navigateur dans `apps/web/src/services/content-api.ts` et `apps/web/src/services/security-api.ts`.
- [ ] T009 [P] Extraire l’interface `SecureKeyStorage` sans dépendance Electron dans `packages/client-core/src/security/secure-key-storage.ts` et couvrir le contrat dans `packages/client-core/tests/secure-key-storage.contract.spec.ts`.
- [ ] T010 [P] Définir les schémas TypeScript des messages IPC, capacités natives et résultats redacted dans `apps/desktop/src/ipc-contract.ts` selon `contracts/desktop-runtime.md`.
- [ ] T011 Créer la fenêtre principale, le preload et la validation du sender avec `nodeIntegration: false`, `contextIsolation: true` et `sandbox: true` dans `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts` et `apps/desktop/src/ipc.ts`.
- [ ] T012 Créer le protocole local, la CSP, l’allowlist de navigation et le blocage des frames/URLs non prévues dans `apps/desktop/src/protocol.ts` et `apps/desktop/src/navigation-policy.ts`.
- [ ] T013 [P] Configurer Forge, `asar` et l’inclusion des assets `apps/web/dist` pour le build local dans `apps/desktop/forge.config.ts`, sans activer encore la publication.
- [ ] T014 [P] Ajouter le typage global du bridge et le fallback navigateur dans `apps/web/src/types/desktop-runtime.d.ts` et `apps/web/src/main.tsx`.
- [ ] T015 Construire le harness de tests Electron, fixtures de profil et serveur local HTTPS contrôlé dans `apps/desktop/tests/setup/desktop-fixtures.ts` et `apps/desktop/tests/setup/test-server.ts`.
- [ ] T016 [P] Ajouter le workflow CI de validation desktop sans publication dans `.github/workflows/desktop-ci.yml`, avec build Web, build desktop, tests et scan de secrets.

**Checkpoint**: Le shell local démarre avec une fenêtre isolée, aucun accès
Electron brut n’est exposé au rendu, et le rendu Web peut fonctionner avec ou
sans bridge desktop.

## Phase 3: User Story 1 — Installer et connecter le client desktop (Priority: P1) 🎯 MVP

**Goal**: Installer un client, choisir un serveur, vérifier le canal/protocole
et retrouver un profil autorisé après redémarrage.

**Independent Test**: Installer le build de test, saisir une URL locale puis
HTTPS distante, se connecter, redémarrer et vérifier les refus attendus.

### Tests for User Story 1

- [ ] T017 [P] [US1] Ajouter les tests unitaires de normalisation d’URL, HTTP local, HTTP non local et protocole incompatible dans `apps/desktop/tests/server-profile-policy.spec.ts`.
- [ ] T018 [P] [US1] Ajouter le test de contrat IPC du profil serveur, de la persistance et de l’absence de jeton dans `apps/desktop/tests/profile-ipc.contract.spec.ts`.
- [ ] T019 [US1] Ajouter le parcours Playwright onboarding → connexion → ouverture d’une page → redémarrage dans `tests/e2e/desktop-onboarding.spec.ts`.
- [ ] T020 [P] [US1] Ajouter les cas Playwright URL HTTP non locale, serveur inaccessible et protocole incompatible dans `tests/e2e/desktop-connection-errors.spec.ts`.

### Implementation for User Story 1

- [ ] T021 [US1] Implémenter la validation et la persistance des `DesktopServerProfile` dans `apps/desktop/src/server-profiles.ts` et `apps/desktop/src/profile-store.ts`.
- [ ] T022 [US1] Ajouter l’onboarding de profil serveur et les états de connexion dans `apps/web/src/features/connection/desktop-connection-page.tsx` et `apps/web/src/features/connection/connection-status.tsx`.
- [ ] T023 [US1] Injecter le profil actif dans l’instanciation de `ContentApi` et `SecurityApi` dans `apps/web/src/app.tsx` et `apps/web/src/services/client-factory.ts`.
- [ ] T024 [US1] Préserver la session Electron dans une partition persistante liée au profil sans mélanger deux origines dans `apps/desktop/src/session-partition.ts`.
- [ ] T025 [US1] Afficher l’état `compatible`, `read-only`, `incompatible`, `unreachable` ou `insecure` avant les écritures dans `apps/web/src/features/connection/connection-status.tsx`.
- [ ] T026 [US1] Ajouter le smoke test de premier lancement et d’ouverture de workspace dans `apps/desktop/tests/desktop-smoke.spec.ts`.

**Checkpoint**: Le desktop est un MVP installable qui atteint les parcours
existants d’authentification/workspace et refuse explicitement les connexions
dangereuses ou incompatibles.

## Phase 4: User Story 2 — Travailler hors ligne avec des données protégées (Priority: P1)

**Goal**: Protéger la clé locale par l’OS, conserver projection/outbox/conflits
après redémarrage et respecter la révocation sans perte silencieuse.

**Independent Test**: Modifier hors ligne, fermer brutalement, relancer,
reconnecter, résoudre un conflit contrôlé et révoquer l’appareil.

### Tests for User Story 2

- [ ] T027 [P] [US2] Ajouter les tests de disponibilité, verrouillage, effacement et refus fail-closed de la clé native dans `apps/desktop/tests/native-key-storage.spec.ts`.
- [ ] T028 [P] [US2] Ajouter les tests de round-trip chiffrement et d’absence de plaintext dans `packages/client-core/tests/desktop-key-storage.integration.spec.ts`.
- [ ] T029 [US2] Ajouter le parcours Playwright offline → édition → fermeture forcée → reprise dans `tests/e2e/desktop-offline-restart.spec.ts`.
- [ ] T030 [P] [US2] Ajouter le parcours Playwright révocation/déconnexion qui conserve l’outbox et bloque la prochaine écriture protégée dans `tests/e2e/desktop-device-revocation.spec.ts`.
- [ ] T031 [P] [US2] Ajouter le test d’interruption/reprise de migration du coffre dans `apps/desktop/tests/vault-migration.spec.ts`.

### Implementation for User Story 2

- [ ] T032 [US2] Implémenter l’enveloppe de clé via `safeStorage` asynchrone et les états de plateforme dans `apps/desktop/src/native-key-storage.ts` et `apps/desktop/src/key-state.ts`.
- [ ] T033 [US2] Implémenter le bridge `wrapDeviceKey`/`unwrapDeviceKey` et son adaptateur dans `apps/desktop/src/preload.ts`, `apps/desktop/src/ipc.ts` et `apps/web/src/services/desktop-key-storage.ts`.
- [ ] T034 [US2] Brancher l’adaptateur desktop sur le contrat `SecureKeyStorage` sans importer Electron dans `packages/client-core/src/security/device-key-binding.ts` et `apps/web/src/services/local-key-storage.ts`.
- [ ] T035 [US2] Isoler le profil de données local et les migrations versionnées dans `apps/desktop/src/vault-profile.ts` et `apps/desktop/src/vault-migrations.ts`.
- [ ] T036 [US2] Exposer les états de coffre verrouillé, indisponible, révoqué et les actions de récupération dans `apps/web/src/features/security/desktop-vault-status.tsx`.
- [ ] T037 [US2] Ajouter les diagnostics expurgés des erreurs de clé, stockage, réseau et synchronisation dans `apps/desktop/src/diagnostics.ts` et `apps/web/src/features/security/desktop-diagnostics.tsx`.

**Checkpoint**: Le client desktop tient sa promesse local-first et ne dégrade
jamais une clé ou un contenu protégé en stockage clair.

## Phase 5: User Story 3 — Profiter d’une intégration desktop prévisible (Priority: P2)

**Goal**: Fournir fenêtre, single-instance, raccourcis, fichiers et liens
externes avec une surface native explicitement contrôlée.

**Independent Test**: Lancer deux instances, restaurer la fenêtre, choisir un
fichier, ouvrir un lien approuvé et refuser un lien dangereux au clavier.

### Tests for User Story 3

- [ ] T038 [P] [US3] Ajouter les tests de contrat des capacités `choose-file`, `save-file`, `open-external` et `window-state` dans `apps/desktop/tests/native-capabilities.contract.spec.ts`.
- [ ] T039 [P] [US3] Ajouter les tests de blocage des navigations, redirections, frames et schémas non autorisés dans `apps/desktop/tests/security-boundary.spec.ts`.
- [ ] T040 [US3] Ajouter le parcours Playwright clavier/focus des menus, fenêtre, import de fichier et lien externe dans `tests/e2e/desktop-native-journey.spec.ts`.
- [ ] T041 [P] [US3] Ajouter le smoke test single-instance et restauration de bounds dans `apps/desktop/tests/window-lifecycle.spec.ts`.

### Implementation for User Story 3

- [ ] T042 [US3] Implémenter la coordination single-instance, l’activation de la fenêtre et les événements de cycle de vie dans `apps/desktop/src/main.ts` et `apps/desktop/src/single-instance.ts`.
- [ ] T043 [US3] Implémenter la persistance atomique de `WindowState` avec validation des écrans et moniteurs dans `apps/desktop/src/window-state.ts`.
- [ ] T044 [US3] Implémenter menus, raccourcis, dialogues de fichier et drag-and-drop via capacités typées dans `apps/desktop/src/native-capabilities.ts` et `apps/desktop/src/menu.ts`.
- [ ] T045 [US3] Implémenter la politique d’ouverture externe et le blocage des schémas non sûrs dans `apps/desktop/src/external-links.ts`.
- [ ] T046 [US3] Vérifier que les écrans onboarding, workspace, sécurité et mise à jour gardent les règles de focus/clavier dans `apps/web/src/styles.css`, `apps/web/src/app.tsx` et `tests/e2e/desktop-accessibility.spec.ts`.

## Phase 6: User Story 4 — Recevoir une mise à jour sans perdre le travail (Priority: P2)

**Goal**: Vérifier, reporter, installer ou restaurer une mise à jour sans
écraser le coffre, l’outbox, les conflits ou la compatibilité serveur.

**Independent Test**: Passer de N à N+1 avec une mutation hors ligne, puis
simuler un manifeste invalide, un téléchargement interrompu et un démarrage
échoué.

### Tests for User Story 4

- [ ] T047 [P] [US4] Ajouter les tests de validation du manifeste, version, architecture, HTTPS, empreinte et fenêtre de protocole dans `apps/desktop/tests/update-manifest.spec.ts`.
- [ ] T048 [P] [US4] Ajouter les tests de la machine d’états `UpdateState` et des décisions outbox/migration dans `apps/desktop/tests/update-state.spec.ts`.
- [ ] T049 [US4] Ajouter le parcours Playwright disponible → différée → prête à installer dans `tests/e2e/desktop-update-journey.spec.ts`.
- [ ] T050 [P] [US4] Ajouter les tests d’échec, reprise et rollback qui comparent les identités et mutations du coffre dans `apps/desktop/tests/update-recovery.spec.ts`.

### Implementation for User Story 4

- [ ] T051 [US4] Implémenter le parseur/validateur du manifeste selon `contracts/update-manifest.md` dans `apps/desktop/src/update-manifest.ts`.
- [ ] T052 [US4] Implémenter la machine d’états de mise à jour et les événements redacted dans `apps/desktop/src/updates.ts`.
- [ ] T053 [US4] Brancher `autoUpdater`/Forge au processus principal avec téléchargement reportable, vérification et redémarrage explicite dans `apps/desktop/src/updates.ts` et `apps/desktop/forge.config.ts`.
- [ ] T054 [US4] Ajouter les garde-fous de migration/rollback du coffre dans `apps/desktop/src/vault-migrations.ts` et `packages/client-core/src/security/local-key-state.ts`.
- [ ] T055 [US4] Construire l’écran d’état de mise à jour, compatibilité serveur et protection des changements en attente dans `apps/web/src/features/update/desktop-update-panel.tsx`.

## Phase 7: User Story 5 — Installer des artefacts de confiance (Priority: P3)

**Goal**: Produire des artefacts installables et traçables pour Windows x64,
macOS x64 et macOS arm64, puis les vérifier sur runners natifs.

**Independent Test**: Générer chaque artefact depuis un tag, vérifier checksum
et signature, installer sur la plateforme correspondante et exécuter le smoke
test complet.

### Tests for User Story 5

- [ ] T056 [P] [US5] Ajouter les tests statiques de matrice de plateformes, noms d’artefacts, version, checksum et provenance dans `tests/contract/desktop-release-artifacts.spec.ts`.
- [ ] T057 [P] [US5] Ajouter le test de scan des secrets de signature et de publication dans `tests/contract/desktop-release-secrets.spec.ts`.
- [ ] T058 [US5] Ajouter les scripts de smoke install/restart/offline/update pour les runners natifs dans `scripts/desktop/run-installed-smoke.ts` et `scripts/desktop/fixtures/README.md`.

### Implementation for User Story 5

- [ ] T059 [US5] Configurer les makers Squirrel Windows, DMG et ZIP macOS, les identifiants d’application, les métadonnées et les architectures dans `apps/desktop/forge.config.ts`.
- [ ] T060 [US5] Ajouter la vérification d’artefacts, signatures, empreintes et provenance dans `scripts/ci/check-desktop-artifacts.ts`.
- [ ] T061 [US5] Ajouter le workflow de release natif Windows/macOS, les secrets d’environnement et les permissions minimales dans `.github/workflows/desktop-release.yml`.
- [ ] T062 [US5] Publier les manifests et artefacts uniquement après le gate exact du tag dans `.github/workflows/desktop-release.yml` et `scripts/ci/publish-desktop-release.ts`.
- [ ] T063 [US5] Documenter l’installation, les canaux, les prérequis de signature, le support plateforme et la récupération dans `docs/deployment/desktop.md`.

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Fermer les preuves de qualité, la documentation et les contrôles
transversaux avant convergence.

- [ ] T064 [P] Ajouter les parcours d’accessibilité et de sécurité desktop aux projets Playwright dans `playwright.config.ts` et `tests/e2e/accessibility.spec.ts`.
- [ ] T065 [P] Ajouter les benchmarks de lancement, IPC et reprise de coffre dans `apps/desktop/tests/desktop-performance.spec.ts`.
- [ ] T066 [P] Mettre à jour `docs/development.md` avec les commandes Bun, le runner natif requis et la procédure de test sans secrets.
- [ ] T067 [P] Créer `specs/014-desktop-clients/validation.md` avec une preuve par FR/SC, les trois architectures et les éventuelles exceptions approuvées.
- [ ] T068 Vérifier la couverture des artefacts par `spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `contracts/` et `quickstart.md` dans `scripts/ci/check-desktop.ts`.
- [ ] T069 Exécuter `bun run checks:local`, les tests Playwright desktop et le quickstart complet, puis reporter les résultats dans `specs/014-desktop-clients/validation.md`.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: aucune dépendance; prépare le package, le lockfile et le toolchain.
- **Foundational (Phase 2)**: dépend de Setup et bloque toutes les user stories.
- **US1 (Phase 3)**: dépend de Phase 2; constitue le MVP connectable.
- **US2 (Phase 4)**: dépend de US1 pour le profil/session, puis peut être validée indépendamment sur le coffre.
- **US3 (Phase 5)**: dépend de Phase 2; peut être développée en parallèle de US2 après stabilisation du bridge.
- **US4 (Phase 6)**: dépend de US2 pour la migration/outbox et de Phase 1 pour Forge.
- **US5 (Phase 7)**: dépend de US1–US4 et des secrets/runners de release; publication en dernier.
- **Polish (Phase 8)**: dépend de toutes les stories ciblées.

### User Story Dependencies

- **US1**: Phase 2 uniquement; MVP.
- **US2**: US1 pour associer profil, session et device; le cœur client existant reste la source de vérité.
- **US3**: Phase 2 uniquement, avec intégration du profil actif de US1.
- **US4**: US2 pour conserver coffre/outbox; US1 pour la compatibilité serveur.
- **US5**: US1–US4 pour rendre les smoke tests significatifs.

### Parallel Opportunities

- T003–T006 peuvent être travaillées en parallèle après T002.
- T007, T009, T010, T013 et T014 peuvent être travaillées en parallèle avant T011/T012.
- Les tests T017/T018/T020, T027/T028/T030/T031, T038/T039/T041 et T047/T048/T050 sont parallélisables par fichiers.
- Après le checkpoint Phase 2, US3 peut progresser en parallèle de US2; US1 doit fournir le profil/runtime avant l’intégration finale.
- La validation des trois architectures de US5 est parallélisable sur runners natifs, mais la publication reste séquentielle après T060.

## Implementation Strategy

### MVP First (US1 only)

1. Compléter Setup et Foundational.
2. Implémenter US1: installation de test, profil serveur, connexion et reprise.
3. Valider le smoke test et les refus de sécurité.
4. **STOP AND VALIDATE**: démontrer le client installé avant d’ajouter stockage natif et auto-update.

### Incremental Delivery

1. Ajouter US2 et obtenir un client desktop offline-first avec coffre protégé.
2. Ajouter US3 et fermer la surface d’intégration native.
3. Ajouter US4 et tester les migrations/rollback.
4. Ajouter US5 et publier uniquement après smoke/signature/provenance.
5. Exécuter convergence et compléter les preuves avant pull request.

### Format Validation

Tous les items sont au format checklist `- [ ]`, possèdent un identifiant
séquentiel `T###`, utilisent `[P]` uniquement pour les tâches parallélisables,
portent `[USn]` dans les phases de user story et citent au moins un chemin de
fichier concret.
