# Tasks: Applications Desktop Electron Windows, macOS et Linux

**Input**: Design documents from `/specs/014-desktop-clients/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: Inclus, car les exigences de la feature imposent des tests unitaires,
de contrat, Playwright et des smoke tests installés sur les trois systèmes.

**Séquence** : prochain travail. Ne pas démarrer 021 / 017 T319 / 022 T040 avant
ces tâches, sauf correctif bloquant sur `main`. Toolchain : Bun 1.4.0 uniquement.

## Phase 1: Setup

**Purpose**: Ajouter le package desktop et rendre le toolchain reproductible.

- [X] T001 Documenter l’installation Bun du workspace desktop et le layout `node_modules` requis par Electron Forge dans `docs/development.md` et `apps/desktop/package.json`, sans réintroduire pnpm, npm ni Yarn.
- [X] T002 Créer le package `@myownnotion/desktop` et ses scripts `dev`, `build`, `package`, `make`, `publish` dans `apps/desktop/package.json`.
- [X] T003 [P] Épingler Electron, Electron Forge, les makers Windows (Squirrel/WiX), macOS (DMG) et Linux (AppImage, deb, rpm) et leurs types dans `apps/desktop/package.json`, puis régénérer `bun.lock` avec Bun 1.4.0.
- [X] T004 [P] Créer les configurations TypeScript et Vite séparées du processus principal et du preload dans `apps/desktop/tsconfig.json`, `apps/desktop/vite.main.config.ts` et `apps/desktop/vite.preload.config.ts`.
- [X] T005 [P] Ajouter les scripts racine filtrés `desktop:dev`, `desktop:build`, `desktop:make` et `desktop:smoke` dans `package.json`.
- [X] T006 [P] Ajouter les checks de présence, version et artefact desktop dans `scripts/ci/check-desktop.ts` et les référencer dans `scripts/ci/check-toolchain.ts`.

## Phase 2: Foundational

**Purpose**: Poser les contrats partagés, la frontière de sécurité et la
construction du shell avant tout parcours utilisateur.

**⚠️ CRITICAL**: Aucune user story ne commence avant la validation de cette phase.

- [X] T007 Définir le profil runtime Web/desktop et la détection feature-safe dans `apps/web/src/runtime/client-runtime.ts` et `apps/web/src/runtime/client-runtime.d.ts`.
- [X] T008 Adapter `ContentApi` et `SecurityApi` pour utiliser le profil runtime validé tout en conservant le mode same-origin du navigateur dans `apps/web/src/services/content-api.ts` et `apps/web/src/services/security-api.ts`.
- [X] T009 [P] Extraire l’interface `SecureKeyStorage` sans dépendance Electron dans `packages/client-core/src/security/secure-key-storage.ts` et couvrir le contrat dans `packages/client-core/tests/secure-key-storage.contract.spec.ts`.
- [X] T010 [P] Définir les schémas TypeScript des messages IPC, capacités natives et résultats redacted dans `apps/desktop/src/ipc-contract.ts` selon `contracts/desktop-runtime.md`.
- [X] T011 Créer la fenêtre principale, le preload et la validation du sender avec `nodeIntegration: false`, `contextIsolation: true` et `sandbox: true` dans `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts` et `apps/desktop/src/ipc.ts`.
- [X] T012 Créer le protocole local, la CSP, l’allowlist de navigation et le blocage des frames/URLs non prévues dans `apps/desktop/src/protocol.ts` et `apps/desktop/src/navigation-policy.ts`.
- [X] T013 [P] Configurer Forge, `asar`, `prune`, l’absence de binaire universel et l’inclusion des assets `apps/web/dist` pour un seul `platform`/`arch` par job dans `apps/desktop/forge.config.ts`, sans activer encore la publication.
- [X] T014 [P] Ajouter le typage global du bridge et le fallback navigateur dans `apps/web/src/types/desktop-runtime.d.ts` et `apps/web/src/main.tsx`.
- [X] T015 Construire le harness de tests Electron, fixtures de profil et serveur local HTTPS contrôlé dans `apps/desktop/tests/setup/desktop-fixtures.ts` et `apps/desktop/tests/setup/test-server.ts`.
- [X] T016 [P] Ajouter le workflow CI de validation desktop sans publication dans `.github/workflows/desktop-ci.yml`, avec build Web, build desktop de la plateforme du runner, tests et scan de secrets, sur Windows, macOS et Linux.

**Checkpoint**: Le shell local démarre avec une fenêtre isolée, aucun accès
Electron brut n’est exposé au rendu, et le rendu Web peut fonctionner avec ou
sans bridge desktop.

## Phase 3: User Story 1 — Installer et connecter le client desktop (Priority: P1) 🎯 MVP

**Goal**: Installer un client, choisir un serveur, vérifier le canal/protocole
et retrouver un profil autorisé après redémarrage.

**Independent Test**: Installer le build de test, saisir une URL locale puis
HTTPS distante, se connecter, redémarrer et vérifier les refus attendus.

### Tests for User Story 1

- [X] T017 [P] [US1] Ajouter les tests unitaires de normalisation d’URL, HTTP local, HTTP non local et protocole incompatible dans `apps/desktop/tests/server-profile-policy.spec.ts`.
- [X] T018 [P] [US1] Ajouter le test de contrat IPC du profil serveur, de la persistance et de l’absence de jeton dans `apps/desktop/tests/profile-ipc.contract.spec.ts`.
- [X] T019 [US1] Ajouter le parcours Playwright onboarding → connexion → ouverture d’une page → redémarrage dans `tests/e2e/desktop-onboarding.spec.ts`.
- [X] T020 [P] [US1] Ajouter les cas Playwright URL HTTP non locale, serveur inaccessible et protocole incompatible dans `tests/e2e/desktop-connection-errors.spec.ts`.

### Implementation for User Story 1

- [X] T021 [US1] Implémenter la validation et la persistance des `DesktopServerProfile` dans `apps/desktop/src/server-profiles.ts` et `apps/desktop/src/profile-store.ts`.
- [X] T022 [US1] Ajouter l’onboarding de profil serveur et les états de connexion dans `apps/web/src/features/connection/desktop-connection-page.tsx` et `apps/web/src/features/connection/connection-status.tsx`.
- [X] T023 [US1] Injecter le profil actif dans l’instanciation de `ContentApi` et `SecurityApi` dans `apps/web/src/app.tsx` et `apps/web/src/services/client-factory.ts`.
- [X] T024 [US1] Préserver la session Electron dans une partition persistante liée au profil sans mélanger deux origines dans `apps/desktop/src/session-partition.ts`.
- [X] T025 [US1] Afficher l’état `compatible`, `read-only`, `incompatible`, `unreachable` ou `insecure` avant les écritures dans `apps/web/src/features/connection/connection-status.tsx`.
- [X] T026 [US1] Ajouter le smoke test de premier lancement et d’ouverture de workspace dans `apps/desktop/tests/desktop-smoke.spec.ts`.

**Checkpoint**: Le desktop est un MVP installable qui atteint les parcours
existants d’authentification/workspace et refuse explicitement les connexions
dangereuses ou incompatibles.

## Phase 4: User Story 2 — Travailler hors ligne avec des données protégées (Priority: P1)

**Goal**: Protéger la clé locale par l’OS, conserver projection/outbox/conflits
après redémarrage et respecter la révocation sans perte silencieuse.

**Independent Test**: Modifier hors ligne, fermer brutalement, relancer,
reconnecter, résoudre un conflit contrôlé et révoquer l’appareil.

### Tests for User Story 2

- [X] T027 [P] [US2] Ajouter les tests de disponibilité, verrouillage, effacement et refus fail-closed de la clé native dans `apps/desktop/tests/native-key-storage.spec.ts`.
- [X] T028 [P] [US2] Ajouter les tests de round-trip chiffrement et d’absence de plaintext dans `packages/client-core/tests/desktop-key-storage.integration.spec.ts`.
- [X] T029 [US2] Ajouter le parcours Playwright offline → édition → fermeture forcée → reprise dans `tests/e2e/desktop-offline-restart.spec.ts`.
- [X] T030 [P] [US2] Ajouter le parcours Playwright révocation/déconnexion qui conserve l’outbox et bloque la prochaine écriture protégée dans `tests/e2e/desktop-device-revocation.spec.ts`.
- [X] T031 [P] [US2] Ajouter le test d’interruption/reprise de migration du coffre dans `apps/desktop/tests/vault-migration.spec.ts`.

### Implementation for User Story 2

- [X] T032 [US2] Implémenter l’enveloppe de clé via `safeStorage` asynchrone et les états de plateforme dans `apps/desktop/src/native-key-storage.ts` et `apps/desktop/src/key-state.ts`.
- [X] T033 [US2] Implémenter le bridge `wrapDeviceKey`/`unwrapDeviceKey` et son adaptateur dans `apps/desktop/src/preload.ts`, `apps/desktop/src/ipc.ts` et `apps/web/src/services/desktop-key-storage.ts`.
- [X] T034 [US2] Brancher l’adaptateur desktop sur le contrat `SecureKeyStorage` sans importer Electron dans `packages/client-core/src/security/device-key-binding.ts` et `apps/web/src/services/local-key-storage.ts`.
- [X] T035 [US2] Isoler le profil de données local et les migrations versionnées dans `apps/desktop/src/vault-profile.ts` et `apps/desktop/src/vault-migrations.ts`.
- [X] T036 [US2] Exposer les états de coffre verrouillé, indisponible, révoqué et les actions de récupération dans `apps/web/src/features/security/desktop-vault-status.tsx`.
- [X] T037 [US2] Ajouter les diagnostics expurgés des erreurs de clé, stockage, réseau et synchronisation dans `apps/desktop/src/diagnostics.ts` et `apps/web/src/features/security/desktop-diagnostics.tsx`.

**Checkpoint**: Le client desktop tient sa promesse local-first et ne dégrade
jamais une clé ou un contenu protégé en stockage clair.

## Phase 5: User Story 3 — Profiter d’une intégration desktop prévisible (Priority: P2)

**Goal**: Fournir fenêtre, single-instance, raccourcis, fichiers et liens
externes avec une surface native explicitement contrôlée.

**Independent Test**: Lancer deux instances, restaurer la fenêtre, choisir un
fichier, ouvrir un lien approuvé et refuser un lien dangereux au clavier.

### Tests for User Story 3

- [X] T038 [P] [US3] Ajouter les tests de contrat des capacités `choose-file`, `save-file`, `open-external` et `window-state` dans `apps/desktop/tests/native-capabilities.contract.spec.ts`.
- [X] T039 [P] [US3] Ajouter les tests de blocage des navigations, redirections, frames et schémas non autorisés dans `apps/desktop/tests/security-boundary.spec.ts`.
- [X] T040 [US3] Ajouter le parcours Playwright clavier/focus des menus, fenêtre, import de fichier et lien externe dans `tests/e2e/desktop-native-journey.spec.ts`.
- [X] T041 [P] [US3] Ajouter le smoke test single-instance et restauration de bounds dans `apps/desktop/tests/window-lifecycle.spec.ts`.

### Implementation for User Story 3

- [X] T042 [US3] Implémenter la coordination single-instance, l’activation de la fenêtre et les événements de cycle de vie dans `apps/desktop/src/main.ts` et `apps/desktop/src/single-instance.ts`.
- [X] T043 [US3] Implémenter la persistance atomique de `WindowState` avec validation des écrans et moniteurs dans `apps/desktop/src/window-state.ts`.
- [X] T044 [US3] Implémenter menus, raccourcis, dialogues de fichier et drag-and-drop via capacités typées dans `apps/desktop/src/native-capabilities.ts` et `apps/desktop/src/menu.ts`.
- [X] T045 [US3] Implémenter la politique d’ouverture externe et le blocage des schémas non sûrs dans `apps/desktop/src/external-links.ts`.
- [X] T046 [US3] Vérifier que les écrans onboarding, workspace, sécurité et mise à jour gardent les règles de focus/clavier dans `apps/web/src/styles.css`, `apps/web/src/app.tsx` et `tests/e2e/desktop-accessibility.spec.ts`.

## Phase 6: User Story 4 — Recevoir une mise à jour sans perdre le travail (Priority: P2)

**Goal**: Vérifier, reporter, installer ou restaurer une mise à jour sans
écraser le coffre, l’outbox, les conflits ou la compatibilité serveur.

**Independent Test**: Passer de N à N+1 avec une mutation hors ligne, puis
simuler un manifeste invalide, un téléchargement interrompu et un démarrage
échoué.

### Tests for User Story 4

- [X] T047 [P] [US4] Ajouter les tests de validation du manifeste, version, architecture, HTTPS, empreinte et fenêtre de protocole dans `apps/desktop/tests/update-manifest.spec.ts`.
- [X] T048 [P] [US4] Ajouter les tests de la machine d’états `UpdateState` et des décisions outbox/migration dans `apps/desktop/tests/update-state.spec.ts`.
- [X] T049 [US4] Ajouter le parcours Playwright disponible → différée → prête à installer dans `tests/e2e/desktop-update-journey.spec.ts`.
- [X] T050 [P] [US4] Ajouter les tests d’échec, reprise et rollback qui comparent les identités et mutations du coffre dans `apps/desktop/tests/update-recovery.spec.ts`.

### Implementation for User Story 4

- [X] T051 [US4] Implémenter le parseur/validateur du manifeste selon `contracts/update-manifest.md` dans `apps/desktop/src/update-manifest.ts`.
- [X] T052 [US4] Implémenter la machine d’états de mise à jour et les événements redacted dans `apps/desktop/src/updates.ts`.
- [X] T053 [US4] Brancher `autoUpdater`/Forge au processus principal avec téléchargement reportable, vérification et redémarrage explicite dans `apps/desktop/src/updates.ts` et `apps/desktop/forge.config.ts`.
- [X] T054 [US4] Ajouter les garde-fous de migration/rollback du coffre dans `apps/desktop/src/vault-migrations.ts` et `packages/client-core/src/security/local-key-state.ts`.
- [X] T055 [US4] Construire l’écran d’état de mise à jour, compatibilité serveur et protection des changements en attente dans `apps/web/src/features/update/desktop-update-panel.tsx`.

## Phase 7: User Story 5 — Installer des artefacts de confiance (Priority: P3)

**Goal**: Produire les installateurs des cinq cibles (Windows x64, Windows
ARM64, macOS ARM64, Linux x64 et ARM64 en AppImage, deb et rpm), les vérifier
sur runners natifs et les attacher à la GitHub Release, sans store.

**Independent Test**: Générer chaque artefact depuis un tag, vérifier checksum
et signature, installer sur la plateforme correspondante et exécuter le smoke
test complet.

### Tests for User Story 5

- [X] T056 [P] [US5] Ajouter les tests statiques des cinq cibles, des noms d’installateurs (dont AppImage/deb/rpm Linux), du refus macOS Intel / store / paquet universel dans `tests/contract/desktop-release-artifacts.spec.ts`.
- [X] T057 [P] [US5] Ajouter le test de scan des secrets de signature et de publication dans `tests/contract/desktop-release-secrets.spec.ts`.
- [X] T058 [US5] Ajouter les scripts de smoke install/restart/offline/update pour les runners natifs dans `scripts/desktop/run-installed-smoke.ts` et `scripts/desktop/fixtures/README.md`.

### Implementation for User Story 5

- [X] T059 [US5] Configurer Squirrel ou WiX Windows (x64 et ARM64), DMG macOS ARM, et AppImage plus deb plus rpm Linux, filtrés par runner, dans `apps/desktop/forge.config.ts`.
- [X] T060 [US5] Vérifier tous les fichiers de la matrice, empreintes, absence de runtime étranger et refus de tout fichier hors matrice dans `scripts/ci/check-desktop-artifacts.ts`.
- [X] T061 [US5] Ajouter le workflow de release natif des cinq cibles (dont `windows-11-arm` et `macos-14`) dans `.github/workflows/desktop-release.yml`.
- [X] T062 [US5] Publier uniquement les fichiers de la matrice après le gate du tag, sur la GitHub Release, sans store, dans `.github/workflows/desktop-release.yml` et `scripts/ci/publish-desktop-release.ts`.
- [X] T063 [US5] Documenter l’installation, les canaux, les prérequis de signature, le support plateforme et la récupération dans `docs/deployment/desktop.md`.

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Fermer les preuves de qualité, la documentation et les contrôles
transversaux avant convergence.

- [X] T064 [P] Ajouter les parcours d’accessibilité et de sécurité desktop aux projets Playwright dans `playwright.config.ts` et `tests/e2e/accessibility.spec.ts`.
- [X] T065 [P] Ajouter les benchmarks de lancement, IPC et reprise de coffre dans `apps/desktop/tests/desktop-performance.spec.ts`.
- [X] T066 [P] Mettre à jour `docs/development.md` avec les commandes Bun, le runner natif requis et la procédure de test sans secrets.
- [X] T067 [P] Créer `specs/014-desktop-clients/validation.md` avec une preuve par FR/SC pour les cibles et formats publiés et les éventuelles exceptions approuvées.
- [X] T068 Vérifier la couverture des artefacts par `spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `contracts/` et `quickstart.md` dans `scripts/ci/check-desktop.ts`.
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
- La validation des cinq cibles OS+architecture de US5 est parallélisable sur runners natifs, mais la publication reste séquentielle après T060.

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

