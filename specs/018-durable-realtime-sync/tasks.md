---

description: "Tâches d'implémentation de la synchronisation éditoriale temps réel durable"

---

# Tasks: Synchronisation éditoriale temps réel durable

**Input**: Design documents from `/specs/018-durable-realtime-sync/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: La spécification exige explicitement tests de propriétés,
intégration, contrats, migration, fault injection, multi-contextes navigateur,
sécurité, restauration et performance. Les tâches de test précèdent donc
l'implémentation correspondante et doivent échouer pour la raison attendue avant
la correction.

**Organization**: Les contrats et limites partagés sont fondationnels. Les cinq
phases utilisateur suivent ensuite l'ordre du risque produit : propagation
connectée, convergence hors ligne, durabilité sous panne, auto-réparation des
anciens navigateurs, puis sécurité/restauration.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: tâche parallélisable dans des fichiers distincts une fois les
  prérequis de sa phase terminés
- **[Story]**: user story couverte par la tâche
- Toute tâche cite les fichiers qu'elle crée ou modifie

## Phase 1: Setup — dépendance et gates

**Purpose**: Ajouter uniquement le support réseau nécessaire et le faire entrer
dans les politiques reproductibles avant d'activer un endpoint.

- [X] T001 Ajouter `@fastify/websocket` 11.3.x à l'API avec pnpm et verrouiller sa résolution dans `apps/api/package.json` et `pnpm-lock.yaml`
- [X] T002 [P] Étendre la politique de licence et le contrat de dépendances au plugin MIT, sans client collaboratif ni service externe, dans `scripts/ci/license-policy.ts` et `tests/contract/toolchain-editor-dependencies.spec.ts`

---

## Phase 2: Foundations — contrats, limites et notification après commit

**Purpose**: Fixer les enveloppes et l'unique signal d'avancement avant les
implémentations serveur et navigateur.

**⚠️ CRITICAL**: Aucun échange WebSocket de contenu ne commence avant validation
des schémas bornés et du principe « annonce après commit ».

- [X] T003 [P] Écrire les tests TypeBox de tous les messages, versions, identités corrélées, propriétés inconnues et limites d'octets dans `packages/contracts/tests/realtime-page-sync.spec.ts`
- [X] T004 Implémenter constantes, schémas, parseurs et types du protocole temps réel dans `packages/contracts/src/realtime-page-sync.ts` et `packages/contracts/src/index.ts`
- [X] T005 [P] Créer un faux WebSocket déterministe avec coupures et frames différées pour les tests Web dans `apps/web/tests/support/fake-websocket.ts`
- [X] T006 [P] Écrire les tests d'abonnement, désabonnement, isolation des sockets et publication post-commit dans `apps/api/tests/page-advance-notifier.spec.ts`
- [X] T007 Implémenter le notifier éphémère typé `pageId/latestPageSequence`, indépendant de la réponse auteur, dans `apps/api/src/realtime/page-advance-notifier.ts`

**Checkpoint**: Les messages invalides sont refusés avant le domaine et une
annonce ne peut représenter qu'un état serveur déjà durable.

---

## Phase 3: User Story 1 — Voir les changements connectés immédiatement (Priority: P1) 🎯 MVP

**Goal**: Deux appareils connectés voient la même page évoluer en moins de deux
secondes par une connexion persistante, sans reload ni faux conflit.

**Independent Test**: Ouvrir la même page dans deux profils autorisés, écrire,
formater et déplacer alternativement ; mesurer la propagation et vérifier
l'absence de remplacement complet.

### Tests for User Story 1

- [X] T008 [P] [US1] Écrire les tests API du handshake, `hello/ready`, requêtes corrélées, réponse après commit et `page-advanced` dans `apps/api/tests/realtime-page-sync.contract.spec.ts`
- [X] T009 [P] [US1] Écrire les tests client de multiplexage, corrélation, timeout et notification de page avec le faux socket dans `apps/web/tests/realtime-page-sync-transport.spec.ts`
- [X] T010 [P] [US1] Écrire les tests d'intégration du transport dans les réconciliateurs et du drain des pages ouvertes dans `apps/web/tests/local-content-realtime-sync.spec.ts`
- [X] T011 [P] [US1] Écrire le journey à deux contextes connectés et la mesure de latence dans `tests/e2e/realtime-page-sync.spec.ts`

### Implementation for User Story 1

- [X] T012 [P] [US1] Implémenter validation d'origine, CSRF de `hello` et autorisation d'appareil réutilisant la sécurité existante dans `apps/api/src/security/realtime-authorization.ts`
- [X] T013 [P] [US1] Implémenter inscription, retrait et diffusion sélective des connexions dans `apps/api/src/realtime/page-sync-hub.ts`
- [X] T014 [US1] Implémenter l'automate serveur `awaiting-hello/ready/closing` et les requêtes bornées par page dans `apps/api/src/realtime/page-sync-session.ts`
- [X] T015 [US1] Exposer `/v1/page-sync/socket` en réutilisant `PageOperationService`, `LegacyBranchService` et les parseurs existants dans `apps/api/src/routes/page-sync-socket.ts`
- [X] T016 [US1] Enregistrer le plugin avant les routes, construire le hub et le fermer avec Fastify dans `apps/api/src/app.ts`
- [X] T017 [US1] Publier les séquences de page après les commits actifs, conversions et résolutions dans `apps/api/src/page-state/page-operation-service.ts`, `legacy-branch-service.ts` et `page-ambiguity-service.ts`
- [X] T018 [US1] Implémenter le client WebSocket natif multiplexé et `PageSyncTransport` dans `apps/web/src/services/realtime-page-sync-transport.ts`
- [X] T019 [US1] Injecter le transport temps réel dans chaque `PageReconciler` et partager une connexion par `LocalContentService` dans `apps/web/src/services/local-content.ts`
- [X] T020 [US1] Démarrer/arrêter la session avec l'authentification et déclencher le rattrapage sur `ready`/annonce dans `apps/web/src/features/sync/realtime-sync-lifecycle.ts` et `apps/web/src/features/sync/use-realtime-sync.ts`
- [X] T021 [US1] Réserver SSE au workspace et retirer son réveil redondant des pages opérationnelles dans `apps/web/src/features/sync/use-change-stream.ts`
- [X] T022 [P] [US1] Activer l'upgrade same-origin dans Vite et nginx avec heartbeat-compatible timeout dans `apps/web/vite.config.ts` et `docker/web-nginx.conf`
- [X] T023 [US1] Relier l'état de connexion au chrome compact sans le confondre avec la durabilité dans `apps/web/src/components/sync-status.tsx` et `apps/web/src/app.tsx`
- [X] T024 [US1] Enregistrer le journey et les propriétaires de sources temps réel dans `ci/test-impact.json`
- [X] T025 [US1] Exécuter les tests ciblés US1 et consigner latence p50/p95 et absence de remplacement dans `specs/018-durable-realtime-sync/validation.md`

**Checkpoint**: Le temps réel connecté fonctionne de bout en bout ; la file
locale et le service transactionnel restent les seules autorités.

---

## Phase 4: User Story 2 — Converger après des modifications hors ligne (Priority: P1)

**Goal**: Deux appareils modifient texte, marques et blocs hors ligne puis
convergent dans tout ordre ; suppression/édition reste récupérable.

**Independent Test**: Couper deux profils, modifier le même paragraphe et
l'arbre, fermer l'un, reconnecter dans les deux ordres et comparer digests,
identités et décisions.

### Tests for User Story 2

- [X] T026 [P] [US2] Étendre à 1 000 permutations les propriétés de livraison, duplication, même paragraphe et ordre dans `packages/page-state/tests/multi-device-convergence.property.spec.ts`
- [X] T027 [P] [US2] Écrire 100 propriétés move+edit, 100 moves concurrents et 100 delete+edit récupérables dans `packages/page-state/tests/realtime-block-convergence.property.spec.ts`
- [X] T028 [P] [US2] Couvrir rafales d'annonces, pages fermées, séquences obsolètes et rattrapage ciblé dans `apps/web/tests/realtime-page-sync-transport.spec.ts`, `apps/web/tests/local-content-realtime-sync.spec.ts` et `apps/web/tests/synchronize-serialization.spec.ts`
- [X] T029 [P] [US2] Tester un appareil absent 90 jours et un retard de 10 000 updates avec lots bornés et interruption/reprise dans `apps/api/tests/page-operation-long-absence.integration.spec.ts`
- [X] T030 [P] [US2] Étendre le journey hors ligne à deux contextes au même paragraphe et aux deux ordres de reconnexion dans `tests/e2e/page-multi-device-convergence.spec.ts`
- [X] T031 [P] [US2] Couvrir move+edit, moves concurrents, delete+edit récupérable et page fermée dans `tests/e2e/page-multi-device-convergence.spec.ts` et `tests/e2e/page-ambiguity.spec.ts`

### Implementation for User Story 2

- [X] T032 [US2] Garantir une annonce de page pour chaque chemin de commit opérationnel et aucune annonce pour replay/rollback dans `apps/api/src/realtime/page-advance-notifier.ts` et `apps/api/src/page-state/`
- [X] T033 [US2] Ajouter la découverte chiffrée/indexée des pages actives, ouvertes et en attente sans ouvrir tous les payloads dans `packages/client-core/src/page-sync/encrypted-update-log.ts`
- [X] T034 [US2] Implémenter réconciliation ciblée et drain global borné incluant les pages fermées dans `apps/web/src/services/local-content.ts`
- [X] T035 [US2] Coalescer les annonces par page et ignorer les séquences déjà durables dans `apps/web/src/services/realtime-page-sync-transport.ts`
- [X] T036 [US2] Préserver sélection, focus et scroll lors de l'application distante en direct dans `apps/web/src/features/editor/editor-remote-apply.ts` et `apps/web/src/features/editor/editor-view-state.ts`
- [X] T037 [US2] Vérifier par propriétés l'import, l'ordre mobile et les ambiguïtés delete/edit dans `packages/page-state/tests/realtime-block-convergence.property.spec.ts` ; aucun durcissement domaine supplémentaire n'a été requis
- [X] T038 [US2] Maintenir taille, mémoire et progression bornées pendant le rattrapage dans `packages/client-core/src/page-sync/page-reconciler.ts` et `apps/api/src/page-state/page-operation-service.ts`
- [X] T039 [US2] Enregistrer les journeys et tests de convergence dans `ci/test-impact.json`
- [X] T040 [US2] Exécuter la matrice US2 et consigner seeds, digests et rattrapage 10 000 dans `specs/018-durable-realtime-sync/validation.md`

**Checkpoint**: Tous les gestes compatibles convergent automatiquement ; seules
les intentions réellement incompatibles créent une décision limitée.

---

## Phase 5: User Story 3 — Survivre aux coupures et redémarrages sans mentir (Priority: P1)

**Goal**: Les coupures à chaque frontière locale/serveur ne perdent rien et ne
produisent aucun faux état synchronisé.

**Independent Test**: Injecter chaque interruption du scénario D, relancer et
vérifier une seule opération serveur, la file locale et le statut exact.

### Tests for User Story 3

- [x] T041 [P] [US3] Étendre la fault matrix IndexedDB avant/après update, envoi, réponse et commit local dans `packages/client-core/tests/page-operation-atomicity.spec.ts` et `packages/client-core/tests/page-reconciler.property.spec.ts`
- [x] T042 [P] [US3] Verrouiller commit réussi/perdu, rejet, replay et absence d'annonce prématurée dans `apps/api/tests/realtime-page-sync.contract.spec.ts`
- [x] T043 [P] [US3] Tester heartbeat, demi-connexion, full-jitter, fermeture et reprise des promesses en vol dans `apps/web/tests/realtime-page-sync-transport.spec.ts` et `apps/api/tests/page-sync-session.spec.ts`
- [x] T044 [P] [US3] Tester l'exclusion WebSocket/HTTP et le retry avec les mêmes IDs dans `apps/web/tests/realtime-page-sync-transport.spec.ts` et `packages/client-core/tests/page-reconciler.property.spec.ts`
- [x] T045 [P] [US3] Tester réponse perdue après commit, kill du navigateur propriétaire et reprise par un autre onglet dans `tests/e2e/page-multi-tab-convergence.spec.ts`, avec arrêt API couvert par `apps/api/tests/page-sync-session.spec.ts`

### Implementation for User Story 3

- [x] T046 [US3] Implémenter heartbeat, timeout, exponentielle full-jitter et accélération `online/visibility` dans `apps/web/src/services/realtime-page-sync-transport.ts`
- [x] T047 [US3] Rejeter les requêtes en vol comme hors-ligne à la coupure sans posséder ni effacer leurs updates dans `apps/web/src/services/realtime-page-sync-transport.ts` et `packages/client-core/src/page-sync/page-reconciler.ts`
- [x] T048 [US3] Implémenter un transport hybride qui choisit exactement un chemin WebSocket ou HTTP par invocation dans `apps/web/src/services/realtime-page-sync-transport.ts` et `apps/web/src/services/page-operations-api.ts`
- [x] T049 [US3] Garantir le renvoi `accepted/repeated` après transaction et la publication uniquement après commit dans `apps/api/src/routes/page-sync-socket.ts` et `apps/api/src/page-state/page-operation-service.ts`
- [x] T050 [US3] Fermer proprement hub, timers et sockets au shutdown tout en laissant les clients reprendre dans `apps/api/src/realtime/page-sync-hub.ts` et `apps/api/src/app.ts`
- [x] T051 [US3] Extraire la dérivation `local-save-failed/needs-attention/syncing/saved-local/synced` dans `packages/client-core/src/page-sync/page-sync-state.ts`
- [x] T052 [US3] Brancher pending, sending et confirmations durables sur le statut global dans `apps/web/src/services/local-content.ts` et `apps/web/src/components/sync-status.tsx` (les octets fichier restent explicitement T082)
- [x] T053 [P] [US3] Ajouter journaux structurés expurgés et métriques bornées de session/lot/latence dans `apps/api/src/realtime/page-sync-observability.ts` et `apps/api/src/plugins/logging.ts`
- [x] T054 [US3] Enregistrer la fault matrix et le journey crash dans `ci/test-impact.json`
- [x] T055 [US3] Exécuter toutes les frontières de panne et consigner zéro perte/faux ACK dans `specs/018-durable-realtime-sync/validation.md`

**Checkpoint**: Une réponse réseau n'est jamais confondue avec un commit ; tout
crash reprend le même travail durable sans duplication.

---

## Phase 6: User Story 4 — Auto-réparer un navigateur hérité (Priority: P1)

**Goal**: Les anciennes mutations et conflits de page deviennent branches
sémantiques, archives prouvées ou quarantaines exportables, sans faux compteur.

**Independent Test**: Ouvrir les fixtures de schémas 1 à 8, dont cinq conflits
de page et stockage persistant refusé, interrompre la conversion puis relancer.

### Tests for User Story 4

- [x] T056 [P] [US4] Écrire les tests de migration Dexie v1→v9, ajout sans déchiffrement et conservation des stores dans `packages/client-core/tests/legacy-sync-recovery-schema.spec.ts`
- [x] T057 [P] [US4] Écrire les propriétés du diff canonique→commandes et du replay au digest exact dans `packages/page-state/tests/legacy-document-diff.property.spec.ts`
- [x] T058 [P] [US4] Écrire les tests classification, ordre multi-conflits, quarantine et reprise de crash dans `packages/client-core/tests/legacy-conflict-recovery.spec.ts`
- [x] T059 [P] [US4] Écrire les tests de compteurs actifs, avertissement de stockage séparé et libellés accessibles dans `apps/web/tests/sync-status.spec.tsx`
- [x] T060 [P] [US4] Écrire le journey d'une IndexedDB historique avec cinq conflits et permission persistante refusée dans `tests/e2e/legacy-sync-self-healing.spec.ts`

### Implementation for User Story 4

- [x] T061 [US4] Passer le schéma local à 9 et ajouter `legacySyncRecoveries` sans ouvrir de payload dans `packages/client-core/src/local-store/schema.ts`
- [x] T062 [US4] Implémenter le diff sémantique stable et la preuve de replay exact dans `packages/page-state/src/legacy-document-diff.ts` et `packages/page-state/src/index.ts`
- [x] T063 [US4] Implémenter repository et invariants `pending/converting/quarantined/converted` dans `packages/client-core/src/page-sync/legacy-conflict-recovery.ts`
- [x] T064 [US4] Construire une branche chiffrée depuis base/local et classifier les erreurs avec codes sûrs dans `packages/client-core/src/page-sync/legacy-conflict-recovery.ts`
- [x] T065 [US4] Étendre le handover pour supprimer le conflit source seulement avec le checkpoint converti dans la même transaction dans `packages/client-core/src/page-sync/migration.ts`
- [x] T066 [US4] Lancer et reprendre la récupération après unlock, avant le statut final et sans bloquer l'édition courante dans `apps/web/src/services/local-content.ts`
- [x] T067 [US4] Distinguer conflits actifs, récupérations en cours et quarantaines dans `packages/client-core/src/outbox/outbox.ts` et `apps/web/src/services/local-content.ts`
- [x] T068 [US4] Retirer `durable storage was not granted` du statut de conflit et afficher la copie neutre dans `apps/web/src/components/sync-status.tsx` et `apps/web/src/ui/copy/fr.ts`
- [x] T069 [US4] Ajouter la liste/export des brouillons quarantainés dans la surface dédiée de diagnostics dans `apps/web/src/features/settings/storage-diagnostics.tsx` et `apps/web/src/features/sync/legacy-recovery-list.tsx`
- [x] T070 [P] [US4] Ajouter les fixtures chiffrées représentatives v1 à v8 dans `packages/client-core/tests/fixtures/legacy-sync/` et le générateur déterministe dans `packages/client-core/tests/fixtures/build-legacy-sync-fixtures.ts`
- [x] T071 [US4] Enregistrer les tests de migration et le journey d'auto-réparation dans `ci/test-impact.json`
- [x] T072 [US4] Exécuter toutes les fixtures et consigner conversions, archives, quarantaines et compteurs dans `specs/018-durable-realtime-sync/validation.md`

**Checkpoint**: Un ancien profil ne peut plus créer un faux conflit global ;
chaque brouillon est intégré ou explicitement récupérable.

---

## Phase 7: User Story 5 — Rester sûr lors des changements d'appareil et restaurations (Priority: P2)

**Goal**: Origine, session, CSRF, révocation, limites, fichiers et restauration
restent sûrs avec le canal persistant.

**Independent Test**: Refuser chaque variante non autorisée, révoquer un socket
ouvert, restaurer le serveur avec travail local plus récent et vérifier la
conservation des intentions.

### Tests for User Story 5

- [x] T073 [P] [US5] Étendre les tests API à origine, session, CSRF, versions, taille, concurrence et logs expurgés dans `apps/api/tests/realtime-page-sync-security.contract.spec.ts`
- [x] T074 [P] [US5] Écrire le test d'intégration de révocation avant handshake, pendant requête sous verrou transactionnel et sur heartbeat dans `apps/api/tests/realtime-device-revocation.integration.spec.ts`
- [x] T075 [P] [US5] Écrire le contrat Vite/nginx d'upgrade, headers et timeout sans nouveau service dans `tests/contract/realtime-proxy.spec.ts`
- [x] T076 [P] [US5] Étendre backup/restore à une branche locale plus récente et un appareil absent 90 jours dans `apps/api/tests/page-operation-backup.integration.spec.ts`
- [x] T077 [P] [US5] Écrire les tests document confirmé/fichier incomplet et reprise d'upload dans `apps/web/tests/realtime-file-sync-status.spec.ts`
- [x] T078 [P] [US5] Écrire les journeys révocation, proxy reconnect et restore avec travail local dans `tests/e2e/realtime-sync-security-and-restore.spec.ts`

### Implementation for User Story 5

- [x] T079 [US5] Fermer l'upgrade et le `hello` sur origine exacte, cookie, CSRF constant-time et protocole dans `apps/api/src/security/realtime-authorization.ts` et `apps/api/src/routes/page-sync-socket.ts`
- [x] T080 [US5] Appliquer limites 2 MiB, huit requêtes, une par page, rate limit et close codes sûrs dans `apps/api/src/realtime/page-sync-limits.ts` et `apps/api/src/realtime/page-sync-session.ts`
- [x] T081 [US5] Fermer les sessions révoquées et sérialiser révocation/écriture par un verrou d'appareil partagé dans `apps/api/src/realtime/page-sync-hub.ts`, `apps/api/src/routes/devices.ts`, `apps/api/src/security/device-service.ts` et `packages/database/src/repositories/`
- [x] T082 [US5] Intégrer exigences de fichiers et uploads à la dérivation « synchronisé sur tous les appareils » dans `apps/web/src/features/editor/editor-file-state.tsx` et `apps/web/src/services/local-content.ts`
- [x] T083 [US5] Vérifier et compléter la restauration des états opérationnels/frontières nécessaires au rattrapage dans `apps/api/src/backup/page-operation-archive.ts` et `apps/api/src/backup/restore-service.ts`
- [x] T084 [P] [US5] Documenter le proxy WebSocket HTTPS et le diagnostic de coupure dans `docs/deployment/reverse-proxy.md`
- [x] T085 [US5] Renforcer la validation Compose pour interdire Draw.io/service collaboratif et vérifier la route d'upgrade dans `scripts/ci/check-compose.ts` et `tests/contract/realtime-proxy.spec.ts`
- [x] T086 [US5] Enregistrer sécurité, proxy, fichiers et restauration dans `ci/test-impact.json`
- [x] T087 [US5] Exécuter la matrice US5 et consigner refus, révocation, restore et absence de fuite dans `specs/018-durable-realtime-sync/validation.md`

**Checkpoint**: Le canal temps réel n'élargit ni l'autorité ni la surface de
déploiement et les restaurations ne réintroduisent aucun overwrite silencieux.

---

## Phase 8: Polish and cross-cutting validation

**Purpose**: Fermer performances, documentation, matrice navigateur, Spec Kit et
gates de livraison avant la PR.

- [x] T088 [P] Ajouter budgets de connexion, propagation, rattrapage et mémoire à la machine de référence dans `tests/performance/realtime-page-sync.performance.spec.ts` et `tests/performance/reference-machine.ts`
- [x] T089 [P] Documenter debugging, fault injection et exécution parallèle sûre des familles indépendantes dans `docs/development.md`
- [x] T090 Ajouter la supersession de transport par 018 et l'état d'avancement au suivi produit dans `specs/017-v1-notion-like-workspace/spec.md`, `specs/017-v1-notion-like-workspace/tasks.md` et `README.md`
- [x] T091 Exécuter les propriétés et tests unitaires, contrats, intégration, migration, sécurité, backup et performance concernés en familles parallèles et consigner leurs commandes dans `specs/018-durable-realtime-sync/validation.md`
- [x] T092 Documenter l'écart d'acceptation où deux profils recevaient le même `deviceId` et où la connexion passkey ne terminait pas sa cérémonie dans `specs/018-durable-realtime-sync/spec.md`, `plan.md`, `data-model.md` et `quickstart.md`
- [x] T093 [P] Écrire les tests client d'identité stable par profil, partage entre onglets, stockage indisponible et assertion passkey complète dans `apps/web/tests/browser-device-identity.spec.ts` et `apps/web/tests/passkey-client.spec.ts`
- [x] T094 [P] Écrire les contrats API et repository pour création, réutilisation, réautorisation et refus d'une identité révoquée sans repli vers le premier appareil dans `apps/api/tests/authentication.contract.spec.ts` et `packages/database/tests/security-devices.integration.spec.ts`
- [x] T095 Implémenter le contrat d'identité, sa persistance navigateur et son passage au bootstrap/aux connexions dans `packages/contracts/src/security-api.ts`, `apps/web/src/features/auth/browser-device-identity.ts`, `apps/web/src/services/security-api.ts` et `apps/api/src/routes/bootstrap.ts`
- [x] T096 Implémenter l'assertion passkey complète et l'enrôlement transactionnel de l'appareil exact dans `apps/web/src/features/auth/passkey-client.ts`, `apps/web/src/features/auth/login-page.tsx`, `packages/database/src/repositories/security/device-repository.ts` et `apps/api/src/routes/authentication.ts`
- [x] T097 Ajouter les journeys de deux profils/deux appareils, réutilisation du même profil, passkey et révocation isolée dans `tests/e2e/authentication.spec.ts` et consigner la preuve dans `specs/018-durable-realtime-sync/validation.md`
- [x] T098 Exécuter les journeys critiques sur Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile et consigner la matrice dans `specs/018-durable-realtime-sync/validation.md`
- [x] T099 Exécuter intégralement `quickstart.md`, dont proxy HTTPS local jetable, deux profils et deux `deviceId` réels, puis compléter `specs/018-durable-realtime-sync/validation.md`
- [x] T100 Exécuter `$speckit-converge`, ajouter toute preuve manquante à `specs/018-durable-realtime-sync/tasks.md` et fermer chaque tâche ajoutée
- [x] T101 Exécuter `pnpm checks:local` selon `docs/development.md` et enregistrer le commit exact et le résultat dans `specs/018-durable-realtime-sync/validation.md`
- [x] T102 Pousser `codex/018-durable-realtime-sync`, ouvrir la PR et vérifier que chaque gate requise s'exécute sur le merge commit proposé
- [x] T103 Corriger tout échec de CI sans désactiver de gate, obtenir la revue, fusionner la PR verte et vérifier la CI complète ainsi que les images commit-addressable de `main`

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)**: démarre immédiatement.
- **Foundations (Phase 2)**: dépend de T001 ; bloque les stories.
- **US1 (Phase 3)**: dépend des contrats et du notifier fondationnels ; livre le
  premier parcours temps réel démontrable.
- **US2 (Phase 4)**: dépend du transport US1 ; les propriétés Loro T026/T027
  peuvent démarrer après Foundations.
- **US3 (Phase 5)**: dépend du transport US1 ; ses tests serveur T042 et client
  T041 peuvent avancer pendant US2.
- **US4 (Phase 6)**: dépend de l'autorité opérationnelle existante, pas de l'UI
  US2 ; T056 à T060 peuvent être écrits après Foundations, l'intégration finale
  dépend de US1/US3.
- **US5 (Phase 7)**: dépend du hub US1 et du statut US3 ; les tests backup et
  proxy peuvent être préparés plus tôt.
- **Polish (Phase 8)**: dépend de toutes les stories.

### User story completion order

~~~text
Foundations
    │
    ▼
US1 connected realtime
    ├──────────────┐
    ▼              ▼
US2 convergence   US3 crash durability
    └──────┬───────┘
           ▼
US4 legacy self-healing
           │
           ▼
US5 security / restore
           │
           ▼
cross-cutting validation and PR
~~~

## Parallel opportunities

- Dans chaque story, les tests marqués `[P]` touchent des projets/fichiers
  distincts et peuvent être écrits ensemble avant l'implémentation.
- Les propriétés page-state de US2, les tests de panne client de US3 et les
  fixtures de migration de US4 peuvent progresser en parallèle après Phase 2.
- API, client Web et proxy peuvent être implémentés en parallèle seulement
  après gel des contrats T003/T004.
- Les suites finales unit/property, API/DB et Web peuvent tourner en parallèle ;
  chaque profil Playwright conserve sa stack et ses ports isolés avec la limite
  de workers documentée pour les runners peu dotés.

## Parallel examples

### US1

~~~text
T008 API contract  ─┐
T009 client socket ─┼─► T012–T023 implementation
T010 integration  ─┤
T011 Playwright   ──┘
~~~

### US2 and US3

~~~text
T026–T027 CRDT properties ─► T037 model hardening
T028 client announcements ─► T033–T035 catch-up
T041 client fault matrix ───► T046–T048 reconnect/fallback
T042 server fault matrix ───► T049–T050 commit/shutdown
~~~

### US4

~~~text
T056 schema fixtures ───────► T061
T057 semantic diff proof ───► T062
T058 recovery state machine ► T063–T067
T059 status UI ─────────────► T068–T069
~~~

## Implementation strategy

### First demonstrable slice

1. Terminer Setup et Foundations.
2. Écrire tous les tests US1 et confirmer leurs échecs attendus.
3. Livrer le socket serveur, le client et le proxy.
4. Valider deux contextes connectés et la latence avant tout élargissement.

### Reliability progression

1. Prouver la convergence hors ligne (US2).
2. Couper chaque frontière et prouver la durabilité (US3).
3. Mettre à niveau les profils historiques sans perte (US4).
4. Fermer sécurité, fichiers et restauration (US5).
5. Exécuter toute la matrice, converger Spec Kit puis seulement pousser la PR.

## Notes

- `[P]` signifie fichiers distincts et absence de dépendance non terminée.
- Les tests sont écrits avant l'implémentation correspondante et doivent échouer
  pour le comportement manquant, pas pour une fixture cassée.
- Aucun test ou gate n'est désactivé pour faire passer un runner peu doté ; la
  parallélisation et les workers suivent `docs/development.md`.
- Toute nouvelle donnée durable exige migration, backup, restore et fixture
  avant d'être considérée terminée.
- Les pushes indexent des chemins explicites ; les modifications de l'autre
  worktree propriétaire restent hors périmètre.

## Phase 9: Convergence

- [x] T104 [P] Ajouter les régressions d'intégration édition opérationnelle puis renommage ou déplacement avant consolidation, divergence réelle de lignée et poursuite des autres candidats dans `apps/api/tests/page-history-consolidation.integration.spec.ts` per FR-035 et US5/AC3 (missing)
- [x] T105 Faire suivre à la révision consolidée la tête canonique descendante courante tout en refusant une lignée concurrente dans `apps/api/src/page-state/page-history-service.ts` per FR-005, FR-029 et US5/AC3 (contradicts)
- [x] T106 Isoler l'échec d'un candidat de consolidation et journaliser une cause structurée expurgée sans bloquer les autres pages dans `apps/api/src/page-state/page-history-service.ts` et `apps/api/src/app.ts` per FR-027 (partial)