## Phase 9: Convergence

- [X] T070 CRITICAL Remplacer le bundling Vite desktop par Bun dans `apps/desktop/`, les hooks Forge et `scripts/desktop/dev.ts` selon Constitution VII (contradicts).
- [X] T071 CRITICAL Valider les arguments IPC et l'identité exacte de la fenêtre/frame, refuser les navigations vers les données serveur et les ressources exécutables distantes dans `apps/desktop/src/{ipc,main,protocol-register,navigation-policy}.ts` selon FR-009 et SC-009 (partial).
- [X] T072 CRITICAL Utiliser le coffre OS asynchrone, refuser le backend Linux non protégé et isoler les enveloppes par profil dans `apps/desktop/src/native-key-storage.ts`; vérifier les transactions durables de l'adaptateur dans `apps/web/src/services/desktop-key-storage.ts` selon FR-003, FR-006 et FR-007 (partial).
- [ ] T073 Brancher une vérification réelle des mises à jour autorisées, un téléchargement vérifié et une installation avec préservation du coffre/outbox dans `apps/desktop/src/updates.ts`, `ipc.ts` et le panneau Web selon FR-011, FR-012 et SC-006 (partial).
- [ ] T074 Remplacer les parcours Electron et le smoke installé qui ne vérifient actuellement que l'onboarding ou des fonctions de politique par des scénarios réels de connexion, édition hors ligne, interruption, révocation et mise à jour dans `tests/e2e/desktop-*.spec.ts` et `scripts/desktop/run-installed-smoke.ts` selon FR-015 et SC-001 à SC-006 (partial).
- [ ] T075 Vérifier les signatures des artefacts produits, la notarisation, l'architecture et les empreintes publiées; produire les manifests de mise à jour dans `.github/workflows/desktop-release.yml` et `scripts/ci/` selon FR-013, FR-016 et SC-007 (partial).
- [ ] T076 Exécuter les gates desktop sur PR et main, les rendre bloquants et documenter leurs équivalents locaux dans `.github/workflows/desktop-ci.yml`, `.github/workflows/ci.yml` et `docs/development.md` selon Constitution III/VII et FR-015 (partial).
- [X] T077 Rendre atomiques et effectives la restauration de fenêtre/page, la gestion du coffre et les erreurs expurgées dans `apps/desktop/src/`; corriger les preuves trop fortes de `validation.md` selon FR-003, FR-008, FR-010 et FR-012 (partial).
- [X] T078 Reject sessions belonging to revoked devices on every authenticated HTTP request, including ordinary content reads; verify revocation after offline edits without deleting encrypted outbox records. Regression exposed by the real desktop revocation journey; shared server fix supports FR-009/FR-010 of feature 002 and the desktop revocation acceptance scenario.

- [X] T079 Recover memory-only CSRF authorization after a cold offline restart and wake queued content/page synchronization when connectivity returns; prove recovery through the real Electron offline restart journey in `tests/e2e/desktop-offline-restart.spec.ts` without persisting the token.
- [X] T080 Propagate the session CSRF token to resumable file uploads in `apps/web/src/features/files/upload.ts`, refuse foreign upload destinations, and authenticate standalone API test setup in `tests/e2e/fixtures.ts`; rerun the complete browser matrix after the authenticated HTTP gate exposed these missing callers.
- [X] T081 Align the connection form with existing authentication surfaces, recover from rejected native profile writes, and make verified Linux AppImages owner-executable with accurate handoff guidance in `apps/web/src/features/connection/desktop-connection-page.tsx` and `apps/desktop/src/{updates,update-download}.ts`.
- [X] T082 Preserve the safe device revocation diagnosis for an otherwise verified live session without granting a principal in `apps/api/src/security/`; prove both ordinary HTTP refusal and the existing browser change-stream revocation journey.
- [X] T083 Restrict deferred WebSocket authentication to the registered page-sync socket route in `apps/api/src/security/realtime-authorization.ts`; prove that an Upgrade header cannot bypass authentication or CSRF on ordinary HTTP routes and that native live page synchronization still connects.
- [X] T084 Preserve the final Web authentication client and wait for native profile resolution before opening the authenticated workspace in `apps/web/src/app.tsx`; prove cold live connection, closed-page queue drainage, connected edits, revocation and visual shell states through the existing browser journeys, plus delayed native-profile unit coverage in `apps/web/tests/app-routing.spec.tsx`.
- [X] T085 Replace the Bun-incompatible legacy DMG addon chain with a Forge maker using macOS `ditto` and `hdiutil` in `apps/desktop/makers/dmg.ts`; verify clean frozen installs, actual DMG creation/mounting and preserved app contents through `apps/desktop/tests/dmg-maker.spec.ts`.

- [X] T086 Resolve internal page navigation from the committed local record instead of a stale rendered tree in `apps/web/src/features/hierarchy/page-link-target.ts` and `hierarchy-explorer.tsx`; prove the immediate slash-created child opens with focused title in the existing browser journey after the Firefox parity matrix exposed the race.

- [X] T087 Keep native vault warnings and diagnostics specific to the desktop bridge, handle rejected key-state IPC without leaking native errors, and restore the existing mobile Web security reference in `apps/web/src/features/security/desktop-{vault-status,diagnostics}.tsx`.

- [ ] T088 Correct native CI fixture setup in `.github/workflows/desktop-ci.yml` and `scripts/ci/prepare-windows-postgres.ts`: use the existing Compose PostgreSQL on Linux and Windows system bsdtar for drive-letter archives; validate both runner architectures without skipping native journeys.
- [X] T089 Preserve a live window throughout profile partition replacement in `apps/desktop/src/main.ts`, avoiding the Windows/Linux last-window quit policy; assert no all-windows-closed event during real onboarding in `tests/e2e/desktop-onboarding.spec.ts`.

- [X] T090 Preserve pending page scroll restoration across presentation-state refreshes in `apps/web/src/features/editor/` and verify real mobile navigation plus cancellation before the first animation frame; exposed by the full browser parity CI.

- [X] T091 Exercise database property entry with real keyboard input and assert the visible draft before saving in `tests/e2e/databases-offline-sync.spec.ts`; retain the strict second-device persistence and offline merge checks after WebKit CI submitted an empty Owner draft.

- [X] T092 Normalize native glob path separators when checking required web assets in `apps/web/build-assets.ts`; cover POSIX and Windows paths, absent asset classes and misleading source maps in `apps/web/tests/build-assets.spec.ts`. Both Windows CI architectures exposed the same production-build refusal before their native journeys; renewed native CI proof remains part of T088/T076.

- [ ] T093 Validate owner-only Windows ACLs for the native journey server's deployment key in `apps/api/src/security/`, prepare the ephemeral key with an explicit private ACL in `scripts/e2e/`, and exercise allowed/refused ACLs in desktop policy tests. Windows does not represent POSIX 0600 permissions; preserve strict private-key validation and guarded migration instead of skipping either boundary.

- [ ] T094 Terminate the complete disposable Electron process tree during a Windows crash fixture and await shutdown before reusing/removing its profile in `tests/e2e/desktop-electron.ts`; retain the real durable offline restart and revocation assertions and recheck all native platforms.
